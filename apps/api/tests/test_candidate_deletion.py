import uuid

import pytest
from django.utils import timezone

from recruitment import intake
from recruitment.models import (
    Application,
    AuditEvent,
    Candidate,
    DepartmentRole,
    Interview,
    Organization,
    ResumeDocument,
    ResumeParse,
    Task,
)
from tests import test_jobs
from tests.test_candidate_library import candidate_payload, preview
from tests.test_intake import confirm, recruiting, review, upload
from tests.test_jobs import actor, client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def team():
    return test_jobs.team.__wrapped__()


@pytest.fixture(autouse=True)
def private_files(settings, tmp_path):
    settings.PRIVATE_RESUME_ROOT = tmp_path / "resumes"


def test_standalone_delete_hides_profile_and_blocks_reuse_without_erasing_history(team):
    client = client_for(team[2])
    upload_key = str(uuid.uuid4())
    uploaded = preview(client, key=upload_key).data
    payload = candidate_payload(uploaded)
    saved = client.post("/api/v1/candidates/", payload, format="json")
    url = f"/api/v1/candidates/{saved.data['candidate']}/"
    row = client.get("/api/v1/candidates/").data["results"][0]
    assert row["can_delete"] and row["updated_at"]
    body = {"updated_at": row["updated_at"]}
    response = client.delete(url, body, format="json")
    assert response.status_code == 200 and response.data == {"deleted": True}
    person = Candidate.objects.get(pk=saved.data["candidate"])
    assert person.deleted_at and person.deleted_by_id == team[2].id
    assert person.display_name == payload["display_name"]
    assert client.get("/api/v1/candidates/").data["count"] == 0
    assert client.get(url).status_code == 404
    assert client.post(url + "supplement-profile/", {}, format="json").status_code == 404
    assert client.post(url + "apply/", {}, format="json").status_code == 404
    assert client.post("/api/v1/candidates/", payload, format="json").status_code == 404
    assert preview(client, key=upload_key).status_code == 404
    assert client.delete(url, body, format="json").status_code == 200
    person.refresh_from_db()
    assert person.deleted_at and not Application.objects.exists()
    doc = ResumeDocument.objects.get(pk=uploaded["document"])
    assert intake.file_path(doc).exists() and ResumeParse.objects.filter(document=doc).exists()
    DepartmentRole.objects.create(membership=team[2], department=team[1], role="resume_download")
    assert client.get(f"/api/v1/documents/{doc.id}/download/").status_code == 403

    job = recruiting(team)
    import_url, item, _ = upload(client, job)
    matches = client.post(
        f"{import_url}items/{item['id']}/matches/",
        {"display_name": payload["display_name"], "phone": payload["phone"]},
        format="json",
    )
    assert matches.status_code == 200 and matches.data["count"] == 0
    reused = confirm(
        client, import_url, item, candidate=person.id, identity_note="旧页面仍持有已删除编号"
    )
    assert reused.status_code == 404 and Candidate.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_delete_keeps_active_application_interview_materials_and_followup_working(team):
    client = client_for(team[2])
    job = recruiting(team)
    import_url, item, _ = upload(client, job)
    saved = confirm(client, import_url, item)
    application = Application.objects.get(pk=saved.data["application"])
    interview = Interview.objects.create(
        organization=team[0],
        application=application,
        round_no=1,
        purpose="虚构面试记录",
        request_key=uuid.uuid4(),
        organizer=team[2],
    )
    url = f"/api/v1/candidates/{application.candidate_id}/"
    detail = client.get(url).data
    tasks = list(Task.objects.filter(application=application).values("id", "status"))
    result = client.delete(url, {"updated_at": detail["updated_at"]}, format="json")
    assert result.status_code == 200, result.data
    application.refresh_from_db()
    assert application.stage == "pending_review" and application.closed_at is None
    assert Interview.objects.get(pk=interview.pk).status == "unscheduled"
    assert list(Task.objects.filter(application=application).values("id", "status")) == tasks
    assert AuditEvent.objects.filter(application=application, action="从候选人库删除").count() == 1
    assert client.get("/api/v1/dashboard/").data["metrics"]["talent_pool_total"] == 0
    assert client.get("/api/v1/applications/").data["count"] == 1
    app_url = f"/api/v1/applications/{application.id}/"
    app_detail = client.get(app_url)
    assert app_detail.status_code == 200 and app_detail.data["resumes"][0]["parse"]
    DepartmentRole.objects.create(membership=team[2], department=team[1], role="resume_download")
    downloaded = client.get(f"/api/v1/documents/{item['document']}/download/")
    assert downloaded.status_code == 200
    downloaded.close()

    next_import, next_item, _ = upload(client, job)
    supplemented = confirm(
        client,
        next_import,
        next_item,
        candidate=application.candidate_id,
        application=application.id,
        identity_note="补充原应聘的已有材料，不重建候选人",
    )
    assert supplemented.status_code == 200, supplemented.data
    assert application.resumes.count() == 2 and Application.objects.count() == 1
    assert review(client, client.get(app_url).data, "advance").status_code == 200
    application.refresh_from_db()
    assert application.stage == "ready_to_schedule"
    assert Candidate.objects.get(pk=application.candidate_id).deleted_at


