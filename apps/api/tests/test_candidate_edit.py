import uuid

import pytest
from django.utils import timezone

from recruitment.intake import CANDIDATE_FIELDS
from recruitment.models import (
    AIScreening,
    Application,
    ApplicationResume,
    Candidate,
    CandidateEditRequest,
    DepartmentRole,
    Interview,
    ResumeDocument,
    ResumeParse,
    StageEvent,
    Task,
)
from tests import test_jobs
from tests.test_candidate_library import candidate_payload, preview
from tests.test_intake import recruiting
from tests.test_jobs import client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def team():
    return test_jobs.team.__wrapped__()


@pytest.fixture(autouse=True)
def private_files(settings, tmp_path):
    settings.PRIVATE_RESUME_ROOT = tmp_path / "resumes"


def person(client, job=None):
    uploaded = preview(client)
    assert uploaded.status_code == 201, uploaded.data
    saved = client.post(
        "/api/v1/candidates/", candidate_payload(uploaded.data, job=job), format="json"
    )
    assert saved.status_code == 201, saved.data
    url = f"/api/v1/candidates/{saved.data['candidate']}/"
    return url, client.get(url).data


def payload(detail, **changes):
    fields = {field: detail[field] for field in CANDIDATE_FIELDS}
    fields["source"] = detail["source"]
    fields.update(changes)
    applications = detail["applications"]
    selected = applications[0] if applications else None
    return {
        "request_key": str(uuid.uuid4()),
        "updated_at": detail["updated_at"],
        "fields": fields,
        "job": selected["job_id"] if selected else None,
        "application": (
            {
                "id": selected["id"],
                "version": selected["version"],
                "stage": selected["stage"],
                "expected_start_date": selected["expected_start_date"],
            }
            if selected
            else {}
        ),
    }


def test_full_profile_edit_preserves_original_versions_and_replay_is_idempotent(team):
    client = client_for(team[2])
    url, detail = person(client)
    original = ResumeParse.objects.get()
    fields = {
        "display_name": "虚构核对后姓名",
        "phone": "13800000001",
        "email": "candidate@example.com",
        "gender": "女",
        "current_city": "厦门",
        "identity_number": "110101199809280011",
        "birthday": "",
        "intended_role": "测试工程师",
        "education_level": "硕士",
        "school": "虚构大学",
        "work_years": "5年",
        "current_salary": "10K",
        "expected_salary": "12K",
        "source": "BOSS直聘",
        "work_experience": "虚构工作经历",
        "education_experience": "虚构教育经历",
        "remarks": "本人待核实",
        "resume_text": "人工核对后的简历全文。",
    }
    body = payload(detail, **fields)
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code == 200, response.data
    for key, value in fields.items():
        assert response.data[key] == ("1998-09-28" if key == "birthday" else value)
    assert response.data["updated_at"] != detail["updated_at"]
    assert response.data["resume_documents"][0]["is_current"]
    assert response.data["resume_documents"][0]["parse"]["version"] == 2
    original.refresh_from_db()
    assert original.text == detail["resume_text"]
    assert ResumeParse.objects.count() == 2
    assert not Application.objects.exists()
    assert client.post(url + "edit/", body, format="json").status_code == 200
    assert CandidateEditRequest.objects.count() == 1 and ResumeParse.objects.count() == 2
    altered = {**body, "fields": {**body["fields"], "remarks": "改变已使用请求"}}
    assert client.post(url + "edit/", altered, format="json").status_code == 409
    assert (
        client.post(
            url + "edit/", {**body, "request_key": str(uuid.uuid4())}, format="json"
        ).status_code
        == 409
    )


def test_edit_application_stage_updates_task_once_and_cannot_reopen_closed_record(team):
    client = client_for(team[2])
    url, detail = person(client, recruiting(team)["id"])
    body = payload(detail, source="猎聘")
    body["application"].update(stage="ready_to_schedule", expected_start_date="2027-01-01")
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code == 200, response.data
    application = Application.objects.get()
    assert application.stage == "ready_to_schedule" and application.version == 2
    assert str(application.expected_start_date) == "2027-01-01"
    assert application.source == ""  # 主档的渠道更正不改写已有应聘的来源。
    assert Task.objects.get(status="pending").kind == "schedule"
    assert client.post(url + "edit/", body, format="json").status_code == 200
    assert StageEvent.objects.count() == 2 and Task.objects.filter(status="pending").count() == 1
    closed = payload(response.data)
    closed["application"]["stage"] = "closed"
    response = client.post(url + "edit/", closed, format="json")
    assert response.status_code == 200, response.data
    application.refresh_from_db()
    assert application.closed_at and not Task.objects.filter(status="pending").exists()
    reopened = payload(response.data)
    reopened["application"]["stage"] = "pending_review"
    assert client.post(url + "edit/", reopened, format="json").status_code == 409


