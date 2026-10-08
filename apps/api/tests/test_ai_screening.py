import io
import json
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection
from django.test import override_settings
from django.utils import timezone
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from rest_framework.test import APIClient

from recruitment.ai_screening import SYSTEM_PROMPT, _hr_member, _parse_analysis
from recruitment.models import (
    AIScreening,
    AIScreeningVerification,
    Application,
    ApplicationResume,
    Candidate,
    Department,
    DepartmentRole,
    Enterprise,
    EnterpriseEndorsement,
    Job,
    Membership,
    Organization,
    ProfileRequirement,
    ProfileVersion,
    QuestionTemplate,
    QuestionTemplateEvent,
    ResumeDocument,
    ResumeParse,
    ReviewDecision,
    StageEvent,
    Task,
)

pytestmark = pytest.mark.django_db


def hr_context(username="screening-hr"):
    organization = Organization.objects.create(name="分析测试组织")
    department = Department.objects.create(organization=organization, name="招聘部")
    user = get_user_model().objects.create_user(username, password="test-password-12345")
    membership = Membership.objects.create(user=user, organization=organization)
    DepartmentRole.objects.create(membership=membership, department=department, role="hr")
    job = Job.objects.create(
        organization=organization,
        department=department,
        title="产品经理",
        location="深圳",
        headcount=1,
        owner=membership,
        approver=membership,
        status="open",
        jd="负责企业服务产品需求分析与交付。",
    )
    client = APIClient()
    client.force_login(user)
    session = client.session
    session["membership_id"] = membership.id
    session.save()
    return client, membership, job


def docx_resume():
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            "<w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>独立负责产品上线。</w:t></w:r>"
            '<w:hyperlink r:id="rId1"><w:r><w:t>作品集</w:t></w:r></w:hyperlink>'
            "</w:p></w:body></w:document>",
        )
        archive.writestr(
            "word/_rels/document.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            'Target="https://example.com/portfolio" TargetMode="External"/>'
            "</Relationships>",
        )
    return content.getvalue()


def pdf_resume():
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=200)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica-Bold"),
        }
    )
    font_ref = writer._add_object(font)
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref})}
    )
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 12 Tf 72 120 Td (PDF resume extraction test) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(content)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_resume_attachment_extraction_returns_text_without_storing_file():
    client, _, _ = hr_context()
    response = client.post(
        "/api/v1/ai-screenings/extract/",
        {"file": SimpleUploadedFile("resume.docx", docx_resume())},
        format="multipart",
    )

    assert response.status_code == 200
    assert "独立负责产品上线" in response.data["text"]
    assert "<strong>独立负责产品上线。</strong>" in response.data["html"]
    assert '<a href="https://example.com/portfolio"' in response.data["html"]
    assert not ResumeDocument.objects.exists()
    assert not ResumeParse.objects.exists()

    pdf_response = client.post(
        "/api/v1/ai-screenings/extract/",
        {"file": SimpleUploadedFile("resume.pdf", pdf_resume())},
        format="multipart",
    )
    assert pdf_response.status_code == 200
    assert "PDF resume extraction test" in pdf_response.data["text"]
    assert "<strong>PDF resume extraction test</strong>" in pdf_response.data["html"]


def test_resume_attachment_extraction_rejects_unsupported_or_mismatched_files():
    client, _, _ = hr_context()
    image = client.post(
        "/api/v1/ai-screenings/extract/",
        {"file": SimpleUploadedFile("resume.png", b"\x89PNG\r\n\x1a\n")},
        format="multipart",
    )
    mismatched = client.post(
        "/api/v1/ai-screenings/extract/",
        {"file": SimpleUploadedFile("resume.pdf", b"not a PDF")},
        format="multipart",
    )

    assert image.status_code == 400
    assert "暂不支持 OCR" in str(image.data)
    assert mismatched.status_code == 400
    assert "扩展名不匹配" in str(mismatched.data)


def test_analysis_returns_only_verifiable_resume_quotes_and_job_context():
    client, _, job = hr_context()
    resume = "负责企业协作平台的审批模块，并与研发团队完成上线。"
    model_result = {
        "summary": "有企业产品交付经历，具体成效仍需核实。",
        "evidence": [
            {
                "criterion": "产品交付",
                "quote": "与研发团队完成上线",
                "reason": "体现跨团队协作与交付经验。",
            },
            {
                "criterion": "数据结果",
                "quote": "提升转化率 30%",
                "reason": "无法在简历中找到该依据。",
            },
        ],
        "gaps": [{"criterion": "结果指标", "note": "简历未说明改版前后的数据变化。"}],
        "questions": [
            {
                "question": "审批模块上线后如何验证效果？",
                "reason": "核实结果评估方式及本人贡献。",
                "follow_up": "请说明你负责的指标、观察周期和上线前后的对照数据。",
                "answer_points": [
                    "区分本人负责和团队负责的部分。",
                    "提供指标口径、数据来源与验证过程。",
                ],
                "quote": "与研发团队完成上线",
            }
        ],
    }
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(model_result)
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {"resume": resume, "job_id": job.id},
            format="json",
        )

    assert response.status_code == 200
    assert len(response.data["evidence"]) == 1
    assert response.data["evidence"][0]["quote"] == "与研发团队完成上线"
    assert response.data["questions"] == [
        {**model_result["questions"][0], "requirement_id": None, "origin": "generated"}
    ]
    sent_context = json.loads(complete.call_args.kwargs["user_text"])
    assert sent_context["resume"] == resume
    assert sent_context["target_job"]["title"] == "产品经理"
    assert sent_context["target_job"]["description"] == job.jd
    assert sent_context["analysis_date"] == timezone.localdate().isoformat()
    assert response.data["analysis_date"] == sent_context["analysis_date"]
    assert response.data["quality_version"] == 2
    assert len(response.data["analysis_issues"]) == 1
    assert complete.call_args.kwargs["max_tokens"] == 393_216
    assert complete.call_args.kwargs["thinking"] == {"type": "disabled"}
    assert complete.call_args.kwargs["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize(
    "optional_context", [{}, {"application_id": None, "job_id": None, "enterprise_id": None}]
)
def test_analysis_accepts_resume_without_optional_context(optional_context):
    client, _, _ = hr_context()
    result = {"summary": "有产品交付经历，具体结果需核实。", "questions": []}
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(result)
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {"resume": "独立负责过产品上线。", **optional_context},
            format="json",
        )

    assert response.status_code == 200
    context = json.loads(complete.call_args.kwargs["user_text"])
    assert context["target_job"] is None and context["target_enterprise"] is None


