import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import Client, override_settings
from rest_framework.test import APIClient

from recruitment.models import (
    AuditEvent,
    Department,
    DepartmentRole,
    Job,
    Membership,
    Organization,
    ProfileVersion,
    Task,
)

pytestmark = pytest.mark.django_db


def actor(org, department=None, role=None, username="hr", admin=False):
    user = get_user_model().objects.create_user(
        username, password="test-password-12345", is_staff=admin, is_superuser=admin
    )
    membership = Membership.objects.create(user=user, organization=org)
    if role:
        DepartmentRole.objects.create(membership=membership, department=department, role=role)
    return membership


def client_for(membership):
    client = APIClient()
    client.force_login(membership.user)
    session = client.session
    session["membership_id"] = membership.id
    session.save()
    return client


@pytest.fixture
def team():
    org = Organization.objects.create(name="测试组织")
    dept = Department.objects.create(organization=org, name="研发部")
    hr = actor(org, dept, "hr")
    manager = actor(org, dept, "manager", "manager")
    outsider = actor(org, dept, "hr", "outsider")
    return org, dept, hr, manager, outsider


def new_job(team, **changes):
    _, dept, hr, manager, _ = team
    response = client_for(hr).post(
        "/api/v1/jobs/",
        {
            "request_id": str(uuid.uuid4()),
            "title": "测试职位",
            "location": "深圳",
            "headcount": 2,
            "department": dept.id,
            "approver": manager.id,
            **changes,
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    return response.data


def save_profile(client, job, **changes):
    return client.post(
        f"/api/v1/jobs/{job['id']}/profiles/",
        {
            "version": job["version"],
            "jd": "负责招聘业务产品与需求分析",
            "source": "用人需求会议记录",
            "requirements": [{"kind": "must", "text": "能独立完成需求分析"}],
            **changes,
        },
        format="json",
    )


def action(client, job, name, **data):
    return client.post(
        f"/api/v1/jobs/{job['id']}/{name}/", {"version": job["version"], **data}, format="json"
    )


def test_create_submit_confirm_and_activate_persist(team):
    _, _, hr, manager, _ = team
    hc, mc = client_for(hr), client_for(manager)
    job = new_job(team)
    assert action(hc, job, "change-status", status="open").status_code == 400
    job = save_profile(hc, job).data
    job = action(hc, job, "submit-profile").data
    assert hc.get("/api/v1/tasks/").data["count"] == 0
    assert hc.get("/api/v1/tasks/?scope=waiting").data["count"] == 1
    assert mc.get("/api/v1/tasks/").data["count"] == 1
    assert action(hc, job, "review-profile", outcome="confirm").status_code == 403
    confirmed = action(mc, job, "review-profile", outcome="confirm")
    assert confirmed.status_code == 200
    assert confirmed.data["latest_profile"]["confirmed_by_name"] == "manager"
    assert Task.objects.get(kind="review").status == "done"
    assert action(mc, job, "review-profile", outcome="confirm").status_code == 409
    opened = action(hc, confirmed.data, "change-status", status="open")
    assert opened.status_code == 200
    assert client_for(hr).get(f"/api/v1/jobs/{job['id']}/").data["status"] == "open"
    assert AuditEvent.objects.count() == 5


def test_scope_on_list_search_detail_history_and_tasks(team):
    org, dept, hr, manager, outsider = team
    job = new_job(team)
    submitted = action(
        client_for(hr), save_profile(client_for(hr), job).data, "submit-profile"
    ).data
    other_dept = Department.objects.create(organization=org, name="财务部")
    other_manager = actor(org, other_dept, "manager", "other_manager")
    other_org = Organization.objects.create(name="另一组织")
    foreign = actor(other_org, username="foreign")
    admin = actor(org, username="admin", admin=True)
    interviewer = actor(org, username="interviewer")
    for person in [outsider, other_manager, foreign, admin, interviewer]:
        c = client_for(person)
        assert c.get("/api/v1/jobs/?search=测试").data["count"] == 0
        assert c.get("/api/v1/tasks/").data["count"] == 0
        for suffix in ["", "history/", "profiles/"]:
            assert c.get(f"/api/v1/jobs/{job['id']}/{suffix}").status_code == 404
        assert action(c, submitted, "review-profile", outcome="confirm").status_code == 404
    assert APIClient().get("/api/v1/jobs/").status_code == 403
    assert client_for(manager).get("/api/v1/jobs/").data["count"] == 1


def test_creation_rejects_cross_org_and_unauthorized_relations(team):
    org, dept, hr, manager, outsider = team
    other = Organization.objects.create(name="外部组织")
    d = Department.objects.create(organization=other, name="研发部")
    m = actor(other, d, "manager", "foreign_manager")
    c = client_for(hr)
    body = {
        "request_id": str(uuid.uuid4()),
        "title": "岗位",
        "location": "深圳",
        "headcount": 1,
        "department": dept.id,
        "approver": m.id,
    }
    assert c.post("/api/v1/jobs/", body, format="json").status_code == 400
    body.update(department=d.id, approver=manager.id)
    assert c.post("/api/v1/jobs/", body, format="json").status_code == 404
    body.update(department=dept.id, collaborators=[m.id])
    assert c.post("/api/v1/jobs/", body, format="json").status_code == 400
    body.update(collaborators=[], headcount=0)
    assert c.post("/api/v1/jobs/", body, format="json").status_code == 400
    assert Job.objects.count() == 0
    shared = new_job(team, collaborators=[outsider.id], organization=other.id)
    assert Job.objects.get(pk=shared["id"]).organization_id == org.id
    assert client_for(outsider).get("/api/v1/jobs/").data["count"] == 1
    assert save_profile(client_for(outsider), shared).status_code == 201


def test_new_profile_preserves_confirmed_version_and_jd(team):
    _, _, hr, manager, _ = team
    c = client_for(hr)
    job = save_profile(c, new_job(team)).data
    job = action(c, job, "submit-profile").data
    job = action(client_for(manager), job, "review-profile", outcome="confirm").data
    original_id = job["latest_profile"]["id"]
    newer = save_profile(c, job, jd="更新的对外职位描述").data
    old = ProfileVersion.objects.get(pk=original_id)
    assert old.status == "confirmed"
    assert old.jd_snapshot == "负责招聘业务产品与需求分析"
    assert newer["latest_profile"]["number"] == 2
    assert newer["latest_profile"]["status"] == "draft"
    assert newer["active_profile"] == original_id
    assert action(c, newer, "change-status", status="open").status_code == 400
    assert c.patch(f"/api/v1/jobs/{job['id']}/", {"status": "open"}).status_code == 405


def test_new_draft_withdraws_pending_and_stale_confirmation(team):
    _, _, hr, manager, _ = team
    c = client_for(hr)
    job = action(c, save_profile(c, new_job(team)).data, "submit-profile").data
    newer = save_profile(c, job).data
    assert Task.objects.get().status == "cancelled"
    assert client_for(manager).get("/api/v1/tasks/").data["count"] == 0
    assert action(client_for(manager), job, "review-profile", outcome="confirm").status_code == 409
    assert action(c, newer, "submit-profile").status_code == 200
    assert Task.objects.filter(status="pending").count() == 1


def test_request_changes_close_reopen_and_validation(team):
    _, _, hr, manager, _ = team
    c, mc = client_for(hr), client_for(manager)
    job = new_job(team)
    invalid = save_profile(c, job, requirements=[{"kind": "exclusion", "text": "排除条件"}])
    assert invalid.status_code == 400
    assert ProfileVersion.objects.count() == 0
    job = action(c, save_profile(c, job).data, "submit-profile").data
    assert action(mc, job, "review-profile", outcome="changes_requested").status_code == 400
    job = action(mc, job, "review-profile", outcome="changes_requested", note="请补充证据").data
    assert job["latest_profile"]["review_note"] == "请补充证据"
    assert Task.objects.get(kind="review").status == "done"
    assert c.get("/api/v1/tasks/").data["results"][0]["kind"] == "revise"
    job = action(c, save_profile(c, job).data, "submit-profile").data
    assert Task.objects.get(kind="revise").status == "done"
    assert action(c, job, "change-status", status="closed").status_code == 400
    job = action(c, job, "change-status", status="closed", reason="需求暂停").data
    assert Task.objects.filter(status="pending").count() == 0
    assert save_profile(c, job).status_code == 400
    assert action(c, job, "change-status", status="draft", reason="重新启动").status_code == 200


def test_inactive_members_and_revoked_manager_cannot_act(team):
    _, _, hr, manager, _ = team
    c, mc = client_for(hr), client_for(manager)
    job = action(c, save_profile(c, new_job(team)).data, "submit-profile").data
    DepartmentRole.objects.filter(membership=manager).delete()
    assert mc.get("/api/v1/tasks/").data["count"] == 0
    assert action(mc, job, "review-profile", outcome="confirm").status_code == 404
    assert mc.get("/api/v1/jobs/").data["count"] == 0
    hr.active = False
    hr.save()
    assert c.get("/api/v1/jobs/").status_code == 403


def test_csrf_login_logout_and_session(team):
    _, _, hr, _, _ = team
    c = Client(enforce_csrf_checks=True)
    credentials = {"username": hr.user.username, "password": "test-password-12345"}
    assert (
        c.post("/api/v1/auth/login/", credentials, content_type="application/json").status_code
        == 403
    )
    token = c.get("/api/v1/auth/csrf/").json()["csrfToken"]
    response = c.post(
        "/api/v1/auth/login/", credentials, content_type="application/json", HTTP_X_CSRFTOKEN=token
    )
    assert response.status_code == 200
    token = response.json()["csrfToken"]
    assert c.get("/api/v1/me/").status_code == 200
    assert c.get("/api/v1/me/")["Cache-Control"] == "no-store"
    assert c.post("/api/v1/jobs/", {}, content_type="application/json").status_code == 403
    assert c.post("/api/v1/auth/logout/", HTTP_X_CSRFTOKEN=token).status_code == 200
    assert c.get("/api/v1/me/").status_code == 403


@override_settings(DEBUG=True)
def test_local_experience_uses_only_fixed_active_demo_members(team):
    org, dept, _, _, _ = team
    org.name = "知遇体验团队（虚构）"
    org.save(update_fields=["name"])
    local_hr = actor(org, dept, "hr", "local_hr")
    local_manager = actor(org, dept, "manager", "local_manager")
    c = Client(enforce_csrf_checks=True)

    assert (
        c.post(
            "/api/v1/auth/experience/", {"role": "hr"}, content_type="application/json"
        ).status_code
        == 403
    )
    token = c.get("/api/v1/auth/csrf/").json()["csrfToken"]
    response = c.post(
        "/api/v1/auth/experience/",
        {"role": "hr"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    assert response.json()["role"] == "hr"
    assert c.session["membership_id"] == local_hr.id
    assert c.get("/api/v1/me/").data["roles"] == ["hr"]

    token = response.json()["csrfToken"]
    response = c.post(
        "/api/v1/auth/experience/",
        {"role": "manager"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    assert c.session["membership_id"] == local_manager.id

    token = response.json()["csrfToken"]
    assert (
        c.post(
            "/api/v1/auth/experience/",
            {"role": "supervisor"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        ).status_code
        == 400
    )


def test_local_experience_is_not_available_outside_debug():
    c = Client(enforce_csrf_checks=True)
    token = c.get("/api/v1/auth/csrf/").json()["csrfToken"]
    with override_settings(DEBUG=False):
        assert (
            c.post(
                "/api/v1/auth/experience/",
                {"role": "hr"},
                content_type="application/json",
                HTTP_X_CSRFTOKEN=token,
            ).status_code
            == 404
        )


@pytest.mark.django_db(transaction=True)
def test_concurrent_updates_only_one_commits(team):
    assert connection.vendor == "postgresql"
    _, _, hr, _, _ = team
    job = new_job(team)
    clients = [client_for(hr), client_for(hr)]
    barrier = Barrier(2)

    def update(c):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return save_profile(c, job).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(update, clients))
    assert sorted(results) == [201, 409]
    assert ProfileVersion.objects.count() == 1
    assert Job.objects.get(pk=job["id"]).version == 2


def test_creation_retry_does_not_duplicate_job(team):
    _, dept, hr, manager, _ = team
    c = client_for(hr)
    body = {
        "request_id": str(uuid.uuid4()),
        "title": "重试岗位",
        "location": "深圳",
        "headcount": 1,
        "department": dept.id,
        "approver": manager.id,
    }
    first = c.post("/api/v1/jobs/", body, format="json")
    retry = c.post("/api/v1/jobs/", body, format="json")
    assert first.status_code == 201
    assert retry.status_code == 200
    assert retry.data["id"] == first.data["id"]
    assert Job.objects.count() == 1
    assert AuditEvent.objects.count() == 1
    body["title"] = "被改动的重试"
    assert c.post("/api/v1/jobs/", body, format="json").status_code == 409


def test_default_no_self_approval_and_unresolved_required_rule(team):
    org, dept, hr, manager, _ = team
    DepartmentRole.objects.create(membership=hr, department=dept, role="manager")
    c = client_for(hr)
    assert all(p["id"] != hr.id for p in c.get("/api/v1/me/").data["departments"][0]["approvers"])
    body = {
        "request_id": str(uuid.uuid4()),
        "title": "自审职位",
        "location": "深圳",
        "headcount": 1,
        "department": dept.id,
        "approver": hr.id,
    }
    assert c.post("/api/v1/jobs/", body, format="json").status_code == 400
    job = save_profile(
        c,
        new_job(team),
        requirements=[{"kind": "must", "text": "还需确认的必要要求", "needs_verification": True}],
    ).data
    assert action(c, job, "submit-profile").status_code == 400
    assert Task.objects.count() == 0
    job = save_profile(c, job).data
    job = action(c, job, "submit-profile").data
    assert ProfileVersion.objects.get(pk=job["latest_profile"]["id"]).submitted_by_id == hr.id


def ask(client, job, **changes):
    p = job["latest_profile"]
    return action(
        client,
        job,
        "clarifications",
        profile=p["id"],
        requirement=p["requirements"][0]["id"],
        question="需要独立负责哪类项目？",
        request_key=str(uuid.uuid4()),
        **changes,
    )


def test_clarification_answer_is_not_approval_and_history_is_preserved(team):
    from recruitment.models import ProfileClarification

    _, _, hr, manager, _ = team
    hc, mc = client_for(hr), client_for(manager)
    job = save_profile(
        hc,
        new_job(team),
        requirements=[{"kind": "must", "text": "能独立完成需求分析", "needs_verification": True}],
    ).data
    before = job
    job = ask(hc, job).data
    q = ProfileClarification.objects.get()
    replay = action(
        hc,
        before,
        "clarifications",
        profile=q.profile_id,
        requirement=q.requirement_id,
        question=q.question,
        request_key=str(q.request_key),
    )
    assert replay.status_code == 200
    assert Task.objects.filter(kind="clarify").count() == 1
    assert mc.get("/api/v1/tasks/").data["count"] == 1
    assert action(hc, job, "submit-profile").status_code == 400
    job = action(
        mc, job, f"clarifications/{q.pk}/answer", answer="需要独立完成招聘业务流程的调研和设计。"
    ).data
    assert job["latest_profile"]["status"] == "draft"
    assert job["active_profile"] is None
    assert job["latest_profile"]["requirements"][0]["needs_verification"] is True
    assert Task.objects.get(kind="clarify").status == "done"
    assert hc.get("/api/v1/tasks/").data["results"][0]["kind"] == "clarify_followup"
    assert (
        action(
            mc,
            before,
            f"clarifications/{q.pk}/answer",
            answer="需要独立完成招聘业务流程的调研和设计。",
        ).status_code
        == 200
    )
    assert (
        action(mc, job, f"clarifications/{q.pk}/answer", answer="试图覆盖答复").status_code == 409
    )
    job = save_profile(hc, job).data
    assert Task.objects.get(kind="clarify_followup").status == "done"
    history = hc.get(f"/api/v1/jobs/{job['id']}/clarifications/").data["results"]
    assert history[0]["profile_number"] == 1
    assert history[0]["answer"] == "需要独立完成招聘业务流程的调研和设计。"
    job = action(hc, job, "submit-profile").data
    job = action(mc, job, "review-profile", outcome="confirm").data
    assert action(hc, job, "change-status", status="open").status_code == 200


def test_clarification_scope_stale_version_and_revoked_assignment(team):
    from recruitment.models import ProfileClarification

    org, dept, hr, manager, outsider = team
    hc, mc = client_for(hr), client_for(manager)
    job = save_profile(hc, new_job(team)).data
    other_job = save_profile(hc, new_job(team)).data
    p = job["latest_profile"]
    assert (
        action(
            hc,
            job,
            "clarifications",
            profile=p["id"],
            requirement=other_job["latest_profile"]["requirements"][0]["id"],
            question="伪造另一职位条件",
            request_key=str(uuid.uuid4()),
        ).status_code
        == 404
    )
    job = ask(hc, job).data
    q = ProfileClarification.objects.get()
    for person in [
        outsider,
        actor(org, username="config_admin", admin=True),
        actor(Organization.objects.create(name="外部"), username="external"),
    ]:
        c = client_for(person)
        assert c.get(f"/api/v1/jobs/{job['id']}/clarifications/").status_code == 404
        assert action(c, job, f"clarifications/{q.pk}/answer", answer="越权回答").status_code == 404
    other_manager = client_for(actor(org, dept, "manager", "other_reviewer"))
    assert (
        other_manager.get(f"/api/v1/jobs/{job['id']}/clarifications/").data["results"][0][
            "can_answer"
        ]
        is False
    )
    assert (
        action(other_manager, job, f"clarifications/{q.pk}/answer", answer="非指定人").status_code
        == 403
    )
    assert action(hc, job, "submit-profile").status_code == 400
    newer = save_profile(hc, job).data
    q.refresh_from_db()
    assert q.status == "withdrawn"
    assert Task.objects.get(clarification=q).status == "cancelled"
    assert (
        action(mc, newer, f"clarifications/{q.pk}/answer", answer="旧版本回答").status_code == 409
    )
    job = ask(hc, newer).data
    latest_question = ProfileClarification.objects.latest("id")
    manager.roles.all().delete()
    assert mc.get("/api/v1/tasks/").data["count"] == 0
    assert (
        action(
            mc, job, f"clarifications/{latest_question.pk}/answer", answer="撤权后回答"
        ).status_code
        == 404
    )
    assert ask(hc, job).status_code == 400
    job = action(hc, job, "change-status", status="closed", reason="结束验证").data
    latest_question.refresh_from_db()
    assert latest_question.status == "withdrawn"
    assert not Task.objects.filter(status="pending").exists()


def test_clarification_and_task_roll_back_together(team, monkeypatch):
    import recruitment.views as views
    from recruitment.models import ProfileClarification

    _, _, hr, _, _ = team
    hc = client_for(hr)
    job = save_profile(hc, new_job(team)).data

    def fail(*args, **kwargs):
        raise RuntimeError("模拟事务中断")

    monkeypatch.setattr(views, "record", fail)
    with pytest.raises(RuntimeError):
        ask(hc, job)
    assert ProfileClarification.objects.count() == 0
    assert Task.objects.count() == 0
    assert Job.objects.get(pk=job["id"]).version == job["version"]


@pytest.mark.django_db(transaction=True)
def test_concurrent_clarification_answers_commit_once(team):
    from recruitment.models import ProfileClarification

    _, _, hr, manager, _ = team
    hc = client_for(hr)
    job = ask(hc, save_profile(hc, new_job(team)).data).data
    q = ProfileClarification.objects.get()
    clients = [client_for(manager), client_for(manager)]
    barrier = Barrier(2)

    def answer(entry):
        i, c = entry
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return action(
                c, job, f"clarifications/{q.pk}/answer", answer=f"具体要求答复 {i}"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(answer, enumerate(clients)))
    assert sorted(results) == [200, 409]
    assert Task.objects.filter(kind="clarify_followup").count() == 1
    assert AuditEvent.objects.filter(action__startswith="回答招人要求").count() == 1


def test_activation_rechecks_required_member_authorization(team):
    _, _, hr, manager, collaborator = team
    hc = client_for(hr)
    job = save_profile(hc, new_job(team, collaborators=[collaborator.pk])).data
    job = action(hc, job, "submit-profile").data
    job = action(client_for(manager), job, "review-profile", outcome="confirm").data
    manager.active = False
    manager.save()
    assert action(hc, job, "change-status", status="open").status_code == 400
    manager.active = True
    manager.save()
    hr.active = False
    hr.save()
    assert action(client_for(collaborator), job, "change-status", status="open").status_code == 400
