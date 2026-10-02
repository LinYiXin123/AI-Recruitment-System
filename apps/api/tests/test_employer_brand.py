import json
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from time import monotonic, sleep
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from recruitment.models import (
    Department,
    DepartmentRole,
    Enterprise,
    EnterpriseEndorsement,
    Membership,
    Organization,
)

pytestmark = pytest.mark.django_db
BASE = "/api/v1/employer-brand/"


def client_for(organization, role="hr"):
    department, _ = Department.objects.get_or_create(organization=organization, name="招聘部")
    user = get_user_model().objects.create_user(f"brand-{organization.pk}-{role}")
    membership = Membership.objects.create(user=user, organization=organization)
    DepartmentRole.objects.create(membership=membership, department=department, role=role)
    client = APIClient()
    client.force_login(user)
    session = client.session
    session["membership_id"] = membership.id
    session.save()
    return client


@pytest.fixture
def brand():
    organization = Organization.objects.create(name="企业背书测试组织")
    client = client_for(organization)
    enterprise = Enterprise.objects.create(
        organization=organization,
        name="测试企业",
        industry="医药健康",
        introduction="研发与生产医药产品。",
        remark="内部资料",
        sort_order=8,
    )
    content = EnterpriseEndorsement.objects.create(
        organization=organization,
        enterprise=enterprise,
        category="culture",
        title="企业文化",
        body="重视协作和持续学习。",
        sort_order=3,
    )
    return client, organization, enterprise, content


def test_enterprise_partial_save_preserves_fields_and_returns_real_counts(brand):
    client, organization, enterprise, _ = brand
    for category, title, deleted_at in [
        ("culture", "第二条文化", None),
        ("benefits", "", None),
        ("history", "已删除历程", timezone.now()),
    ]:
        EnterpriseEndorsement.objects.create(
            organization=organization,
            enterprise=enterprise,
            category=category,
            title=title,
            deleted_at=deleted_at,
        )
    response = client.post(
        f"{BASE}enterprises/save/", {"id": enterprise.id, "enabled": False}, format="json"
    )
    assert response.status_code == 200
    assert response.data["endorsement_count"] == 3
    assert response.data["completed_categories"] == 1
    enterprise.refresh_from_db()
    assert enterprise.enabled is False
    assert (enterprise.name, enterprise.industry, enterprise.introduction) == (
        "测试企业",
        "医药健康",
        "研发与生产医药产品。",
    )
    assert (enterprise.remark, enterprise.sort_order) == ("内部资料", 8)
    assert client.get(f"{BASE}enterprises/ai-options/").data == []


def test_endorsement_partial_save_preserves_fields_and_allows_explicit_unassignment(brand):
    client, _, enterprise, content = brand
    response = client.post(
        f"{BASE}endorsements/save/", {"id": content.id, "enabled": False}, format="json"
    )
    assert response.status_code == 200
    content.refresh_from_db()
    assert content.enabled is False
    assert (
        content.category,
        content.title,
        content.body,
        content.sort_order,
        content.enterprise_id,
    ) == ("culture", "企业文化", "重视协作和持续学习。", 3, enterprise.id)
    response = client.post(
        f"{BASE}endorsements/save/", {"id": content.id, "enterprise_id": None}, format="json"
    )
    assert response.status_code == 200
    content.refresh_from_db()
    assert content.enterprise_id is None and content.enabled is False
    assert content.body == "重视协作和持续学习。"


@pytest.mark.parametrize(
    "endpoint,payload",
    [
        ("enterprises/save/", {}),
        ("enterprises/save/", {"name": "  "}),
        ("endorsements/save/", {}),
        ("endorsements/save/", {"category": "culture"}),
        ("endorsements/save/", {"category": "culture", "enterprise_id": None}),
    ],
)
def test_new_records_still_require_valid_fields(brand, endpoint, payload):
    client, _, _, _ = brand
    assert client.post(f"{BASE}{endpoint}", payload, format="json").status_code == 400
    assert Enterprise.objects.count() == 1
    assert EnterpriseEndorsement.objects.count() == 1


