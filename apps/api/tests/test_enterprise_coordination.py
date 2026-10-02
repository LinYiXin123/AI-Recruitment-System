import uuid
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Barrier
from time import monotonic, sleep

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, transaction
from rest_framework.test import APIClient

from recruitment.models import (
    AuditEvent,
    Department,
    DepartmentRole,
    Enterprise,
    EnterpriseEndorsement,
    EnterpriseIssue,
    Job,
    Membership,
    Organization,
)

pytestmark = pytest.mark.django_db
BASE = "/api/v1/employer-brand/"


def person(organization, department, name, role="hr"):
    user = get_user_model().objects.create_user(name)
    member = Membership.objects.create(organization=organization, user=user)
    DepartmentRole.objects.create(membership=member, department=department, role=role)
    client = APIClient()
    client.force_login(user)
    session = client.session
    session["membership_id"] = member.pk
    session.save()
    return client, member


@pytest.fixture
def context():
    org = Organization.objects.create(name="企业协作测试")
    department = Department.objects.create(organization=org, name="招聘部")
    requester, owner = person(org, department, "提问人")
    assignee, responsible = person(org, department, "负责人")
    outsider, unrelated = person(org, department, "无关HR")
    enterprise = Enterprise.objects.create(organization=org, name="测试企业")
    job = Job.objects.create(
        organization=org,
        department=department,
        title="测试岗位",
        location="深圳",
        headcount=1,
        owner=owner,
        approver=owner,
        company_name="原公司名称",
    )
    return requester, owner, assignee, responsible, outsider, unrelated, enterprise, job


def issue_payload(enterprise, assignee):
    return {
        "request_key": str(uuid.uuid4()),
        "enterprise_id": enterprise.pk,
        "category": "benefits",
        "question": "深圳办公室是否提供班车？",
        "assignee_id": assignee.pk,
        "source_reference": "飞书应聘记录编号 FS-001，人工记录",
    }


def test_job_binding_is_explicit_versioned_and_permission_scoped(context):
    client, owner, _, _, outsider, _, enterprise, job = context
    payload = {"job_id": job.pk, "enterprise_id": enterprise.pk, "version": job.version}
    assert outsider.post(f"{BASE}job-enterprise/", payload).status_code == 404
    assert outsider.get(f"{BASE}coordination/").data["jobs"] == []
    response = client.post(f"{BASE}job-enterprise/", payload)
    assert response.status_code == 200
    assert response.data["enterprise_id"] == enterprise.pk
    assert response.data["company_name"] == enterprise.name
    assert response.data["version"] == 2
    assert AuditEvent.objects.get(job=job).actor == owner
    assert client.post(f"{BASE}job-enterprise/", payload).status_code == 409
    report = client.get(f"/api/v1/jobs/{job.pk}/").data
    assert report["enterprise_name"] == enterprise.name
    assert report["enterprise_enabled"] is True
    assert report["enterprise_deleted"] is False
    response = client.post(
        f"{BASE}job-enterprise/", {**payload, "enterprise_id": None, "version": 2}, format="json"
    )
    assert response.status_code == 200 and response.data["enterprise_id"] is None
    assert response.data["company_name"] == enterprise.name
    job.refresh_from_db()
    job.status = "closed"
    job.save()
    assert client.post(f"{BASE}job-enterprise/", {**payload, "version": 3}).status_code == 400


def test_job_binding_rejects_cross_organization_and_deleted_enterprise(context):
    client, _, _, _, _, _, enterprise, job = context
    other = Enterprise.objects.create(
        organization=Organization.objects.create(name="其他组织"), name=enterprise.name
    )
    payload = {"job_id": job.pk, "version": job.version}
    assert (
        client.post(f"{BASE}job-enterprise/", {**payload, "enterprise_id": other.pk}).status_code
        == 404
    )
    enterprise.enabled = False
    enterprise.save()
    assert (
        client.post(
            f"{BASE}job-enterprise/", {**payload, "enterprise_id": enterprise.pk}
        ).status_code
        == 200
    )
    client.post(f"{BASE}enterprises/{enterprise.pk}/delete/")
    assert (
        client.post(
            f"{BASE}job-enterprise/", {**payload, "enterprise_id": enterprise.pk, "version": 2}
        ).status_code
        == 404
    )