def test_new_analysis_does_not_publish_incomplete_or_unverifiable_questions():
    result = _parse_analysis(
        json.dumps(
            {
                "summary": "具体结果需核实。",
                "questions": [
                    {"question": "如何验证上线效果？", "reason": "结果验证。"},
                    {
                        "question": "如何划分团队职责？",
                        "reason": {"invalid": "不是文本"},
                        "follow_up": ["不是文本"],
                        "answer_points": [None, 123, {}, " ", "  说明本人职责与交付物。  "],
                        "quote": "与研发团队\n完成上线",
                    },
                    {
                        "question": "有无量化结果？",
                        "follow_up": "请提供数据来源。",
                        "answer_points": "应当返回数组",
                        "quote": "提升转化率 30%",
                    },
                    {"question": ["不是文本"]},
                    "不是问题对象",
                ],
            }
        ),
        "负责审批模块，并与研发团队 完成上线。",
    )

    assert result["questions"] == []
    assert result["analysis_issues"] == ["模型的一道题目结构不完整或引用无法核验，未采用为面试题。"]


@pytest.mark.parametrize(
    ("model_content", "diagnostic"),
    [
        ("not json", "Expecting value"),
        (json.dumps(["not", "an object"]), "最外层必须是 JSON 对象"),
        (json.dumps({"evidence": []}), "缺少字符串类型的 summary"),
        (json.dumps({"summary": "  "}), "summary 摘要为空"),
    ],
)
def test_analysis_exposes_safe_model_format_diagnostic(model_content, diagnostic):
    client, _, _ = hr_context()
    with patch("recruitment.ai_screening.chat_completion", return_value=model_content):
        response = client.post(
            "/api/v1/ai-screenings/",
            {"resume": "简历内容。"},
            format="json",
        )

    assert response.status_code == 502
    assert diagnostic in response.data["errors"]["detail"]
    assert not AIScreening.objects.exists()


@pytest.mark.parametrize("job_selection", [{}, {"job_id": None}])
def test_selected_application_respects_empty_job_without_sending_candidate_name(job_selection):
    client, membership, job = hr_context()
    candidate = Candidate.objects.create(
        organization=membership.organization,
        display_name="仅用于权限测试的姓名",
        created_by=membership,
    )
    application = Application.objects.create(
        organization=membership.organization,
        candidate=candidate,
        job=job,
        owner=membership,
        attempt_no=1,
        source="测试",
    )
    result = complete_report()
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(result)
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {"application_id": application.id, "resume": "负责产品上线。", **job_selection},
            format="json",
        )

    assert response.status_code == 200
    sent_context = json.loads(complete.call_args.kwargs["user_text"])
    if "job_id" in job_selection:
        assert sent_context["target_job"] is None
        assert response.data["job_id"] is None
        assert response.data["job_title"] == ""
        assert response.data["match_score"] is None
        assert response.data["conclusion"] == "通用初判"
    else:
        assert sent_context["target_job"]["title"] == "产品经理"
        assert response.data["job_id"] == job.id
        assert response.data["match_score"] is None
        assert response.data["conclusion"] == "待复核"
    assert response.data["application_id"] == application.id
    assert "仅用于权限测试的姓名" not in complete.call_args.kwargs["user_text"]


def test_analysis_requires_hr_role_and_does_not_leak_inaccessible_job():
    client, membership, _ = hr_context()
    other_org = Organization.objects.create(name="其他组织")
    other_department = Department.objects.create(organization=other_org, name="其他部门")
    other_user = get_user_model().objects.create_user("other-hr", password="test-password-12345")
    other_member = Membership.objects.create(user=other_user, organization=other_org)
    DepartmentRole.objects.create(membership=other_member, department=other_department, role="hr")
    other_job = Job.objects.create(
        organization=other_org,
        department=other_department,
        title="其他职位",
        location="上海",
        headcount=1,
        owner=other_member,
        approver=other_member,
    )
    with patch("recruitment.ai_screening.chat_completion") as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {"resume": "简历内容。", "job_id": other_job.id},
            format="json",
        )
    assert response.status_code == 404
    complete.assert_not_called()

    user = get_user_model().objects.create_user("screening-interviewer")
    Membership.objects.create(user=user, organization=membership.organization)
    unauthorized = APIClient()
    unauthorized.force_login(user)
    session = unauthorized.session
    session["membership_id"] = Membership.objects.get(user=user).id
    session.save()
    denied = unauthorized.post("/api/v1/ai-screenings/", {"resume": "简历内容。"}, format="json")
    assert denied.status_code == 403


@override_settings(LLM_API_BASE_URL="", LLM_API_KEY="", LLM_MODEL="")
def test_analysis_returns_service_unavailable_when_model_is_not_configured():
    client, _, _ = hr_context()
    with patch("recruitment.llm.urllib.request.urlopen") as urlopen:
        response = client.post("/api/v1/ai-screenings/", {"resume": "简历内容。"}, format="json")
    assert response.status_code == 503
    assert "诊断：模型服务尚未配置" in response.data["errors"]["detail"]
    urlopen.assert_not_called()


def complete_report():
    return {
        "summary": "有产品上线材料，仍需核实本人职责与结果。",
        "match_score": 73,
        "conclusion": "待复核",
        "follow_up_direction": "核实测试样本和交付物。",
        "evidence": [
            {"criterion": "产品交付", "quote": "负责产品上线", "reason": "简历描述交付经历。"}
        ],
        "gaps": [],
        "questions": [
            {
                "question": "如何验证产品上线结果？",
                "reason": "核实结果评估方式。",
                "follow_up": "请说明数据来源与对照方法。",
                "answer_points": ["描述可核实的数据口径。", "区分本人工作与团队贡献。"],
                "quote": "负责产品上线",
            }
        ],
    }