@pytest.mark.parametrize("include_fields", [False, True])
def test_stage_only_edit_preserves_all_profile_fields_including_legacy_source(team, include_fields):
    client = client_for(team[2])
    url, detail = person(client, recruiting(team)["id"])
    Candidate.objects.filter(pk=detail["id"]).update(source="历史自定义渠道")
    before = Candidate.objects.values(*CANDIDATE_FIELDS, "source").get(pk=detail["id"])
    body = payload(detail)
    body["fields"] = {}
    if not include_fields:
        del body["fields"]
    body["application"]["stage"] = "ready_to_schedule"
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code == 200, response.data
    assert Candidate.objects.values(*CANDIDATE_FIELDS, "source").get(pk=detail["id"]) == before
    assert Application.objects.get().stage == "ready_to_schedule"


def test_changing_job_adds_application_and_resume_link_without_rewriting_old_application(team):
    client = client_for(team[2])
    first = recruiting(team)
    second = recruiting(team)
    url, detail = person(client, first["id"])
    before = list(Application.objects.values())
    body = payload(detail)
    body["job"] = second["id"]
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code == 200, response.data
    assert list(Application.objects.filter(job_id=first["id"]).values()) == before
    assert Application.objects.count() == ApplicationResume.objects.count() == 2
    assert client.post(url + "edit/", body, format="json").status_code == 200
    duplicate = payload(response.data)
    duplicate["application"] = body["application"]
    assert client.post(url + "edit/", duplicate, format="json").status_code == 409
    assert Application.objects.count() == 2


def test_reupload_is_current_and_correction_stays_scoped_to_selected_application(team):
    client = client_for(team[2])
    first = recruiting(team)
    url, detail = person(client, first["id"])
    original = ResumeParse.objects.get()
    other_job = recruiting((team[0], team[1], team[4], team[3], team[2]))
    other_app = Application.objects.create(
        organization=team[0],
        candidate_id=detail["id"],
        job_id=other_job["id"],
        owner=team[4],
        attempt_no=1,
        source="另一次应聘",
    )
    ApplicationResume.objects.create(application=other_app, parse=original, assigned_by=team[2])
    replacement = preview(client, b"Replacement resume text").data
    body = payload(detail, resume_text="人工修订新版原文", remarks="仅新材料授权范围可见")
    body.update(resume_document=replacement["document"], resume_parse=replacement["parse"]["id"])
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code == 200, response.data
    current = next(doc for doc in response.data["resume_documents"] if doc["is_current"])
    assert current["document"] == replacement["document"]
    assert current["parse"]["text"] == body["fields"]["resume_text"]
    assert client.post(url + "edit/", body, format="json").status_code == 200
    assert ResumeDocument.objects.count() == 2 and ResumeParse.objects.count() == 3
    assert other_app.resumes.get().parse_id == original.id
    other = client_for(team[4])
    other_detail = other.get(url).data
    assert not other_detail["can_edit_profile"]
    assert other_detail["resume_text"] == other_detail["remarks"] == ""
    assert len(other_detail["resume_documents"]) == 1
    assert other_detail["resume_documents"][0]["parse"]["id"] == original.id
    assert other.post(url + "edit/", payload(other_detail), format="json").status_code == 403


@pytest.mark.parametrize(
    "failure",
    [
        "outsider",
        "manager",
        "quarantine",
        "stale_app",
        "foreign_doc",
        "active_interview",
        "duplicate_identity",
    ],
)
def test_edit_failure_leaves_candidate_application_and_documents_unchanged(team, failure):
    client = client_for(team[2])
    url, detail = person(client, recruiting(team)["id"])
    body = payload(detail, remarks="不能在失败时保存")
    expected = [403, 404]
    if failure in ["outsider", "manager"]:
        client = client_for(team[4] if failure == "outsider" else team[3])
    elif failure == "quarantine":
        ResumeDocument.objects.update(access_state="quarantine")
    elif failure == "stale_app":
        body["application"]["version"] += 1
        expected = [409]
    elif failure == "foreign_doc":
        foreign = preview(client_for(team[4])).data
        body.update(resume_document=foreign["document"], resume_parse=foreign["parse"]["id"])
        body["application"]["stage"] = "ready_to_schedule"
    elif failure == "active_interview":
        Interview.objects.create(
            organization=team[0],
            application_id=body["application"]["id"],
            organizer=team[2],
            round_no=1,
            purpose="待安排",
            request_key=uuid.uuid4(),
        )
        body["application"]["stage"] = "closed"
        expected = [409]
    elif failure == "duplicate_identity":
        Candidate.objects.create(
            organization=team[0], created_by=team[2], display_name="同名需核对", phone="13900000000"
        )
        body["fields"]["phone"] = "13900000000"
        expected = [409]
    before = list(Candidate.objects.values()), list(Application.objects.values())
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code in expected, response.data
    assert (list(Candidate.objects.values()), list(Application.objects.values())) == before
    assert not CandidateEditRequest.objects.exists()