def test_issue_reply_and_follow_up_are_private_versioned_and_keep_evidence(context):
    client, owner, responder, assignee, outsider, _, enterprise, _ = context
    payload = issue_payload(enterprise, assignee)
    response = client.post(f"{BASE}issues/", payload, format="json")
    assert response.status_code == 201
    issue_id = response.data["id"]
    path = f"{BASE}issues/{issue_id}"
    assert client.post(f"{BASE}issues/", payload, format="json").data["id"] == issue_id
    assert (
        client.post(
            f"{BASE}issues/", {**payload, "question": "修改问题"}, format="json"
        ).status_code
        == 409
    )
    assert outsider.get(f"{BASE}coordination/").data["issues"] == []
    assert outsider.post(f"{path}/answer/", {"version": 1, "answer": "无权回复"}).status_code == 404
    assert client.post(f"{path}/answer/", {"version": 1, "answer": "自答"}).status_code == 403
    assert (
        client.post(f"{path}/close/", {"version": 1, "follow_up_note": "未答复"}).status_code == 409
    )
    content = EnterpriseEndorsement.objects.create(
        organization=enterprise.organization,
        enterprise=enterprise,
        category="benefits",
        title="班车安排",
        body="深圳办公室提供工作日班车。",
    )
    response = responder.post(
        f"{path}/answer/", {"version": 1, "answer": "已核实有班车。", "endorsement_id": content.pk}
    )
    assert response.status_code == 200
    assert response.data["status"] == "answered" and response.data["version"] == 2
    assert response.data["endorsement_snapshot"]["body"] == content.body
    assert responder.post(f"{path}/answer/", {"version": 1, "answer": "重复"}).status_code == 409
    content.body = "后续班车安排调整。"
    content.save()
    assert (
        responder.post(
            f"{path}/close/", {"version": 2, "follow_up_note": "代替提问人反馈"}
        ).status_code
        == 403
    )
    assert client.post(f"{path}/close/", {"version": 2, "follow_up_note": "  "}).status_code == 400
    client.post(f"{BASE}enterprises/{enterprise.pk}/delete/")
    response = client.post(
        f"{path}/close/", {"version": 2, "follow_up_note": "已向候选人说明，人工记录在飞书原应聘。"}
    )
    assert response.status_code == 200 and response.data["status"] == "closed"
    assert response.data["endorsement_snapshot"]["body"] == "深圳办公室提供工作日班车。"
    assert (
        client.post(f"{path}/close/", {"version": 3, "follow_up_note": "重复完成"}).status_code
        == 409
    )
    assert EnterpriseIssue.objects.get(pk=issue_id).requester == owner
    assert (
        client.post(
            f"{BASE}issues/", {**payload, "request_key": str(uuid.uuid4())}, format="json"
        ).status_code
        == 404
    )


def test_issue_reassignment_recovers_inactive_assignee_without_widening_visibility(context):
    client, _, responder, assignee, next_client, replacement, enterprise, _ = context
    payload = issue_payload(enterprise, assignee)
    issue_id = client.post(f"{BASE}issues/", payload, format="json").data["id"]
    assignee.active = False
    assignee.save()
    path = f"{BASE}issues/{issue_id}"
    assert responder.post(f"{path}/answer/", {"version": 1, "answer": "答复"}).status_code == 403
    assert assignee.pk not in [
        a["id"] for a in client.get(f"{BASE}coordination/").data["assignees"]
    ]
    assert (
        client.post(f"{path}/reassign/", {"version": 1, "assignee_id": assignee.pk}).status_code
        == 404
    )
    response = client.post(f"{path}/reassign/", {"version": 1, "assignee_id": replacement.pk})
    assert response.status_code == 200 and response.data["version"] == 2
    assert next_client.get(f"{BASE}coordination/").data["issues"][0]["id"] == issue_id
    assert client.post(f"{BASE}issues/", payload, format="json").status_code == 200
    assert EnterpriseIssue.objects.count() == 1
    assert (
        next_client.post(
            f"{path}/answer/", {"version": 2, "answer": "已核实，请见回复。"}
        ).status_code
        == 200
    )