@pytest.mark.parametrize("score", [73, True, "90", -1, 101, float("nan"), None])
def test_uncalibrated_model_scores_are_not_published(score):
    report = {**complete_report(), "match_score": score, "conclusion": "建议录用"}
    parsed = _parse_analysis(json.dumps(report), "负责产品上线", has_job=True)
    assert parsed["match_score"] is None
    assert parsed["conclusion"] == "待复核"
    valid = complete_report()
    assert _parse_analysis(json.dumps(valid), "未提供项目证据", has_job=True)["match_score"] is None
    generic = _parse_analysis(json.dumps(valid), "负责产品上线")
    assert generic["match_score"] is None and generic["conclusion"] == "通用初判"


def test_analysis_prompt_keeps_dates_partial_material_and_forecast_qualifiers():
    for rule in (
        "以 analysis_date 为本次分析日期",
        "不能推出当前仍在读或已经毕业",
        "不擅自增加连续、全职",
        "自由接单",
        "未来结束日期可能是预计计划",
        "预计收益不得写成已经实现",
        "部分能力有材料时列出已有部分与待补部分",
        "summary、evidence、requirement_matches、gaps 必须一致",
    ):
        assert rule in SYSTEM_PROMPT


def test_analysis_date_is_captured_but_does_not_break_next_day_idempotency():
    client, _, job = hr_context()
    payload = {"request_key": str(uuid.uuid4()), "resume": "负责产品上线", "job_id": job.id}
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(complete_report())
    ) as complete:
        with patch("recruitment.ai_screening.timezone.localdate", return_value=date(2026, 10, 8)):
            first = client.post("/api/v1/ai-screenings/", payload, format="json")
        with patch("recruitment.ai_screening.timezone.localdate", return_value=date(2026, 10, 9)):
            retry = client.post("/api/v1/ai-screenings/", payload, format="json")
    assert first.status_code == retry.status_code == 200
    assert first.data == retry.data
    assert first.data["analysis_date"] == "2026-10-08"
    complete.assert_called_once()
    assert json.loads(complete.call_args.kwargs["user_text"])["analysis_date"] == "2026-10-08"


def test_generic_conflicts_need_two_distinct_quotes_and_preserve_forecast_wording():
    report = {
        "summary": "项目预计节省时间，尚未给出实测结果。",
        "gaps": [
            {
                "criterion": "时间矛盾",
                "kind": "material_conflict",
                "note": "两段记录需核实。",
                "quotes": ["2025年实习", "2026年同一实习"],
            },
            {
                "criterion": "未核验冲突",
                "kind": "material_conflict",
                "note": "没有两段依据。",
                "quotes": ["2025年实习", "2025年\n实习"],
            },
        ],
        "evidence": [
            {
                "criterion": "预计收益",
                "quote": "预计每天节省30分钟",
                "reason": "仅为计划目标，不是已实测成果。",
            }
        ],
    }
    result = _parse_analysis(json.dumps(report), "2025年实习；2026年同一实习；预计每天节省30分钟")
    assert len(result["gaps"]) == 1
    assert result["gaps"][0]["kind"] == "material_conflict"
    assert result["evidence"][0]["quote"] == "预计每天节省30分钟"
    assert "缺少两段可核验原文" in result["analysis_issues"][0]


@pytest.mark.parametrize("kind", ["material_missing", "material_conflict"])
def test_generic_material_gaps_do_not_silently_discard_forged_quotes(kind):
    report = {
        "summary": "需要人工核查材料。",
        "gaps": [
            {
                "criterion": "经验时间",
                "kind": kind,
                "note": "不能静默发布的错误依据断言。",
                "quotes": ["2025年实习", "2026年同一实习", "不存在的经历"],
            },
        ],
    }
    result = _parse_analysis(json.dumps(report), "2025年实习；2026年同一实习")
    assert result["gaps"] == []
    assert result["analysis_issues"] == [
        "模型的一条待核实事项引用无法核验，未作为候选人材料缺口或冲突展示。"
    ]


def test_report_persists_snapshots_and_repeated_request_reuses_saved_result():
    client, membership, job = hr_context()
    candidate = Candidate.objects.create(
        organization=membership.organization, display_name="测试候选人", created_by=membership
    )
    application = Application.objects.create(
        organization=membership.organization,
        candidate=candidate,
        job=job,
        owner=membership,
        attempt_no=1,
        source="测试",
    )
    payload = {
        "request_key": str(uuid.uuid4()),
        "application_id": application.id,
        "resume": "完整原文不重复保存：负责产品上线。",
    }
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(complete_report())
    ) as complete:
        first = client.post("/api/v1/ai-screenings/", payload, format="json")
        retry = client.post("/api/v1/ai-screenings/", payload, format="json")
        changed = client.post(
            "/api/v1/ai-screenings/", {**payload, "resume": "更换输入"}, format="json"
        )
    assert first.status_code == retry.status_code == 200
    assert first.data == retry.data
    assert changed.status_code == 409
    assert complete.call_count == 1
    assert AIScreening.objects.count() == 1
    stored = AIScreening.objects.get()
    assert len(stored.input_digest) == 64
    assert "完整原文不重复保存" not in json.dumps(stored.result, ensure_ascii=False)
    assert first.data["match_score"] is None
    assert first.data["candidate_name"] == "测试候选人"
    assert first.data["job_title"] == "产品经理"
    assert first.data["conclusion"] == "待复核"
    assert first.data["saved_question_count"] == 0
    assert first.data["questions_saved"] is False
    assert first.data["code"] == f"AIS-{stored.id:04d}" and first.data["created_at"]
    job.title = "修改后的职位名称"
    job.save(update_fields=["title"])
    detail_url = f"/api/v1/ai-screenings/{stored.id}/"
    assert client.get(detail_url).data == first.data
    listed = client.get("/api/v1/ai-screenings/").data
    assert listed["count"] == 1 and listed["page"] == 1 and listed["page_size"] == 20
    assert listed["items"][0]["question_count"] == 1
    assert listed["items"][0]["questions_saved"] is False
    assert listed["items"][0]["job_title"] == "产品经理"
    assert "questions" not in listed["items"][0]
    assert client.delete(detail_url).status_code == 200
    assert client.get(detail_url).status_code == 404
    assert client.get("/api/v1/ai-screenings/").data["count"] == 0
    assert AIScreening.objects.get().deleted_at is not None
    assert (
        client.post(f"{detail_url}questions/", {"confirmed": True}, format="json").status_code
        == 404
    )
    assert client.post("/api/v1/ai-screenings/", payload, format="json").status_code == 409


