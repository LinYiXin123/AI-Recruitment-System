import io
import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from recruitment.models import (
    Application,
    ApplicationResume,
    Candidate,
    Department,
    DepartmentRole,
    Organization,
    ResumeDocument,
    ResumeParse,
    Task,
)
from tests import test_jobs
from tests.test_intake import recruiting
from tests.test_jobs import actor, client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def team():
    return test_jobs.team.__wrapped__()


@pytest.fixture(autouse=True)
def private_files(settings, tmp_path):
    settings.PRIVATE_RESUME_ROOT = tmp_path / "resumes"


def pdf(text="Name: Test Candidate; Phone: 13800000000"):
    writer = PdfWriter()
    page = writer.add_blank_page(width=500, height=500)
    if text:
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        contents = DecodedStreamObject()
        contents.set_data(f"BT /F1 12 Tf 20 450 Td ({text}) Tj ET".encode())
        page[NameObject("/Contents")] = contents
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def preview(client, raw=None, filename="虚构简历.txt", key=None):
    return client.post(
        "/api/v1/candidates/preview-resume/",
        {
            "request_key": key or str(uuid.uuid4()),
            "file": SimpleUploadedFile(
                filename,
                raw if raw is not None else "姓名：虚构测试甲\n手机：13800000000".encode(),
            ),
        },
        format="multipart",
    )


def candidate_payload(preview_data, **changes):
    return {
        "request_key": str(uuid.uuid4()),
        "display_name": "虚构测试甲",
        "phone": "13800000000",
        "resume_document": preview_data["document"],
        "resume_parse": preview_data["parse"]["id"],
        "resume_text": preview_data["parse"]["text"],
        "current_city": "泉州",
        "education_level": "本科",
        "work_years": "4年",
        "expected_salary": "12-15K · 13薪",
        **changes,
    }


@pytest.mark.parametrize("kind", ["txt", "pdf"])
@pytest.mark.django_db(transaction=True)
def test_preview_then_save_without_job_or_source_and_read_authorized_attachment(team, kind):
    client = client_for(team[2])
    raw = "姓名：虚构测试甲\n手机：13800000000".encode() if kind == "txt" else pdf()
    uploaded = preview(client, raw, f"虚构简历.{kind}")
    assert uploaded.status_code == 201, uploaded.data
    assert uploaded.data["parse"]["status"] == "succeeded"
    assert "13800000000" in uploaded.data["parse"]["text"]
    assert not Candidate.objects.exists() and not Application.objects.exists()

    body = candidate_payload(uploaded.data)
    saved = client.post("/api/v1/candidates/", body, format="json")
    assert saved.status_code == 201, saved.data
    assert saved.data["application"] is None and not Application.objects.exists()
    assert not Task.objects.exists()
    person = Candidate.objects.get(pk=saved.data["candidate"])
    assert person.created_by_id == team[2].id
    assert person.resume_text == body["resume_text"] and person.source == ""
    row = client.get("/api/v1/candidates/").data["results"][0]
    for field in [
        "display_name",
        "current_city",
        "education_level",
        "work_years",
        "expected_salary",
    ]:
        assert row[field] == body[field]
    assert row["applications"] == []
    assert client.get("/api/v1/candidates/?stage=pending_review").data["count"] == 1
    detail_url = f"/api/v1/candidates/{person.id}/"
    detail = client.get(detail_url)
    assert detail.status_code == 200
    document = detail.data["resume_documents"][0]
    assert document["document"] == uploaded.data["document"] and not document["download"]
    assert document["parse"]["text"] == body["resume_text"]
    download = f"/api/v1/documents/{document['document']}/download/"
    assert client.get(download).status_code == 403
    grant = DepartmentRole.objects.create(
        membership=team[2], department=team[1], role="resume_download"
    )
    assert client.get(detail_url).data["resume_documents"][0]["download"]
    response = client.get(download)
    assert response.status_code == 200
    assert "no-store" in response["Cache-Control"]
    assert response["X-Content-Type-Options"] == "nosniff"
    assert b"".join(response.streaming_content) == raw
    response.close()
    grant.delete()
    assert client.get(download).status_code == 403


