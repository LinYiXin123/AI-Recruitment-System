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
from tests.test_intake import confirm, recruiting, upload
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


def test_legacy_import_preserves_confirmed_profile_fields_and_existing_candidate(team):
    client = client_for(team[2])
    job = recruiting(team)
    batch = client.post(
        "/api/v1/imports/",
        {"request_key": str(uuid.uuid4()), "job": job["id"], "total": 1, "source": ""},
        format="json",
    )
    assert batch.status_code == 201 and batch.data["source"] == ""
    url, item, _ = upload(client, job)
    profile = {
        "current_city": "厦门",
        "education_level": "本科",
        "school": "虚构大学",
        "work_years": "5年",
        "current_salary": "12K",
        "expected_salary": "15K",
        "intended_role": "测试工程师",
        "source": "猎聘",
    }
    first = confirm(client, url, item, **profile)
    assert first.status_code == 200, first.data
    application = Application.objects.get(pk=first.data["application"])
    person = application.candidate
    assert application.source == "猎聘"
    for field, value in profile.items():
        assert getattr(person, field) == value
    assert confirm(client, url, item, **profile).data == first.data

    other_url, other_item, _ = upload(client, job)
    reused = confirm(
        client,
        other_url,
        other_item,
        candidate=person.id,
        identity_note="人工确认同一人",
        current_city="泉州",
        education_level="硕士",
        source="BOSS直聘",
    )
    assert reused.status_code == 200, reused.data
    person.refresh_from_db()
    assert person.current_city == "厦门" and person.education_level == "本科"
    assert person.source == "猎聘" and Candidate.objects.count() == 1


@pytest.mark.parametrize("source_fields,expected", [({}, "虚构验收资料"), ({"source": ""}, "")])
def test_legacy_import_respects_explicitly_blank_source(team, source_fields, expected):
    client = client_for(team[2])
    job = recruiting(team)
    url, item, _ = upload(client, job)
    response = confirm(client, url, item, **source_fields)
    assert response.status_code == 200, response.data
    assert Application.objects.get(pk=response.data["application"]).source == expected


def test_legacy_profile_uses_original_authorized_document(team):
    client = client_for(team[2])
    job = recruiting(team)
    import_url, item, _ = upload(client, job)
    saved = confirm(client, import_url, item)
    person = Application.objects.get(pk=saved.data["application"]).candidate
    Candidate.objects.filter(pk=person.pk).update(creation_payload={})
    url = f"/api/v1/candidates/{person.id}/"
    detail = client.get(url).data
    assert detail["can_edit_profile"]
    response = client.post(
        url + "supplement-profile/",
        {
            "updated_at": detail["updated_at"],
            "parse": item["parse"]["id"],
            "fields": {"education_level": "本科"},
        },
        format="json",
    )
    assert response.status_code == 200 and response.data["education_level"] == "本科"
    ResumeDocument.objects.filter(pk=item["document"]).update(access_state="quarantine")
    assert not client.get(url).data["can_edit_profile"]


def test_supplement_profile_keeps_identity_history_and_checks_updated_at(team):
    client = client_for(team[2])
    uploaded = preview(client).data
    original_body = candidate_payload(uploaded)
    saved = client.post("/api/v1/candidates/", original_body, format="json")
    url = f"/api/v1/candidates/{saved.data['candidate']}/"
    detail = client.get(url).data
    assert detail["can_edit_profile"]
    fields = {"education_level": "硕士", "school": "虚构大学", "source": "智联招聘"}
    payload = {
        "updated_at": detail["updated_at"],
        "parse": uploaded["parse"]["id"],
        "fields": fields,
    }
    invalid_source = client.post(
        url + "supplement-profile/", {**payload, "parse": 99999999}, format="json"
    )
    assert invalid_source.status_code == 400, invalid_source.data
    response = client.post(url + "supplement-profile/", payload, format="json")
    assert response.status_code == 200, response.data
    for field, value in fields.items():
        assert response.data[field] == value
    assert response.data["current_city"] == "泉州"
    assert response.data["display_name"] == original_body["display_name"]
    assert response.data["phone"] == original_body["phone"]
    assert response.data["updated_at"] != detail["updated_at"]
    assert not Application.objects.exists() and not Task.objects.exists()
    assert client.post(url + "supplement-profile/", payload, format="json").status_code == 409
    repeated_creation = client.post("/api/v1/candidates/", original_body, format="json")
    assert repeated_creation.status_code == 200 and repeated_creation.data == saved.data