def test_details_only_include_authorized_interviews_and_private_ai_reports(team):
    client = client_for(team[2])
    url, detail = person(client, recruiting(team)["id"])
    app = Application.objects.get()
    other_job = recruiting((team[0], team[1], team[4], team[3], team[2]))
    hidden = Application.objects.create(
        organization=team[0],
        candidate=app.candidate,
        job_id=other_job["id"],
        owner=team[4],
        attempt_no=1,
        source="私有职位",
    )
    for application in [app, hidden]:
        Interview.objects.create(
            organization=team[0],
            application=application,
            organizer=application.owner,
            round_no=1,
            purpose="历史面试",
            status="completed",
            completed_at=timezone.now(),
            request_key=uuid.uuid4(),
        )
    for application, creator in [(app, team[2]), (app, team[4]), (hidden, team[2])]:
        AIScreening.objects.create(
            organization=team[0],
            creator=creator,
            application=application,
            job=application.job,
            request_key=uuid.uuid4(),
            input_digest="test-only",
            candidate_name="虚构测试甲",
            job_title=application.job.title,
            result={"summary": "应按授权隔离", "questions": []},
        )
    detail = client.get(url).data
    assert detail["interview_count"] == detail["ai_screening_count"] == 1
    assert detail["interview_records"][0]["application"] == app.id
    assert detail["ai_screenings"][0]["application_id"] == app.id


def test_original_inline_view_keeps_download_permission_and_safe_content_type(team):
    client = client_for(team[2])
    _, detail = person(client)
    document = detail["resume_documents"][0]["document"]
    url = f"/api/v1/documents/{document}/download/?inline=1"
    assert client.get(url).status_code == 403
    DepartmentRole.objects.create(membership=team[2], department=team[1], role="resume_download")
    response = client.get(url)
    assert response.status_code == 200
    assert response["Content-Disposition"].startswith("inline;")
    assert response["Content-Type"] == "text/plain; charset=utf-8"
    assert response["X-Content-Type-Options"] == "nosniff"
    response.close()


@pytest.mark.parametrize(
    "fields",
    [
        {"organization": 999},
        {"phone": "not-a-phone"},
        {"birthday": "2026-02-31"},
        {"source": "未经支持的新渠道"},
    ],
)
def test_partial_profile_edit_validates_fields_before_any_write(team, fields):
    client = client_for(team[2])
    url, detail = person(client)
    body = payload(detail)
    body["fields"] = fields
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code == 400, response.data
    assert not CandidateEditRequest.objects.exists()
    assert Candidate.objects.get().updated_at == detail["updated_at"]


def test_partial_profile_edit_keeps_unspecified_fields_and_can_clear_resume_text(team):
    client = client_for(team[2])
    url, detail = person(client)
    body = payload(detail)
    body["fields"] = {"remarks": "人工核对补充", "resume_text": ""}
    response = client.post(url + "edit/", body, format="json")
    assert response.status_code == 200, response.data
    assert response.data["phone"] == detail["phone"]
    assert response.data["current_city"] == detail["current_city"]
    assert response.data["resume_text"] == ""
    assert response.data["resume_documents"][0]["parse"]["status"] == "failed"
    assert ResumeParse.objects.count() == 2


def test_stage_only_edit_never_rewrites_or_assigns_another_applications_material(team):
    client = client_for(team[2])
    first, second = recruiting(team), recruiting(team)
    url, detail = person(client, first["id"])
    old_application = detail["applications"][0]
    body = payload(detail)
    body["job"] = second["id"]
    created = client.post(url + "edit/", body, format="json")
    assert created.status_code == 200, created.data
    replacement = preview(client, b"New application material only").data
    body = payload(created.data)
    body["fields"] = {}
    body.update(resume_document=replacement["document"], resume_parse=replacement["parse"]["id"])
    replaced = client.post(url + "edit/", body, format="json")
    assert replaced.status_code == 200, replaced.data
    assert replaced.data["resume_text"] == replacement["parse"]["text"]
    Candidate.objects.filter(pk=detail["id"]).update(resume_text="")  # 兼容只有附件文字的旧档。
    body = payload(replaced.data)
    body["fields"] = {}
    body["job"] = first["id"]
    body["application"] = {
        "id": old_application["id"],
        "version": old_application["version"],
        "stage": "ready_to_schedule",
    }
    before = list(ApplicationResume.objects.order_by("id").values()), ResumeParse.objects.count()
    changed = client.post(url + "edit/", body, format="json")
    assert changed.status_code == 200, changed.data
    assert (
        list(ApplicationResume.objects.order_by("id").values()),
        ResumeParse.objects.count(),
    ) == before
    assert changed.data["resume_text"] == replacement["parse"]["text"]
    assert Candidate.objects.get(pk=detail["id"]).resume_text == ""
