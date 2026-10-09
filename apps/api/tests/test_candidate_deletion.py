import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep

import pytest
from django.db import close_old_connections, connection
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
from tests.test_interviews import advance, ready_application, schedule_body
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
def test_legacy_removed_profile_keeps_application_working_and_restores_without_duplicate(team):
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
    assert detail["active_application_count"] == 1 and detail["can_delete"]
    assert detail["applications"][0]["closed_at"] is None
    tasks = list(Task.objects.filter(application=application).values("id", "status"))
    result = client.delete(url, {"updated_at": detail["updated_at"]}, format="json")
    assert result.status_code == 409, result.data
    # 模拟上一版已移出主档但应聘仍进行中的遗留记录。
    removed_at = timezone.now()
    Candidate.objects.filter(pk=application.candidate_id).update(
        deleted_at=removed_at, deleted_by=team[2], updated_at=removed_at
    )
    application.refresh_from_db()
    assert application.stage == "pending_review" and application.closed_at is None
    assert Interview.objects.get(pk=interview.pk).status == "unscheduled"
    assert list(Task.objects.filter(application=application).values("id", "status")) == tasks
    assert not AuditEvent.objects.filter(application=application, action="从候选人库删除").exists()
    assert client.get("/api/v1/dashboard/").data["metrics"]["talent_pool_total"] == 0
    assert client.get("/api/v1/applications/").data["count"] == 1
    app_url = f"/api/v1/applications/{application.id}/"
    app_detail = client.get(app_url)
    assert app_detail.status_code == 200 and app_detail.data["resumes"][0]["parse"]
    assert app_detail.data["candidate_deleted_at"] == removed_at
    assert app_detail.data["candidate_updated_at"] == removed_at
    assert app_detail.data["can_restore_candidate"]
    app_row = client.get("/api/v1/applications/").data["results"][0]
    assert app_row["candidate_deleted_at"] == removed_at and app_row["can_restore_candidate"]
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
    before = (Candidate.objects.count(), Application.objects.count(), Interview.objects.count())
    stale = client.post(url + "restore/", {"updated_at": detail["updated_at"]}, format="json")
    assert stale.status_code == 409, stale.data
    assert client.post(url + "restore/", {}, format="json").status_code == 400
    body = {"updated_at": app_detail.data["candidate_updated_at"]}
    restored = client.post(url + "restore/", body, format="json")
    assert restored.status_code == 200 and restored.data == {"restored": True}
    profile = client.get(url).data
    assert profile["id"] == application.candidate_id and profile["active_application_count"] == 1
    assert client.post(url + "restore/", body, format="json").status_code == 200
    assert client.get(url).data["updated_at"] == profile["updated_at"]
    assert (
        Candidate.objects.count(),
        Application.objects.count(),
        Interview.objects.count(),
    ) == before
    assert AuditEvent.objects.filter(application=application, action="恢复到候选人库").count() == 1
    final = client.get(app_url).data
    assert final["candidate_deleted_at"] is None and not final["can_restore_candidate"]
    assert final["stage"] == "ready_to_schedule" and final["version"] == application.version


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
    person.deleted_at = timezone.now()
    person.deleted_by = team[2]
    person.save(update_fields=["deleted_at", "deleted_by", "updated_at"])
    restored = client_for(membership).post(
        f"/api/v1/candidates/{person.pk}/restore/",
        {"updated_at": person.updated_at},
        format="json",
    )
    assert restored.status_code in [403, 404], restored.data
    person.refresh_from_db()
    assert person.deleted_at


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
    assert detail["active_application_count"] == 1
    assert not client.get("/api/v1/candidates/").data["results"][0]["can_delete"]
    response = client.delete(url, {"updated_at": detail["updated_at"]}, format="json")
    assert response.status_code == 403, response.data
    assert Candidate.objects.get(pk=application.candidate_id).deleted_at is None
    removed_at = timezone.now()
    Candidate.objects.filter(pk=application.candidate_id).update(
        deleted_at=removed_at, deleted_by=team[2], updated_at=removed_at
    )
    app_detail = client.get(f"/api/v1/applications/{application.id}/").data
    assert app_detail["candidate_deleted_at"] == removed_at
    assert not app_detail["can_restore_candidate"]
    restored = client.post(url + "restore/", {"updated_at": removed_at}, format="json")
    assert restored.status_code == 403, restored.data
    assert Candidate.objects.get(pk=application.candidate_id).deleted_at


@pytest.mark.parametrize("stage", ["pending_review", "offer_sent", "talent_pool"])
def test_any_unclosed_application_blocks_deletion_without_changing_permission_flag(team, stage):
    client = client_for(team[2])
    job = recruiting(team)
    person = Candidate.objects.create(
        organization=team[0], created_by=team[2], display_name="虚构进行中应聘"
    )
    application = Application.objects.create(
        organization=team[0],
        candidate=person,
        job_id=job["id"],
        owner=team[2],
        attempt_no=1,
        stage=stage,
    )
    url = f"/api/v1/candidates/{person.id}/"
    row = client.get("/api/v1/candidates/").data["results"][0]
    assert row["can_delete"] and row["active_application_count"] == 1
    response = client.delete(url, {"updated_at": row["updated_at"]}, format="json")
    assert response.status_code == 409, response.data
    person.refresh_from_db()
    application.refresh_from_db()
    assert person.deleted_at is None and application.stage == stage
    assert application.closed_at is None