def test_preview_and_save_retries_are_idempotent_but_changed_content_conflicts(team):
    client = client_for(team[2])
    key = str(uuid.uuid4())
    uploaded = preview(client, key=key)
    assert uploaded.status_code == 201
    replay = preview(client, key=key)
    assert replay.status_code == 200 and replay.data == uploaded.data
    assert ResumeDocument.objects.count() == ResumeParse.objects.count() == 1
    assert preview(client, b"changed text", key=key).status_code == 409
    body = candidate_payload(uploaded.data)
    saved = client.post("/api/v1/candidates/", body, format="json")
    assert saved.status_code == 201, saved.data
    repeated = client.post("/api/v1/candidates/", body, format="json")
    assert repeated.status_code == 200 and repeated.data == saved.data
    assert Candidate.objects.count() == 1
    for changes in [{"current_city": "厦门"}, {"source": "内推"}, {"phone": "13800000001"}]:
        assert (
            client.post("/api/v1/candidates/", {**body, **changes}, format="json").status_code
            == 409
        )
    rebound = {**body, "request_key": str(uuid.uuid4()), "display_name": "虚构测试乙"}
    assert client.post("/api/v1/candidates/", rebound, format="json").status_code == 404
    assert Candidate.objects.count() == ResumeDocument.objects.count() == 1


def test_other_hr_other_organization_and_manager_cannot_read_or_claim_private_candidate(team):
    client = client_for(team[2])
    uploaded = preview(client).data
    saved = client.post("/api/v1/candidates/", candidate_payload(uploaded), format="json")
    assert saved.status_code == 201, saved.data
    unbound = preview(client).data
    org = Organization.objects.create(name="其他测试组织")
    department = Department.objects.create(organization=org, name="其他部门")
    foreign = actor(org, department, "hr", "foreign")
    for membership in [team[4], team[3], foreign]:
        department = team[1] if membership.organization_id == team[0].id else department
        DepartmentRole.objects.create(
            membership=membership, department=department, role="resume_download"
        )
        other = client_for(membership)
        assert other.get("/api/v1/candidates/").data["count"] == 0
        assert other.get(f"/api/v1/candidates/{saved.data['candidate']}/").status_code == 404
        assert other.get(f"/api/v1/documents/{uploaded['document']}/download/").status_code in [
            403,
            404,
        ]
        attempt = other.post("/api/v1/candidates/", candidate_payload(unbound), format="json")
        assert attempt.status_code in [403, 404], attempt.data
    assert Candidate.objects.count() == 1
    assert ResumeDocument.objects.get(pk=unbound["document"]).candidate_id is None


@pytest.mark.parametrize("revocation", ["hr_role", "membership", "user"])
def test_revoked_creator_cannot_read_download_preview_or_save(team, revocation):
    client = client_for(team[2])
    key = str(uuid.uuid4())
    uploaded = preview(client, key=key).data
    body = candidate_payload(uploaded)
    saved = client.post("/api/v1/candidates/", body, format="json")
    assert saved.status_code == 201, saved.data
    DepartmentRole.objects.create(membership=team[2], department=team[1], role="resume_download")
    if revocation == "hr_role":
        team[2].roles.filter(role="hr").delete()
    elif revocation == "membership":
        team[2].active = False
        team[2].save(update_fields=["active"])
    else:
        team[2].user.is_active = False
        team[2].user.save(update_fields=["is_active"])
    listing = client.get("/api/v1/candidates/")
    assert listing.status_code == 403 or listing.data["count"] == 0
    assert client.get(f"/api/v1/candidates/{saved.data['candidate']}/").status_code in [403, 404]
    assert client.get(f"/api/v1/documents/{uploaded['document']}/download/").status_code == 403
    assert preview(client, key=key).status_code == 403
    assert client.post("/api/v1/candidates/", body, format="json").status_code == 403
    assert Candidate.objects.count() == 1


def test_failed_pdf_can_be_saved_after_manual_correction_without_losing_original(team):
    client = client_for(team[2])
    uploaded = preview(client, pdf(""), "扫描件.pdf")
    assert uploaded.status_code == 201, uploaded.data
    assert uploaded.data["parse"]["status"] == "failed" and uploaded.data["parse"]["error"]
    text = "人工核对：虚构测试甲，四年工作经验，内容待本人核实。"
    saved = client.post(
        "/api/v1/candidates/",
        candidate_payload(uploaded.data, resume_text=text),
        format="json",
    )
    assert saved.status_code == 201, saved.data
    assert saved.data["application"] is None
    document = client.get(f"/api/v1/candidates/{saved.data['candidate']}/").data[
        "resume_documents"
    ][0]
    assert document["parse"]["status"] == "succeeded"
    assert document["parse"]["parser_version"] == "人工摘录"
    assert document["parse"]["text"] == text and document["parse"]["version"] == 2
    assert ResumeParse.objects.get(pk=uploaded.data["parse"]["id"]).status == "failed"
    assert ResumeDocument.objects.count() == 1