def test_creating_empty_content_requires_category_and_defaults_remain_available(brand):
    client, _, enterprise, _ = brand
    response = client.post(
        f"{BASE}endorsements/save/", {"enterprise_id": enterprise.id}, format="json"
    )
    assert response.status_code == 400
    response = client.post(
        f"{BASE}endorsements/save/",
        {"enterprise_id": enterprise.id, "category": "benefits"},
        format="json",
    )
    assert response.status_code == 201
    assert response.data["title"] == response.data["body"] == ""
    assert response.data["enabled"] is True and response.data["sort_order"] == 0
    response = client.post(f"{BASE}enterprises/save/", {"name": "另一家测试企业"}, format="json")
    assert response.status_code == 201
    assert response.data["enabled"] is True and response.data["endorsement_count"] == 0


def test_delete_restore_are_idempotent_and_workspace_separates_recycle_bin(brand):
    client, _, enterprise, content = brand
    content.enabled = False
    content.save(update_fields=["enabled"])
    endpoint = f"{BASE}endorsements/{content.id}"
    deleted = client.post(f"{endpoint}/delete/", {}, format="json")
    assert deleted.status_code == 200 and deleted.data["deleted_at"] is not None
    assert client.post(f"{endpoint}/delete/", {}, format="json").data == deleted.data
    workspace = client.get(BASE).data
    assert workspace["endorsements"] == []
    assert workspace["deleted_endorsements"][0]["id"] == content.id
    assert workspace["deleted_endorsements"][0]["body"] == content.body
    assert workspace["enterprises"][0]["endorsement_count"] == 0
    assert workspace["enterprises"][0]["completed_categories"] == 0
    assert (
        client.post(
            f"{BASE}endorsements/save/", {"id": content.id, "enabled": True}, format="json"
        ).status_code
        == 404
    )
    restored = client.post(f"{endpoint}/restore/", {}, format="json")
    assert restored.status_code == 200 and restored.data["deleted_at"] is None
    assert restored.data["enterprise_id"] == enterprise.id
    assert restored.data["enabled"] is False
    assert client.post(f"{endpoint}/restore/", {}, format="json").data == restored.data
    workspace = client.get(BASE).data
    assert workspace["deleted_endorsements"] == []
    assert workspace["endorsements"][0]["id"] == content.id
    assert workspace["enterprises"][0]["endorsement_count"] == 1


def test_restoring_content_of_deleted_enterprise_keeps_origin_and_stays_out_of_ai(brand):
    client, _, enterprise, content = brand
    assert client.post(f"{BASE}endorsements/{content.id}/delete/", {}).status_code == 200
    assert client.post(f"{BASE}enterprises/{enterprise.id}/delete/", {}).status_code == 200
    restored = client.post(f"{BASE}endorsements/{content.id}/restore/", {})
    assert restored.status_code == 200
    assert restored.data["enterprise_id"] == enterprise.id
    assert restored.data["enterprise_deleted"] is True
    workspace = client.get(BASE).data
    assert workspace["enterprises"] == []
    assert workspace["deleted_enterprises"][0]["endorsement_count"] == 1
    assert workspace["endorsements"][0]["enterprise_deleted"] is True
    assert client.get(f"{BASE}enterprises/ai-options/").data == []
    with patch("recruitment.ai_screening.chat_completion") as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {"resume": "负责过产品交付。", "enterprise_id": enterprise.id},
            format="json",
        )
    assert response.status_code == 404
    complete.assert_not_called()