def client_for_member(membership):
    client = APIClient()
    client.force_login(membership.user)
    session = client.session
    session["membership_id"] = membership.id
    session.save()
    return client


def test_history_requires_owner_current_hr_role_and_current_job_access():
    client, membership, job = hr_context()
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(complete_report())
    ):
        created = client.post(
            "/api/v1/ai-screenings/", {"job_id": job.id, "resume": "负责产品上线"}, format="json"
        ).data
    url = f"/api/v1/ai-screenings/{created['id']}/"
    other_user = get_user_model().objects.create_user("screening-peer")
    peer = Membership.objects.create(user=other_user, organization=membership.organization)
    DepartmentRole.objects.create(membership=peer, department=job.department, role="hr")
    other_org_client, _, _ = hr_context("screening-other-org")
    for outsider in (client_for_member(peer), other_org_client):
        assert outsider.get("/api/v1/ai-screenings/").data["count"] == 0
        assert outsider.get(url).status_code == outsider.delete(url).status_code == 404
        assert (
            outsider.post(f"{url}questions/", {"confirmed": True}, format="json").status_code == 404
        )
    job.owner = peer
    job.save(update_fields=["owner"])
    assert client.get("/api/v1/ai-screenings/").data["count"] == 0
    assert client.get(url).status_code == client.delete(url).status_code == 404
    assert client.post(f"{url}questions/", {"confirmed": True}, format="json").status_code == 404
    membership.roles.all().delete()
    assert client.get("/api/v1/ai-screenings/").status_code == 403
    assert client.get(url).status_code == client.delete(url).status_code == 403
    assert client.post(f"{url}questions/", {"confirmed": True}, format="json").status_code == 403


def test_saving_questions_requires_confirmation_is_idempotent_and_excludes_private_quotes():
    client, membership, _ = hr_context()
    result = complete_report()
    result["questions"][0]["question"] = "联系 test@example.com 或 13800000000 后，如何验证结果？"
    result["questions"][0]["quote"] = "仅供报告查看的简历引用"
    with patch("recruitment.ai_screening.chat_completion", return_value=json.dumps(result)):
        report = client.post(
            "/api/v1/ai-screenings/",
            {"resume": "负责产品上线，仅供报告查看的简历引用"},
            format="json",
        ).data
    url = f"/api/v1/ai-screenings/{report['id']}/"
    for confirmed in (False, "true", 1, None):
        assert (
            client.post(f"{url}questions/", {"confirmed": confirmed}, format="json").status_code
            == 400
        )
    assert not QuestionTemplate.objects.exists()
    first = client.post(f"{url}questions/", {"confirmed": True}, format="json")
    again = client.post(f"{url}questions/", {"confirmed": True}, format="json")
    assert first.status_code == again.status_code == 200
    assert first.data == again.data
    assert first.data["saved_question_count"] == 1
    assert first.data["questions_saved"] is True
    assert QuestionTemplate.objects.count() == QuestionTemplateEvent.objects.count() == 1
    question = QuestionTemplate.objects.get()
    assert question.id in first.data["question_ids"]
    assert "考察点：" in question.content and "追问：" in question.content
    assert "可核实的数据口径" in question.reference_answer
    assert "仅供报告查看的简历引用" not in question.content + question.reference_answer
    assert "test@example.com" not in question.content and "13800000000" not in question.content
    assert QuestionTemplateEvent.objects.get().actor == membership
    assert client.get(url).data["saved_question_count"] == 1
    assert client.get(url).data["questions_saved"] is True
    deleted = client.delete(
        f"/api/v1/question-templates/{question.id}/", {"version": 1}, format="json"
    )
    assert deleted.status_code == 200
    assert client.get(url).data["saved_question_count"] == 0
    assert client.get(url).data["questions_saved"] is True
    listed = client.get("/api/v1/ai-screenings/").data["items"][0]
    assert listed["saved_question_count"] == 0 and listed["questions_saved"] is True
    assert client.post(f"{url}questions/", {"confirmed": True}, format="json").status_code == 409
    assert QuestionTemplate.objects.count() == 1


def selectable_question_report(membership, job):
    result = complete_report()
    result["questions"].append({**result["questions"][0], "question": "如何处理协作分歧？"})
    return AIScreening.objects.create(
        organization=membership.organization,
        creator=membership,
        job=job,
        job_title=job.title,
        candidate_name="测试候选人",
        request_key=uuid.uuid4(),
        input_digest="question-selection-test",
        result=result,
    )


def test_selected_questions_preserve_edits_allow_later_selection_and_never_overwrite_or_revive():
    client, membership, job = hr_context()
    report = selectable_question_report(membership, job)
    url = f"/api/v1/ai-screenings/{report.id}/"
    drafts = client.get(url).data["question_drafts"]
    assert [item["index"] for item in drafts] == [0, 1]
    assert all(not item["saved"] and not item["deleted"] for item in drafts)
    assert "负责产品上线" not in drafts[0]["content"]  # 原始引用只保留在个人报告。
    selected = {
        **drafts[1],
        "content": "测试候选人如何联系 test@example.com、13800000000 核实协作分歧？",
        "job_title": "产品负责人",
        "dimension": "团队协作",
        "difficulty": "困难",
        "reference_answer": "测试候选人提供个人贡献与可核查记录。\n" + "已核实的事实。\n" * 700,
    }
    payload = {"confirmed": True, "questions": [selected]}
    saved = client.post(f"{url}questions/", payload, format="json")
    retried = client.post(f"{url}questions/", payload, format="json")
    assert saved.status_code == retried.status_code == 200
    assert saved.data == retried.data
    assert saved.data["saved_question_count"] == 1
    assert [item["saved"] for item in saved.data["question_drafts"]] == [False, True]
    question = QuestionTemplate.objects.get()
    assert question.job_title == "产品负责人"
    assert question.dimension == "团队协作" and question.difficulty == "困难"
    assert "协作分歧" in question.content and "个人贡献" in question.reference_answer
    assert question.reference_answer == (
        selected["reference_answer"].replace("测试候选人", "候选人").strip()
    )
    for private in ("测试候选人", "test@example.com", "13800000000"):
        assert private not in question.content + question.reference_answer
    assert QuestionTemplateEvent.objects.count() == 1
    changed = client.post(
        f"{url}questions/",
        {"confirmed": True, "questions": [{**selected, "content": "不能覆盖已存题目"}]},
        format="json",
    )
    assert changed.status_code == 409
    question.refresh_from_db()
    assert "不能覆盖" not in question.content and question.version == 1
    later = client.post(
        f"{url}questions/", {"confirmed": True, "questions": [drafts[0]]}, format="json"
    )
    assert later.status_code == 200 and later.data["saved_question_count"] == 2
    assert QuestionTemplate.objects.count() == QuestionTemplateEvent.objects.count() == 2
    assert (
        client.delete(
            f"/api/v1/question-templates/{question.id}/", {"version": 1}, format="json"
        ).status_code
        == 200
    )
    detail = client.get(url).data
    assert detail["saved_question_count"] == 1
    assert detail["question_drafts"][1]["deleted"] is True
    assert detail["question_drafts"][1]["saved"] is False
    assert client.post(f"{url}questions/", payload, format="json").status_code == 409
    assert QuestionTemplate.objects.count() == 2
    report.refresh_from_db()
    assert report.result["questions"][1]["question"] == "如何处理协作分歧？"