def test_delete_rejects_stale_updated_at_without_losing_edits(team):
    person = Candidate.objects.create(
        organization=team[0], created_by=team[2], display_name="虚构删除版本校验"
    )
    client = client_for(team[2])
    url = f"/api/v1/candidates/{person.pk}/"
    original = client.get(url).data
    edited = client.post(
        url + "supplement-profile/",
        {"updated_at": original["updated_at"], "fields": {"school": "人工新核对学校"}},
        format="json",
    )
    assert edited.status_code == 200
    assert client.delete(url, {}, format="json").status_code == 400
    stale = client.delete(url, {"updated_at": original["updated_at"]}, format="json")
    assert stale.status_code == 409
    person.refresh_from_db()
    assert person.deleted_at is None and person.school == "人工新核对学校"
    assert (
        client.delete(url, {"updated_at": edited.data["updated_at"]}, format="json").status_code
        == 200
    )


@pytest.mark.parametrize("role", ["manager", "other_hr", "other_org", "revoked"])
def test_delete_rechecks_membership_and_candidate_scope(team, role):
    person = Candidate.objects.create(
        organization=team[0], created_by=team[2], display_name="虚构删除权限校验"
    )
    membership = {"manager": team[3], "other_hr": team[4], "revoked": team[2]}.get(role)
    if role == "other_org":
        other_org = Organization.objects.create(name="另一个虚构组织")
        membership = actor(other_org, username="other-org-member")
    if role == "revoked":
        DepartmentRole.objects.filter(membership=team[2], role="hr").delete()
    response = client_for(membership).delete(
        f"/api/v1/candidates/{person.pk}/", {"updated_at": person.updated_at}, format="json"
    )
    assert response.status_code in [403, 404], response.data
    person.refresh_from_db()
    assert person.deleted_at is None


@pytest.mark.parametrize("restriction", ["other_job", "source_quarantine"])
def test_delete_requires_original_material_and_all_related_job_permissions(team, restriction):
    client = client_for(team[2])
    job = recruiting(team)
    import_url, item, _ = upload(client, job)
    saved = confirm(client, import_url, item)
    application = Application.objects.get(pk=saved.data["application"])
    if restriction == "other_job":
        other_job = recruiting((team[0], team[1], team[4], team[3], team[2]))
        Application.objects.create(
            organization=team[0],
            candidate=application.candidate,
            job_id=other_job["id"],
            owner=team[4],
            attempt_no=1,
        )
    else:
        ResumeDocument.objects.filter(pk=item["document"]).update(access_state="quarantine")
    url = f"/api/v1/candidates/{application.candidate_id}/"
    detail = client.get(url).data
    assert not detail["can_delete"]
    assert not client.get("/api/v1/candidates/").data["results"][0]["can_delete"]
    response = client.delete(url, {"updated_at": detail["updated_at"]}, format="json")
    assert response.status_code == 403, response.data
    assert Candidate.objects.get(pk=application.candidate_id).deleted_at is None


def test_application_entry_rechecks_deletion_after_lock_instead_of_using_stale_object(
    team, monkeypatch
):
    client = client_for(team[2])
    job = recruiting(team)
    person = Candidate.objects.create(
        organization=team[0], created_by=team[2], display_name="虚构并发删除"
    )
    original_get = intake.CandidateViewSet.get_object

    def delete_after_read(view):
        result = original_get(view)
        Candidate.objects.filter(pk=result.pk).update(deleted_at=timezone.now(), deleted_by=team[2])
        return result

    monkeypatch.setattr(intake.CandidateViewSet, "get_object", delete_after_read)
    response = client.post(
        f"/api/v1/candidates/{person.pk}/apply/",
        {"job": job["id"], "source": "虚构验收", "request_key": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == 409, response.data
    assert not Application.objects.exists()