def test_issue_assignee_and_endorsement_must_be_in_same_organization_and_enterprise(context):
    client, _, responder, assignee, _, _, enterprise, job = context
    other_org = Organization.objects.create(name="其他组织")
    other_department = Department.objects.create(organization=other_org, name="其他部门")
    other_client, other_member = person(other_org, other_department, "其他HR")
    payload = issue_payload(enterprise, other_member)
    assert client.post(f"{BASE}issues/", payload, format="json").status_code == 404
    assert other_client.post(f"{BASE}issues/", payload, format="json").status_code == 404
    manager_client, manager = person(enterprise.organization, job.department, "用人经理", "manager")
    assert manager_client.get(f"{BASE}coordination/").status_code == 403
    assert (
        client.post(
            f"{BASE}issues/", {**payload, "assignee_id": manager.pk}, format="json"
        ).status_code
        == 404
    )
    old_content = EnterpriseEndorsement.objects.create(
        organization=enterprise.organization,
        enterprise=enterprise,
        category="benefits",
        body="旧资料",
    )
    response = client.post(f"{BASE}issues/", issue_payload(enterprise, assignee), format="json")
    path = f"{BASE}issues/{response.data['id']}/answer/"
    assert (
        responder.post(
            path, {"version": 1, "answer": "待更新", "endorsement_id": old_content.pk}
        ).status_code
        == 400
    )
    other_enterprise = Enterprise.objects.create(
        organization=enterprise.organization, name="另一企业"
    )
    other_content = EnterpriseEndorsement.objects.create(
        organization=enterprise.organization,
        enterprise=other_enterprise,
        category="benefits",
        body="其他资料",
    )
    assert (
        responder.post(
            path, {"version": 1, "answer": "不能关联", "endorsement_id": other_content.pk}
        ).status_code
        == 404
    )


def test_ai_preview_keeps_first_enabled_content_per_category_and_excludes_private_notes(context):
    client, _, _, _, _, _, enterprise, _ = context
    enterprise.remark = "内部备注不传给模型"
    enterprise.introduction = "企业简介"
    enterprise.save()
    for order, enabled, body in [(0, False, "停用内容"), (1, True, "甲" * 1800), (2, True, "次选")]:
        EnterpriseEndorsement.objects.create(
            organization=enterprise.organization,
            enterprise=enterprise,
            category="culture",
            sort_order=order,
            enabled=enabled,
            body=body,
        )
    path = f"{BASE}enterprises/{enterprise.pk}/ai-context/"
    response = client.get(path)
    assert response.status_code == 200
    assert response.data["introduction"] == "企业简介" and "remark" not in response.data
    assert len(response.data["endorsements"]) == 1
    item = response.data["endorsements"][0]
    assert item["body"] == "甲" * 1500
    assert item["category"] == "culture" and item["category_label"] == "企业文化"
    assert item["updated_at"] and item["id"]
    enterprise.enabled = False
    enterprise.save()
    assert client.get(path).status_code == 404


@pytest.mark.django_db(transaction=True)
def test_concurrent_issue_creation_and_reply_are_serialized(context):
    client, _, responder, assignee, _, _, enterprise, _ = context
    payload = issue_payload(enterprise, assignee)
    barrier = Barrier(2)

    def submit(api_client, path, body):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return api_client.post(path, body, format="json")
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        creates = [pool.submit(submit, client, f"{BASE}issues/", payload) for _ in range(2)]
        responses = [future.result(timeout=10) for future in creates]
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert EnterpriseIssue.objects.count() == 1
    issue_id = responses[0].data["id"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = [
            pool.submit(
                submit,
                responder,
                f"{BASE}issues/{issue_id}/answer/",
                {"version": 1, "answer": f"答复{index}"},
            )
            for index in range(2)
        ]
        responses = [future.result(timeout=10) for future in replies]
    assert sorted(response.status_code for response in responses) == [200, 409]
    issue = EnterpriseIssue.objects.get(pk=issue_id)
    assert issue.version == 2 and issue.status == "answered"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("change", ["deactivate", "remove_role", "user_deactivate"])
def test_issue_creation_rechecks_membership_after_waiting_for_lock(context, change):
    client, requester, _, assignee, _, _, enterprise, _ = context
    payload = issue_payload(enterprise, assignee)
    worker_pid = Queue()

    def submit():
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                worker_pid.put(cursor.fetchone()[0])
            return client.post(f"{BASE}issues/", payload, format="json")
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction.atomic():
            locked = Membership.objects.select_for_update().get(pk=requester.pk)
            pending = pool.submit(submit)
            pid = worker_pid.get(timeout=5)
            deadline = monotonic() + 5
            with connection.cursor() as cursor:
                while True:
                    cursor.execute("SELECT cardinality(pg_blocking_pids(%s))", [pid])
                    if cursor.fetchone()[0]:
                        break
                    assert monotonic() < deadline, "创建问题未到达成员锁"
                    sleep(0.01)
            if change == "deactivate":
                locked.active = False
                locked.save(update_fields=["active"])
            elif change == "user_deactivate":
                get_user_model().objects.filter(pk=locked.user_id).update(is_active=False)
            else:
                DepartmentRole.objects.filter(membership=locked).delete()
        response = pending.result(timeout=5)
    assert response.status_code == 403
    assert not EnterpriseIssue.objects.exists()