def test_selected_questions_validate_whole_batch_and_keep_owner_scope():
    client, membership, job = hr_context()
    report = selectable_question_report(membership, job)
    url = f"/api/v1/ai-screenings/{report.id}/"
    drafts = client.get(url).data["question_drafts"]
    invalid_selections = [[], None, {}, [None], [drafts[0], drafts[0]]]
    invalid_selections.extend([{**drafts[0], "index": index}] for index in (True, "0", 0.5, -1, 2))
    invalid_selections.extend(
        [drafts[0], {**drafts[1], field: value}]
        for field, value in (
            ("content", "   "),
            ("content", None),
            ("content", 123),
            ("content", "题" * 10001),
            ("job_title", "岗" * 121),
            ("reference_answer", "答" * 10001),
            ("difficulty", "极难"),
            ("dimension", "不支持的维度"),
        )
    )
    for selection in invalid_selections:
        response = client.post(
            f"{url}questions/", {"confirmed": True, "questions": selection}, format="json"
        )
        assert response.status_code == 400, response.data
        assert not QuestionTemplate.objects.exists() and not QuestionTemplateEvent.objects.exists()
    peer_user = get_user_model().objects.create_user("selection-peer")
    peer = Membership.objects.create(user=peer_user, organization=membership.organization)
    DepartmentRole.objects.create(membership=peer, department=job.department, role="hr")
    payload = {"confirmed": True, "questions": [drafts[0]]}
    assert (
        client_for_member(peer).post(f"{url}questions/", payload, format="json").status_code == 404
    )
    foreign, _, _ = hr_context("selection-foreign")
    assert foreign.post(f"{url}questions/", payload, format="json").status_code == 404
    membership.roles.all().delete()
    assert client.post(f"{url}questions/", payload, format="json").status_code == 403
    assert not QuestionTemplate.objects.exists()


@pytest.mark.parametrize("operation", ["retry", "save", "delete"])
def test_membership_revoked_while_waiting_for_lock_cannot_reuse_or_change_report(operation):
    client, membership, _ = hr_context()
    payload = {"request_key": str(uuid.uuid4()), "resume": "负责产品上线"}
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(complete_report())
    ):
        report = client.post("/api/v1/ai-screenings/", payload, format="json").data
    calls = 0

    def check_member(request):
        nonlocal calls
        calls += 1
        if calls == 2:
            Membership.objects.filter(pk=membership.pk).update(active=False)
        return _hr_member(request)

    url = f"/api/v1/ai-screenings/{report['id']}/"
    with (
        patch("recruitment.ai_screening._hr_member", side_effect=check_member),
        patch("recruitment.ai_screening.chat_completion") as complete,
    ):
        if operation == "retry":
            response = client.post("/api/v1/ai-screenings/", payload, format="json")
        elif operation == "save":
            response = client.post(f"{url}questions/", {"confirmed": True}, format="json")
        else:
            response = client.delete(url)
    assert response.status_code == 403
    assert calls == 2
    complete.assert_not_called()
    assert AIScreening.objects.get().deleted_at is None
    assert not QuestionTemplate.objects.exists() and not QuestionTemplateEvent.objects.exists()


@pytest.mark.parametrize("questions", [[], [{"question": "只有题目", "reason": "旧格式"}]])
def test_empty_or_incomplete_questions_cannot_be_saved(questions):
    client, _, _ = hr_context()
    with patch(
        "recruitment.ai_screening.chat_completion",
        return_value=json.dumps({**complete_report(), "questions": questions}),
    ):
        report = client.post(
            "/api/v1/ai-screenings/", {"resume": "负责产品上线"}, format="json"
        ).data
    response = client.post(
        f"/api/v1/ai-screenings/{report['id']}/questions/", {"confirmed": True}, format="json"
    )
    assert response.status_code == 400
    assert not QuestionTemplate.objects.exists() and not QuestionTemplateEvent.objects.exists()


def test_saving_legacy_questions_rolls_back_when_later_question_is_invalid():
    client, membership, _ = hr_context()
    result = complete_report()
    result["questions"].append({"question": "缺少追问与答案要点", "reason": "待完善"})
    report = AIScreening.objects.create(
        organization=membership.organization,
        creator=membership,
        request_key=uuid.uuid4(),
        input_digest="1" * 64,
        result=result,
    )
    url = f"/api/v1/ai-screenings/{report.id}/"
    response = client.post(f"{url}questions/", {"confirmed": True}, format="json")
    assert response.status_code == 400
    assert not QuestionTemplate.objects.exists() and not QuestionTemplateEvent.objects.exists()
    assert client.get(url).data["saved_question_count"] == 0
    assert client.get(url).data["questions_saved"] is False


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("operation", ["analyze", "save"])
def test_concurrent_screening_requests_and_question_saves_do_not_duplicate(operation):
    assert connection.vendor == "postgresql"
    client, membership, _ = hr_context()
    payload = {"request_key": str(uuid.uuid4()), "resume": "负责产品上线"}
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(complete_report())
    ) as complete:
        url = "/api/v1/ai-screenings/"
        if operation == "save":
            report = client.post(url, payload, format="json").data
            url = f"{url}{report['id']}/questions/"
            payload = {"confirmed": True}
        clients = [client_for_member(membership), client_for_member(membership)]
        barrier = Barrier(2)

        def perform(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                response = clients[index].post(url, payload, format="json")
                assert response.status_code == 200, response.data
                return response.data
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(perform, range(2)))
    assert responses[0] == responses[1]
    assert complete.call_count == 1
    assert AIScreening.objects.count() == 1
    assert QuestionTemplate.objects.count() == (1 if operation == "save" else 0)
    assert QuestionTemplateEvent.objects.count() == (1 if operation == "save" else 0)