def test_invalid_preview_stale_parse_and_quarantined_attachment_are_rejected(team):
    client = client_for(team[2])
    assert preview(client, b"not a pdf", "invalid.pdf").status_code == 400
    assert preview(client, b"x" * (10 * 1024 * 1024 + 1)).status_code == 400
    assert not ResumeDocument.objects.exists()
    uploaded = preview(client).data
    body = candidate_payload(uploaded)
    assert (
        client.post(
            "/api/v1/candidates/", {**body, "stage": "talent_pool"}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/candidates/",
            {**body, "resume_parse": uploaded["parse"]["id"] + 1},
            format="json",
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/v1/candidates/", {**body, "resume_parse": None}, format="json"
        ).status_code
        == 400
    )
    ResumeDocument.objects.filter(pk=uploaded["document"]).update(access_state="quarantine")
    assert client.post("/api/v1/candidates/", body, format="json").status_code == 404
    assert not Candidate.objects.exists()


@pytest.mark.parametrize("add_job_later", [False, True])
@pytest.mark.django_db(transaction=True)
def test_attachment_follows_only_authorized_application_and_download_requires_grant(
    team, add_job_later
):
    client = client_for(team[2])
    job = recruiting(team)
    uploaded = preview(client).data
    body = candidate_payload(uploaded, **({} if add_job_later else {"job": job["id"]}))
    saved = client.post("/api/v1/candidates/", body, format="json")
    assert saved.status_code == 201, saved.data
    application = saved.data["application"]
    if add_job_later:
        attached = client.post(
            f"/api/v1/candidates/{saved.data['candidate']}/apply/",
            {"request_key": str(uuid.uuid4()), "job": job["id"], "source": "人工核对后加入"},
            format="json",
        )
        assert attached.status_code == 200, attached.data
        application = attached.data["application"]
    assert Application.objects.count() == ApplicationResume.objects.count() == 1
    link = ApplicationResume.objects.get()
    assert link.application_id == application and link.parse_id == uploaded["parse"]["id"]
    documents = client.get(f"/api/v1/applications/{application}/").data["resumes"]
    assert documents[0]["document"] == uploaded["document"] and not documents[0]["download"]
    download = f"/api/v1/documents/{uploaded['document']}/download/"
    assert client.get(download).status_code == 403
    DepartmentRole.objects.create(membership=team[2], department=team[1], role="resume_download")
    response = client.get(download)
    assert response.status_code == 200
    response.close()
    DepartmentRole.objects.create(membership=team[4], department=team[1], role="resume_download")
    assert client_for(team[4]).get(download).status_code == 403


def test_quarantined_source_cannot_leak_copied_resume_text_through_candidate_detail(team):
    client = client_for(team[2])
    uploaded = preview(client).data
    body = candidate_payload(
        uploaded,
        work_experience="附件中的工作经历",
        education_experience="附件中的教育经历",
        remarks="附件中的备注",
    )
    saved = client.post("/api/v1/candidates/", body, format="json")
    assert saved.status_code == 201, saved.data
    url = f"/api/v1/candidates/{saved.data['candidate']}/"
    assert client.get(url).data["resume_text"] == body["resume_text"]
    ResumeDocument.objects.filter(pk=uploaded["document"]).update(access_state="quarantine")
    detail = client.get(url)
    assert detail.status_code == 200
    assert detail.data["resume_documents"][0]["parse"] is None
    for field in ["resume_text", "work_experience", "education_experience", "remarks"]:
        assert not detail.data[field]
    assert client.get(f"/api/v1/documents/{uploaded['document']}/download/").status_code == 404
    person = Candidate.objects.get(pk=saved.data["candidate"])
    assert person.resume_text == body["resume_text"]  # 拒绝读取不应删除已保存的原始记录。


def test_other_job_visibility_does_not_grant_access_to_unassigned_source_text(team):
    client = client_for(team[2])
    uploaded = preview(client).data
    saved = client.post("/api/v1/candidates/", candidate_payload(uploaded), format="json")
    assert saved.status_code == 201, saved.data
    job = recruiting((team[0], team[1], team[4], team[3], team[2]))
    Application.objects.create(
        organization=team[0],
        candidate_id=saved.data["candidate"],
        job_id=job["id"],
        owner=team[4],
        attempt_no=1,
        source="另一个职位授权范围",
    )
    other = client_for(team[4])
    detail = other.get(f"/api/v1/candidates/{saved.data['candidate']}/")
    assert detail.status_code == 200
    assert detail.data["resume_documents"] == []
    assert not detail.data["resume_text"]