def test_deleted_endorsements_are_not_sent_to_ai(brand):
    client, _, enterprise, content = brand
    client.post(f"{BASE}endorsements/{content.id}/delete/", {})
    with patch(
        "recruitment.ai_screening.chat_completion",
        return_value=json.dumps({"summary": "待人工核对", "questions": []}),
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {"resume": "负责过产品交付。", "enterprise_id": enterprise.id},
            format="json",
        )
    assert response.status_code == 200
    assert (
        json.loads(complete.call_args.kwargs["user_text"])["target_enterprise"]["endorsements"]
        == []
    )


def test_cross_organization_objects_are_rejected_and_hidden(brand):
    _, organization, enterprise, content = brand
    other = client_for(Organization.objects.create(name="另一个测试组织"))
    for endpoint, payload in [
        ("enterprises/save/", {"id": enterprise.id, "enabled": False}),
        ("endorsements/save/", {"id": content.id, "enabled": False}),
        ("endorsements/save/", {"enterprise_id": enterprise.id, "category": "team"}),
        (f"endorsements/{content.id}/delete/", {}),
        (f"endorsements/{content.id}/restore/", {}),
    ]:
        assert other.post(f"{BASE}{endpoint}", payload, format="json").status_code == 404
    workspace = other.get(BASE).data
    assert (
        workspace["enterprises"]
        == workspace["endorsements"]
        == workspace["deleted_endorsements"]
        == []
    )
    content.refresh_from_db()
    assert content.organization_id == organization.id and content.deleted_at is None
    assert content.enabled is True


@pytest.mark.parametrize("role", ["manager", "interviewer"])
def test_non_editors_cannot_read_or_change_brand_data(brand, role):
    _, organization, enterprise, content = brand
    client = client_for(organization, role)
    assert client.get(BASE).status_code == 403
    assert client.get(f"{BASE}enterprises/ai-options/").status_code == 403
    for endpoint, payload in [
        ("enterprises/save/", {"id": enterprise.id, "enabled": False}),
        ("endorsements/save/", {"id": content.id, "enabled": False}),
        (f"endorsements/{content.id}/delete/", {}),
        (f"endorsements/{content.id}/restore/", {}),
    ]:
        assert client.post(f"{BASE}{endpoint}", payload, format="json").status_code == 403
    content.refresh_from_db()
    assert content.enabled is True and content.deleted_at is None


def test_supervisor_can_delete_and_restore(brand):
    _, organization, _, content = brand
    client = client_for(organization, "supervisor")
    assert client.post(f"{BASE}endorsements/{content.id}/delete/", {}).status_code == 200
    assert client.post(f"{BASE}endorsements/{content.id}/restore/", {}).status_code == 200


@pytest.mark.django_db(transaction=True)
def test_save_waiting_for_concurrent_delete_cannot_modify_recycled_content(brand):
    client, _, _, content = brand
    worker_pid = Queue()

    def save_content():
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                worker_pid.put(cursor.fetchone()[0])
            return client.post(
                f"{BASE}endorsements/save/",
                {"id": content.id, "body": "并发写入不应覆盖回收站内容"},
                format="json",
            )
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction.atomic():
            deleted = EnterpriseEndorsement.objects.select_for_update().get(pk=content.pk)
            deleted.deleted_at = timezone.now()
            deleted.save(update_fields=["deleted_at", "updated_at"])
            pending = pool.submit(save_content)
            pid = worker_pid.get(timeout=5)
            # 等到另一个连接实际阻塞在这条记录，避免依赖线程运行速度猜测顺序。
            deadline = monotonic() + 5
            with connection.cursor() as cursor:
                while True:
                    cursor.execute("SELECT cardinality(pg_blocking_pids(%s))", [pid])
                    if cursor.fetchone()[0]:
                        break
                    assert monotonic() < deadline, "并发保存未到达记录锁"
                    sleep(0.01)
        response = pending.result(timeout=5)

    assert response.status_code == 404
    content.refresh_from_db()
    assert content.deleted_at is not None
    assert content.body == "重视协作和持续学习。"