def screening_source(membership, job):
    candidate = Candidate.objects.create(
        organization=membership.organization, display_name="虚构核实人选", created_by=membership
    )
    application = Application.objects.create(
        organization=membership.organization,
        candidate=candidate,
        job=job,
        owner=membership,
        attempt_no=1,
        source="获授权的人工测试材料",
    )
    document = ResumeDocument.objects.create(
        organization=membership.organization,
        candidate=candidate,
        original_name="fictional.pdf",
        file_type="pdf",
        size=100,
        sha256="1" * 64,
        uploaded_by=membership,
    )
    parse = ResumeParse.objects.create(
        document=document,
        version=1,
        parser_version="test",
        status="succeeded",
        text="负责产品上线",
        actor=membership,
        request_key=uuid.uuid4(),
    )
    ApplicationResume.objects.create(application=application, parse=parse, assigned_by=membership)
    return application, parse


def create_screening(client, **data):
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(complete_report())
    ):
        response = client.post(
            "/api/v1/ai-screenings/", {"resume": "负责产品上线", **data}, format="json"
        )
    assert response.status_code == 200, response.data
    return response.data


def verification_payload(**values):
    return {
        "question_index": 0,
        "version": 0,
        "request_key": str(uuid.uuid4()),
        "status": "pending",
        **values,
    }


def test_analysis_freezes_exact_resume_profile_and_input_source_without_backfilling_old_reports():
    client, membership, job = hr_context()
    application, parse = screening_source(membership, job)
    profile = ProfileVersion.objects.create(
        job=job,
        number=1,
        jd_snapshot="已生效的产品交付要求",
        source="测试JD",
        created_by=membership,
        status="confirmed",
        confirmed_by=membership,
        confirmed_at=timezone.now(),
    )
    requirement = ProfileRequirement.objects.create(
        profile=profile, kind="must", text="独立交付产品", position=0
    )
    job.active_profile = profile
    job.save(update_fields=["active_profile"])
    report = create_screening(client, application_id=application.id, resume_parse_id=parse.id)
    context = report["source_context"]
    assert context["resume"] == parse.text
    assert context["job"]["description"] == profile.jd_snapshot
    assert context["job"]["profile_id"] == profile.id
    assert context["job"]["profile_version"] == 1
    assert context["job"]["requirements"] == [
        {
            "id": requirement.id,
            "kind": "must",
            "text": "独立交付产品",
            "rationale": "",
            "needs_verification": False,
            "source_kind": "manual",
            "source_quote": "",
            "source_reference": "",
            "source_edited": False,
        }
    ]
    assert context["source"]["resume_parse_id"] == parse.id
    assert context["source"]["kind"] == "application_resume"
    assert context["application"]["id"] == application.id and context["captured_at"]
    stored = AIScreening.objects.get(pk=report["id"])
    assert stored.profile == profile and stored.resume_parse == parse
    job.jd = "新版JD"
    job.save(update_fields=["jd"])
    ProfileRequirement.objects.filter(pk=requirement.id).update(text="后续新要求")
    assert client.get(f"/api/v1/ai-screenings/{stored.id}/").data["source_context"] == context
    old = AIScreening.objects.create(
        organization=membership.organization,
        creator=membership,
        request_key=uuid.uuid4(),
        input_digest="2" * 64,
        result=complete_report(),
    )
    old_report = client.get(f"/api/v1/ai-screenings/{old.id}/").data
    assert old_report["source_context"] is None
    assert old_report["verifications"] == []
    assert not client.get("/api/v1/ai-screenings/").data["items"][0].get("source_context")


def test_analysis_rejects_cross_application_job_and_unverifiable_material_references():
    client, membership, job = hr_context()
    application, parse = screening_source(membership, job)
    other_job = Job.objects.create(
        organization=membership.organization,
        department=job.department,
        title="其他岗位",
        location="深圳",
        headcount=1,
        owner=membership,
        approver=membership,
    )
    other_application, other_parse = screening_source(membership, other_job)
    with patch("recruitment.ai_screening.chat_completion") as complete:
        for payload, status in [
            ({"application_id": application.id, "job_id": other_job.id}, 400),
            ({"resume_parse_id": parse.id}, 400),
            ({"application_id": application.id, "resume_parse_id": other_parse.id}, 404),
        ]:
            response = client.post(
                "/api/v1/ai-screenings/", {"resume": parse.text, **payload}, format="json"
            )
            assert response.status_code == status, response.data
        complete.assert_not_called()
    assert other_application.id != application.id
    report = create_screening(client, application_id=application.id, job_id=None)
    assert report["source_context"]["job"] is None
    assert report["source_context"]["source"]["kind"] == "manual"


def test_manually_edited_parse_keeps_source_access_scope_and_marks_actual_input():
    client, membership, job = hr_context()
    application, parse = screening_source(membership, job)
    report = create_screening(
        client,
        application_id=application.id,
        resume_parse_id=parse.id,
        resume="负责产品上线，人工补充待核实的职责说明",
    )
    source = report["source_context"]["source"]
    assert source["edited"] is True and len(source["parse_text_digest"]) == 64
    assert report["source_context"]["resume"].endswith("人工补充待核实的职责说明")
    assert AIScreening.objects.get(pk=report["id"]).resume_parse_id == parse.id
    ResumeDocument.objects.filter(pk=parse.document_id).update(access_state="quarantine")
    assert client.get(f"/api/v1/ai-screenings/{report['id']}/").status_code == 404


