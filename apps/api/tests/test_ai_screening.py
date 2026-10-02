import io
import json
import zipfile
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from rest_framework.test import APIClient

from recruitment.models import (
    Application,
    Candidate,
    Department,
    DepartmentRole,
    Job,
    Membership,
    Organization,
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
        "questions": [{"question": "上线后如何验证效果？", "reason": "核实结果评估方式。"}],
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
    assert response.data["questions"][0]["question"] == "上线后如何验证效果？"
    sent_context = json.loads(complete.call_args.kwargs["user_text"])
    assert sent_context["resume"] == resume
    assert sent_context["target_job"]["title"] == "产品经理"
    assert sent_context["target_job"]["description"] == job.jd
    assert complete.call_args.kwargs["max_tokens"] == 393_216
    assert complete.call_args.kwargs["thinking"] == {"type": "disabled"}
    assert complete.call_args.kwargs["response_format"] == {"type": "json_object"}


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


def test_selected_application_uses_its_authorized_job_without_sending_candidate_name():
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
    result = {"summary": "需人工复核。", "evidence": [], "gaps": [], "questions": []}
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(result)
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {"application_id": application.id, "resume": "独立负责过产品上线。"},
            format="json",
        )

    assert response.status_code == 200
    sent_context = json.loads(complete.call_args.kwargs["user_text"])
    assert sent_context["target_job"]["title"] == "产品经理"
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