@pytest.mark.parametrize(
    "fields",
    [
        {"display_name": "不能改身份"},
        {"phone": "13800000001"},
        {"identity_number": "123456789012345678"},
        {"resume_text": "不能改原文"},
        {"remarks": "不能改备注"},
        {"education_level": "未经支持的学历"},
        {"source": "HR 上传"},
        {"current_city": "城" * 121},
    ],
)
def test_supplement_profile_rejects_non_whitelisted_or_invalid_fields(team, fields):
    client = client_for(team[2])
    person = Candidate.objects.create(
        organization=team[0], created_by=team[2], display_name="虚构白名单测试", current_city="厦门"
    )
    url = f"/api/v1/candidates/{person.id}/"
    detail = client.get(url).data
    response = client.post(
        url + "supplement-profile/",
        {
            "updated_at": detail["updated_at"],
            "fields": fields,
        },
        format="json",
    )
    assert response.status_code == 400, response.data
    person.refresh_from_db()
    assert person.current_city == "厦门" and person.display_name == "虚构白名单测试"


def test_supplement_profile_validates_source_access_and_allows_explicit_manual_fields(team):
    client = client_for(team[2])
    uploaded = preview(client).data
    saved = client.post("/api/v1/candidates/", candidate_payload(uploaded), format="json")
    url = f"/api/v1/candidates/{saved.data['candidate']}/"
    detail = client.get(url).data
    body = {
        "updated_at": detail["updated_at"],
        "parse": uploaded["parse"]["id"],
        "fields": {"school": "虚构学校"},
    }
    for membership in [team[3], team[4]]:
        assert client_for(membership).post(
            url + "supplement-profile/", body, format="json"
        ).status_code in [403, 404]
    ResumeDocument.objects.filter(pk=uploaded["document"]).update(access_state="quarantine")
    assert not client.get(url).data["can_edit_profile"]
    assert client.post(url + "supplement-profile/", body, format="json").status_code == 403
    body.pop("parse")
    assert client.post(url + "supplement-profile/", body, format="json").status_code == 403
    person = Candidate.objects.create(
        organization=team[0], created_by=team[2], display_name="虚构人工填写"
    )
    manual_url = f"/api/v1/candidates/{person.id}/"
    body["updated_at"] = client.get(manual_url).data["updated_at"]
    response = client.post(manual_url + "supplement-profile/", body, format="json")
    assert response.status_code == 200 and response.data["school"] == "虚构学校"
    assert response.data["resume_documents"] == []


def test_visible_candidate_does_not_allow_supplement_from_another_jobs_hidden_parse(team):
    client = client_for(team[2])
    uploaded = preview(client).data
    saved = client.post(
        "/api/v1/candidates/", candidate_payload(uploaded, current_salary="18K"), format="json"
    )
    job = recruiting((team[0], team[1], team[4], team[3], team[2]))
    Application.objects.create(
        organization=team[0],
        candidate_id=saved.data["candidate"],
        job_id=job["id"],
        owner=team[4],
        attempt_no=1,
        source="HR 上传",
    )
    url = f"/api/v1/candidates/{saved.data['candidate']}/"
    other = client_for(team[4])
    detail = other.get(url).data
    assert detail["source"] == "" and detail["resume_documents"] == []
    assert detail["current_salary"] == ""
    assert not detail["can_edit_profile"]
    response = other.post(
        url + "supplement-profile/",
        {
            "updated_at": detail["updated_at"],
            "parse": uploaded["parse"]["id"],
            "fields": {"education_level": "硕士"},
        },
        format="json",
    )
    assert response.status_code == 403, response.data
    manual = other.post(
        url + "supplement-profile/",
        {"updated_at": detail["updated_at"], "fields": {"current_salary": ""}},
        format="json",
    )
    assert manual.status_code == 403, manual.data
    assert Candidate.objects.get(pk=saved.data["candidate"]).education_level == "本科"
    assert Candidate.objects.get(pk=saved.data["candidate"]).current_salary == "18K"
    assert Application.objects.get(candidate_id=saved.data["candidate"]).source == "HR 上传"


