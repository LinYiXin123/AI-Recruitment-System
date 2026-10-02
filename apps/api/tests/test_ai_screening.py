import io
import json
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection
from django.test import override_settings
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from rest_framework.test import APIClient

from recruitment.ai_screening import _hr_member, _parse_analysis
from recruitment.models import (
    AIScreening,
    Application,
    Candidate,
    Department,
    DepartmentRole,
    Job,
    Membership,
    Organization,
    QuestionTemplate,
    QuestionTemplateEvent,
    ResumeDocument,
    ResumeParse,
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
    assert response.data["questions"] == model_result["questions"]
    sent_context = json.loads(complete.call_args.kwargs["user_text"])
    assert sent_context["resume"] == resume
    assert sent_context["target_job"]["title"] == "产品经理"
    assert sent_context["target_job"]["description"] == job.jd
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


def test_question_details_preserve_legacy_questions_and_discard_invalid_fields_and_quotes():
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

    assert result["questions"] == [
        {
            "question": "如何验证上线效果？",
            "reason": "结果验证。",
            "follow_up": "",
            "answer_points": [],
            "quote": "",
        },
        {
            "question": "如何划分团队职责？",
            "reason": "",
            "follow_up": "",
            "answer_points": ["说明本人职责与交付物。"],
            "quote": "与研发团队\n完成上线",
        },
        {
            "question": "有无量化结果？",
            "reason": "",
            "follow_up": "请提供数据来源。",
            "answer_points": [],
            "quote": "",
        },
    ]


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
        assert response.data["match_score"] == result["match_score"]
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


@pytest.mark.parametrize("score", [True, "90", -1, 101, float("nan"), None])
def test_invalid_or_unverifiable_scores_are_not_published(score):
    report = {**complete_report(), "match_score": score, "conclusion": "建议录用"}
    parsed = _parse_analysis(json.dumps(report), "负责产品上线", has_job=True)
    assert parsed["match_score"] is None
    assert parsed["conclusion"] == "待复核"
    valid = complete_report()
    assert _parse_analysis(json.dumps(valid), "未提供项目证据", has_job=True)["match_score"] is None
    generic = _parse_analysis(json.dumps(valid), "负责产品上线")
    assert generic["match_score"] is None and generic["conclusion"] == "通用初判"


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
    assert first.data["match_score"] == 73
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


def test_saving_questions_rolls_back_earlier_questions_when_later_question_is_invalid():
    client, _, _ = hr_context()
    result = complete_report()
    result["questions"].append({"question": "缺少追问与答案要点", "reason": "待完善"})
    with patch("recruitment.ai_screening.chat_completion", return_value=json.dumps(result)):
        report = client.post(
            "/api/v1/ai-screenings/", {"resume": "负责产品上线"}, format="json"
        ).data
    url = f"/api/v1/ai-screenings/{report['id']}/"
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