@pytest.mark.parametrize("change", ["job", "parse", "source", "application", "permission"])
def test_analysis_rechecks_versions_and_source_permission_after_model_returns(change):
    client, membership, job = hr_context()
    application, parse = screening_source(membership, job)

    def complete(**kwargs):
        if change == "job":
            Job.objects.filter(pk=job.pk).update(jd="修改后的职责", version=2)
        elif change == "parse":
            ResumeParse.objects.filter(pk=parse.pk).update(text="修改后的文字")
        elif change == "source":
            ResumeDocument.objects.filter(pk=parse.document_id).update(access_state="quarantine")
        elif change == "application":
            Application.objects.filter(pk=application.pk).update(version=2)
        else:
            Membership.objects.filter(pk=membership.pk).update(active=False)
        return json.dumps(complete_report())

    with patch("recruitment.ai_screening.chat_completion", side_effect=complete):
        response = client.post(
            "/api/v1/ai-screenings/",
            {
                "resume": parse.text,
                "application_id": application.id,
                "resume_parse_id": parse.id,
            },
            format="json",
        )
    assert response.status_code in (400, 403, 404, 409)
    assert not AIScreening.objects.exists()


def test_verification_adopt_record_withdraw_and_revisions_do_not_change_recruitment_records():
    client, membership, job = hr_context()
    application, parse = screening_source(membership, job)
    report = create_screening(client, application_id=application.id, resume_parse_id=parse.id)
    url = f"/api/v1/ai-screenings/{report['id']}/verifications/"
    payload = verification_payload(
        recorder_id=99999, recorder_name="冒充他人", created_at="2000-01-01"
    )
    first = client.post(url, payload, format="json")
    assert first.status_code == 200, first.data
    item = first.data["items"][0]
    assert (
        item["recorder_id"] == membership.id and item["recorder_name"] == membership.user.username
    )
    assert item["contact_name"] == membership.user.username and item["version"] == 1
    assert client.post(url, payload, format="json").data == first.data
    assert (
        client.post(url, {**payload, "contact_name": "不同对接人"}, format="json").status_code
        == 409
    )
    recorded = client.post(
        url,
        verification_payload(
            version=1,
            status="supported",
            answer="说明本人负责的上线步骤与测试过程",
            evidence="人工核对：演示环境中的交付记录第2项",
            contact_name="测试面试对接人",
            next_step="返回飞书由HR决定下一步（未同步）",
            due_on="2026-12-20",
        ),
        format="json",
    )
    assert recorded.status_code == 200 and recorded.data["items"][0]["version"] == 2
    assert recorded.data["verification_summary"]["supported"] == 1
    stale = client.post(url, verification_payload(version=1), format="json")
    assert stale.status_code == 409
    withdrawal = client.post(
        url,
        verification_payload(version=2, status="withdrawn", next_step="该问题本轮不再核实"),
        format="json",
    )
    assert withdrawal.status_code == 200
    assert withdrawal.data["verification_summary"]["withdrawn"] == 1
    history = client.get(url, {"question_index": 0}).data
    assert history["count"] == 3 and [item["version"] for item in history["history"]] == [3, 2, 1]
    assert history["history"][1]["evidence"].startswith("人工核对")
    assert client.get(url).data["history"] == []
    application.refresh_from_db()
    assert application.stage == "pending_review" and application.version == 1
    stored = AIScreening.objects.get(pk=report["id"])
    assert stored.result["questions"] == report["questions"]
    for model in (Task, ReviewDecision, StageEvent, QuestionTemplate):
        assert model.objects.count() == 0


@pytest.mark.parametrize(
    "values",
    [
        {"status": "supported"},
        {"status": "contradicted", "answer": "回答"},
        {"status": "unresolved"},
        {"status": "withdrawn"},
        {"question_index": 1},
        {"question_index": -1},
        {"question_index": 5},
        {"due_on": "not-a-date"},
        {"answer": "字" * 5001},
        {"request_key": "invalid"},
        {"status": "approved"},
    ],
)
def test_verification_rejects_invalid_or_unadopted_changes_without_losing_records(values):
    client, _, _ = hr_context()
    report = create_screening(client)
    url = f"/api/v1/ai-screenings/{report['id']}/verifications/"
    assert client.post(url, verification_payload(**values), format="json").status_code == 400
    assert not AIScreeningVerification.objects.exists()


def test_verification_requires_owner_hr_and_current_source_access_for_read_and_write():
    client, membership, job = hr_context()
    application, parse = screening_source(membership, job)
    report = create_screening(client, application_id=application.id, resume_parse_id=parse.id)
    url = f"/api/v1/ai-screenings/{report['id']}/"
    assert (
        client.post(f"{url}verifications/", verification_payload(), format="json").status_code
        == 200
    )
    peer = Membership.objects.create(
        user=get_user_model().objects.create_user("other-verifier"),
        organization=membership.organization,
    )
    DepartmentRole.objects.create(membership=peer, department=job.department, role="hr")
    outsider, _, _ = hr_context("outside-verifier")
    for other in [client_for_member(peer), outsider]:
        assert other.get(f"{url}verifications/").status_code == 404
        assert (
            other.post(f"{url}verifications/", verification_payload(), format="json").status_code
            == 404
        )
    ResumeDocument.objects.filter(pk=parse.document_id).update(access_state="quarantine")
    assert client.get(url).status_code == client.get(f"{url}verifications/").status_code == 404
    assert client.get("/api/v1/ai-screenings/").data["count"] == 0
    assert (
        client.post(
            f"{url}verifications/", verification_payload(version=1), format="json"
        ).status_code
        == 404
    )
    assert AIScreeningVerification.objects.count() == 1
    membership.roles.all().delete()
    assert client.get(f"{url}verifications/").status_code == 403


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("same_request", [True, False])
def test_concurrent_verifications_are_idempotent_and_reject_stale_versions(same_request):
    assert connection.vendor == "postgresql"
    client, membership, _ = hr_context()
    report = create_screening(client)
    url = f"/api/v1/ai-screenings/{report['id']}/verifications/"
    payload = verification_payload()
    clients = [client_for_member(membership), client_for_member(membership)]
    barrier = Barrier(2)

    def perform(index):
        close_old_connections()
        try:
            data = payload if same_request else verification_payload()
            barrier.wait(timeout=10)
            return clients[index].post(url, data, format="json").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(perform, range(2)))
    assert statuses == ([200, 200] if same_request else [200, 409])
    assert AIScreeningVerification.objects.count() == 1