def test_closed_application_allows_deletion_and_preserves_readable_history(team):
    client = client_for(team[2])
    job = recruiting(team)
    import_url, item, _ = upload(client, job)
    confirmed = confirm(client, import_url, item)
    app_url = f"/api/v1/applications/{confirmed.data['application']}/"
    closed = review(client, client.get(app_url).data, "reject")
    assert closed.status_code == 200
    url = f"/api/v1/candidates/{closed.data['candidate']}/"
    detail = client.get(url).data
    assert detail["can_delete"] and detail["active_application_count"] == 0
    assert detail["applications"][0]["closed_at"]
    deleted = client.delete(url, {"updated_at": detail["updated_at"]}, format="json")
    assert deleted.status_code == 200, deleted.data
    history = client.get(app_url).data
    assert history["stage"] == "closed" and history["closed_at"] == closed.data["closed_at"]
    assert history["resumes"][0]["parse"] and history["candidate_deleted_at"]
    assert history["can_restore_candidate"]
    assert client.get("/api/v1/candidates/").data["count"] == 0
    assert (
        AuditEvent.objects.filter(application_id=closed.data["id"], action="从候选人库删除").count()
        == 1
    )


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


def test_restore_rejects_new_active_matching_profile_without_merging_or_reviving(team):
    client = client_for(team[2])
    payload = {
        "display_name": "虚构重复恢复",
        "phone": "13800000099",
        "request_key": str(uuid.uuid4()),
    }
    original = client.post("/api/v1/candidates/", payload, format="json")
    assert original.status_code == 201, original.data
    person_url = f"/api/v1/candidates/{original.data['candidate']}/"
    profile = client.get(person_url).data
    assert (
        client.delete(person_url, {"updated_at": profile["updated_at"]}, format="json").status_code
        == 200
    )
    removed = Candidate.objects.get(pk=profile["id"])
    replacement = client.post(
        "/api/v1/candidates/", {**payload, "request_key": str(uuid.uuid4())}, format="json"
    )
    assert replacement.status_code == 201, replacement.data
    response = client.post(
        person_url + "restore/", {"updated_at": removed.updated_at}, format="json"
    )
    assert response.status_code == 409, response.data
    removed.refresh_from_db()
    assert removed.deleted_at and Candidate.objects.count() == 2
    active = client.get("/api/v1/candidates/").data["results"]
    assert [row["id"] for row in active] == [replacement.data["candidate"]]
    assert not Application.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_restore_and_interview_schedule_serialize_on_candidate_without_deadlock(team):
    client = client_for(team[2])
    app = advance(client, ready_application(team))
    removed_at = timezone.now()
    Candidate.objects.filter(pk=app["candidate"]).update(
        deleted_at=removed_at, deleted_by=team[2], updated_at=removed_at
    )
    restore_locked = Event()
    continue_restore = Event()
    schedule_started = Event()
    backend_pids = {}

    def pause_after_candidate_lock(execute, sql, params, many, context):
        result = execute(sql, params, many, context)
        if 'FROM "recruitment_candidate"' in sql and "FOR UPDATE" in sql:
            restore_locked.set()
            assert continue_restore.wait(10), "未释放恢复事务"
        return result

    def run_restore():
        close_old_connections()
        try:
            actor_client = client_for(team[2])
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
                cursor.execute("SELECT pg_backend_pid()")
                backend_pids["restore"] = cursor.fetchone()[0]
            with connection.execute_wrapper(pause_after_candidate_lock):
                response = actor_client.post(
                    f"/api/v1/candidates/{app['candidate']}/restore/",
                    {"updated_at": removed_at},
                    format="json",
                )
            return response.status_code, response.data
        finally:
            close_old_connections()

    def run_schedule():
        close_old_connections()
        try:
            actor_client = client_for(team[2])
            assert restore_locked.wait(10), "恢复事务没有先锁主档"
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
                cursor.execute("SELECT pg_backend_pid()")
                backend_pids["schedule"] = cursor.fetchone()[0]
            schedule_started.set()
            response = actor_client.post(
                "/api/v1/interviews/", schedule_body(app, team[3]), format="json"
            )
            return response.status_code, response.data
        finally:
            close_old_connections()

    with ThreadPoolExecutor(2) as pool:
        restoring = pool.submit(run_restore)
        scheduling = pool.submit(run_schedule)
        blocked = False
        try:
            assert schedule_started.wait(10)
            deadline = monotonic() + 4
            while monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT %s = ANY(pg_blocking_pids(%s))",
                        [backend_pids["restore"], backend_pids["schedule"]],
                    )
                    blocked = cursor.fetchone()[0]
                if blocked:
                    break
                sleep(0.01)
            assert blocked, "未观察到排期等待恢复持有的候选人锁"
        finally:
            continue_restore.set()
        restored = restoring.result(timeout=10)
        scheduled = scheduling.result(timeout=10)
    assert restored[0] == 200, restored
    assert scheduled[0] == 201, scheduled
    assert not Candidate.objects.get(pk=app["candidate"]).deleted_at
    assert Interview.objects.filter(application_id=app["id"]).count() == 1
    assert Application.objects.get(pk=app["id"]).stage == "interviewing"
    assert AuditEvent.objects.filter(application_id=app["id"], action="恢复到候选人库").count() == 1