def test_supplement_source_clear_stays_blank_without_rewriting_application_history(team):
    client = client_for(team[2])
    job = recruiting(team)
    import_url, item, _ = upload(client, job)
    saved = confirm(client, import_url, item, source="BOSS直聘")
    application = Application.objects.get(pk=saved.data["application"])
    url = f"/api/v1/candidates/{application.candidate_id}/"
    detail = client.get(url).data
    response = client.post(
        url + "supplement-profile/",
        {"updated_at": detail["updated_at"], "fields": {"source": ""}},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["source"] == "" and client.get(url).data["source"] == ""
    assert client.get("/api/v1/candidates/").data["results"][0]["source"] == ""
    application.refresh_from_db()
    assert application.source == "BOSS直聘" and application.candidate.source == "未标注"


def test_later_authorized_attachment_does_not_grant_legacy_profile_edit_access(team):
    person = Candidate.objects.create(
        organization=team[0],
        created_by=team[2],
        display_name="虚构历史手工主档",
        current_salary="18K",
    )
    job = recruiting((team[0], team[1], team[4], team[3], team[2]))
    application = Application.objects.create(
        organization=team[0], candidate=person, job_id=job["id"], owner=team[4], attempt_no=1
    )
    document = ResumeDocument.objects.create(
        organization=team[0], candidate=person, uploaded_by=team[4], size=10, file_type="txt"
    )
    parse = ResumeParse.objects.create(
        document=document,
        version=1,
        status="succeeded",
        text="后续应聘的可访问材料",
        actor=team[4],
        request_key=uuid.uuid4(),
    )
    ApplicationResume.objects.create(application=application, parse=parse, assigned_by=team[4])
    client = client_for(team[4])
    url = f"/api/v1/candidates/{person.id}/"
    detail = client.get(url).data
    assert detail["resume_documents"][0]["parse"]["id"] == parse.id
    assert not detail["can_edit_profile"] and detail["current_salary"] == ""
    response = client.post(
        url + "supplement-profile/",
        {
            "updated_at": detail["updated_at"],
            "parse": parse.id,
            "fields": {"current_salary": ""},
        },
        format="json",
    )
    assert response.status_code == 403, response.data
    person.refresh_from_db()
    assert person.current_salary == "18K"


def test_supplement_rechecks_parse_after_locking_source_document(team, monkeypatch):
    from recruitment import intake

    client = client_for(team[2])
    uploaded = preview(client).data
    saved = client.post("/api/v1/candidates/", candidate_payload(uploaded), format="json")
    url = f"/api/v1/candidates/{saved.data['candidate']}/"
    detail = client.get(url).data
    original_data = intake.candidate_data
    calls = 0

    def changed_source(*args, **kwargs):
        nonlocal calls
        result = original_data(*args, **kwargs)
        calls += 1
        if calls == 1:
            intake.create_parse(
                ResumeDocument.objects.get(pk=uploaded["document"]),
                team[2],
                uuid.uuid4(),
                manual="新版本文字，等待重新核对",
            )
        return result

    monkeypatch.setattr(intake, "candidate_data", changed_source)
    response = client.post(
        url + "supplement-profile/",
        {
            "updated_at": detail["updated_at"],
            "parse": uploaded["parse"]["id"],
            "fields": {"education_level": "硕士"},
        },
        format="json",
    )
    assert response.status_code == 409, response.data
    assert Candidate.objects.get(pk=saved.data["candidate"]).education_level == "本科"