def test_bound_job_uses_enterprise_snapshot_and_rejects_another_selected_enterprise():
    client, membership, job = hr_context()
    enterprise = Enterprise.objects.create(
        organization=membership.organization, name="岗位所属企业"
    )
    other = Enterprise.objects.create(organization=membership.organization, name="另一企业")
    job.enterprise = enterprise
    job.save(update_fields=["enterprise"])
    with patch("recruitment.ai_screening.chat_completion") as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {
                "job_id": job.id,
                "enterprise_id": other.id,
                "resume": "负责产品上线",
            },
            format="json",
        )
    assert response.status_code == 400
    complete.assert_not_called()
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(complete_report())
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {
                "job_id": job.id,
                "enterprise_id": None,
                "resume": "负责产品上线",
            },
            format="json",
        )
    assert response.status_code == 200
    context = json.loads(complete.call_args.kwargs["user_text"])["target_enterprise"]
    assert context["id"] == enterprise.id
    assert (
        response.data["enterprise_snapshot"]
        == response.data["source_context"]["enterprise"]
        == context
    )


@pytest.mark.parametrize("change", ["disabled", "deleted", "link", "organization"])
def test_enterprise_link_and_access_changes_during_analysis_do_not_save_report(change):
    client, membership, job = hr_context()
    enterprise = Enterprise.objects.create(organization=membership.organization, name="测试企业")
    other = Enterprise.objects.create(organization=membership.organization, name="新企业")
    job.enterprise = enterprise
    job.save(update_fields=["enterprise"])

    def complete(**kwargs):
        if change == "disabled":
            Enterprise.objects.filter(pk=enterprise.pk).update(enabled=False)
        elif change == "deleted":
            Enterprise.objects.filter(pk=enterprise.pk).update(deleted_at=timezone.now())
        elif change == "link":
            Job.objects.filter(pk=job.pk).update(enterprise=other)
        else:
            Enterprise.objects.filter(pk=enterprise.pk).update(
                organization=Organization.objects.create(name="其它租户")
            )
        return json.dumps(complete_report())

    with patch("recruitment.ai_screening.chat_completion", side_effect=complete):
        response = client.post(
            "/api/v1/ai-screenings/",
            {
                "job_id": job.id,
                "resume": "负责产品上线",
            },
            format="json",
        )
    assert response.status_code in (400, 404, 409)
    assert not AIScreening.objects.exists()


@pytest.mark.parametrize("change", ["disabled", "deleted"])
def test_disabled_or_deleted_bound_enterprise_is_rejected_before_model_call(change):
    client, membership, job = hr_context()
    enterprise = Enterprise.objects.create(
        organization=membership.organization,
        name="不可用企业",
        enabled=change != "disabled",
        deleted_at=timezone.now() if change == "deleted" else None,
    )
    job.enterprise = enterprise
    job.save(update_fields=["enterprise"])
    with patch("recruitment.ai_screening.chat_completion") as complete:
        response = client.post(
            "/api/v1/ai-screenings/", {"job_id": job.id, "resume": "负责产品上线"}, format="json"
        )
    assert response.status_code == 400
    complete.assert_not_called()


def test_enterprise_body_changes_keep_actual_sent_snapshot_and_model_start_time():
    client, membership, job = hr_context()
    enterprise = Enterprise.objects.create(
        organization=membership.organization, name="示例企业", introduction="送模前介绍"
    )
    content = EnterpriseEndorsement.objects.create(
        organization=membership.organization,
        enterprise=enterprise,
        category="team",
        title="原团队资料",
        body="原团队背景",
    )
    job.enterprise = enterprise
    job.save(update_fields=["enterprise"])
    model_started_at = None

    def complete(**kwargs):
        nonlocal model_started_at
        model_started_at = timezone.now().isoformat()
        Enterprise.objects.filter(pk=enterprise.pk).update(introduction="模型等待期间新介绍")
        EnterpriseEndorsement.objects.filter(pk=content.pk).update(body="新团队背景")
        return json.dumps(complete_report())

    with patch("recruitment.ai_screening.chat_completion", side_effect=complete) as called:
        response = client.post(
            "/api/v1/ai-screenings/", {"job_id": job.id, "resume": "负责产品上线"}, format="json"
        )
    assert response.status_code == 200, response.data
    snapshot = response.data["enterprise_snapshot"]
    assert snapshot == json.loads(called.call_args.kwargs["user_text"])["target_enterprise"]
    assert snapshot["introduction"] == "送模前介绍"
    assert snapshot["endorsements"][0]["body"] == "原团队背景"
    assert response.data["source_context"]["captured_at"] <= model_started_at
    assert (
        client.get(f"/api/v1/ai-screenings/{response.data['id']}/").data["enterprise_snapshot"]
        == snapshot
    )


def test_verification_history_is_paginated_and_revoked_role_while_waiting_cannot_write():
    client, membership, _ = hr_context()
    report = create_screening(client)
    url = f"/api/v1/ai-screenings/{report['id']}/verifications/"
    for version in range(12):
        response = client.post(
            url,
            verification_payload(version=version, next_step=f"第{version + 1}次跟进"),
            format="json",
        )
        assert response.status_code == 200
    page = client.get(url, {"question_index": 0, "page": 2}).data
    assert len(page["history"]) == 2 and page["count"] == 12
    assert [item["version"] for item in page["history"]] == [2, 1]
    assert page["items"][0]["version"] == 12
    assert client.get(url, {"question_index": "bad"}).status_code == 400
    calls = 0

    def check_member(request):
        nonlocal calls
        calls += 1
        if calls == 2:
            Membership.objects.filter(pk=membership.pk).update(active=False)
        return _hr_member(request)

    with patch("recruitment.ai_screening._hr_member", side_effect=check_member):
        response = client.post(url, verification_payload(version=12), format="json")
    assert response.status_code == 403 and AIScreeningVerification.objects.count() == 12
