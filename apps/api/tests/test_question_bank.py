import csv
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from recruitment.models import (
    Department,
    DepartmentRole,
    Membership,
    Organization,
    QuestionTemplate,
    QuestionTemplateEvent,
)

pytestmark = pytest.mark.django_db
URL = "/api/v1/question-templates/"


def client_for(membership):
    client = APIClient()
    client.force_login(membership.user)
    session = client.session
    session["membership_id"] = membership.id
    session.save()
    return client


@pytest.fixture
def team():
    org = Organization.objects.create(name="题库测试组织")
    other_org = Organization.objects.create(name="其他题库组织")
    department = Department.objects.create(organization=org, name="招聘部")
    other_department = Department.objects.create(organization=other_org, name="招聘部")
    people = {}
    for username, role, dept in (
        ("hr", "hr", department),
        ("supervisor", "supervisor", department),
        ("manager", "manager", department),
        ("interviewer", "interviewer", department),
        ("other", "hr", other_department),
    ):
        user = get_user_model().objects.create_user(username)
        membership = Membership.objects.create(user=user, organization=dept.organization)
        DepartmentRole.objects.create(membership=membership, department=dept, role=role)
        people[username] = membership
    return org, people


def create_question(client, **changes):
    response = client.post(
        URL,
        {"request_key": str(uuid.uuid4()), "content": "如何处理团队中的分歧？", **changes},
        format="json",
    )
    assert response.status_code == 201, response.data
    return response.data


def test_question_lifecycle_persists_and_audits(team):
    _, people = team
    client = client_for(people["hr"])
    question = create_question(client, content="  请说明你的项目经历。  ")
    assert question["content"] == "请说明你的项目经历。"
    assert question["difficulty"] == "中等"
    assert question["job_title"] == question["dimension"] == question["reference_answer"] == ""
    detail_url = f"{URL}{question['id']}/"
    assert client_for(people["hr"]).get(detail_url).data == question
    update = client.patch(
        detail_url,
        {
            "content": "请举例说明。",
            "job_title": "招聘专员",
            "dimension": "沟通表达",
            "difficulty": "困难",
            "reference_answer": "举例具体且表达清晰。",
            "version": 1,
        },
        format="json",
    )
    assert update.status_code == 200, update.data
    assert update.data["version"] == 2
    assert client.get(URL, {"q": "清晰"}).data["count"] == 1
    assert (
        client.patch(detail_url, {"version": 1, "content": "旧版本"}, format="json").status_code
        == 409
    )
    assert client.delete(detail_url, {"version": 1}, format="json").status_code == 409
    assert client.delete(detail_url, {"version": 2}, format="json").status_code == 200
    assert client.get(detail_url).status_code == 404
    assert client.get(URL).data["count"] == 0
    assert QuestionTemplate.objects.get(pk=question["id"]).deleted_at is not None
    assert list(QuestionTemplateEvent.objects.values_list("action", "version")) == [
        ("created", 1),
        ("updated", 2),
        ("deleted", 3),
    ]
    assert not QuestionTemplateEvent.objects.exclude(actor=people["hr"]).exists()


def test_filters_pagination_job_options_and_export(team):
    org, people = team
    client = client_for(people["hr"])
    for index in range(24):
        QuestionTemplate.objects.create(
            organization=org,
            request_key=uuid.uuid4(),
            content=f"专业问题 {index}",
            job_title="工程师",
            dimension="专业能力",
            difficulty="简单",
        )
    wanted = create_question(
        client,
        content='=1+1,"引号"\n下一行',
        job_title="招聘专员",
        dimension="沟通表达",
        difficulty="困难",
        reference_answer="@SUM(1,2)",
    )
    create_question(client_for(people["other"]), job_title="保密职位")
    first = client.get(URL).data
    assert first["count"] == 25 and len(first["items"]) == 20
    assert first["page"] == 1 and first["page_size"] == 20
    assert len(client.get(URL, {"page": 2}).data["items"]) == 5
    assert set(first["job_titles"]) == {"工程师", "招聘专员"}
    params = {"q": "引号", "job_title": "招聘专员", "dimension": "沟通表达", "difficulty": "困难"}
    assert client.get(URL, params).data["items"] == [wanted]
    for field, value in (
        ("job_title", "没有职位"),
        ("dimension", "学习能力"),
        ("difficulty", "中等"),
    ):
        assert client.get(URL, {**params, field: value}).data["count"] == 0
    assert client.get(URL).data["count"] == 25
    exported = client.get(f"{URL}export/", {**params, "page": 999})
    assert exported.status_code == 200
    assert exported.content.startswith(b"\xef\xbb\xbf")
    records = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig"))))
    assert records == [
        ["题目内容", "适用职位", "考察维度", "难度", "参考答案要点"],
        ['\'=1+1,"引号"\n下一行', "招聘专员", "沟通表达", "困难", "'@SUM(1,2)"],
    ]
    all_records = list(
        csv.reader(io.StringIO(client.get(f"{URL}export/").content.decode("utf-8-sig")))
    )
    assert len(all_records) == 26
    assert "保密职位" not in str(all_records)


def test_organization_isolation_and_role_permissions(team):
    _, people = team
    question = create_question(client_for(people["hr"]))
    detail_url = f"{URL}{question['id']}/"
    other = client_for(people["other"])
    assert other.get(URL).data["count"] == 0
    assert other.get(detail_url).status_code == 404
    assert (
        other.patch(detail_url, {"version": 1, "content": "越权"}, format="json").status_code == 404
    )
    assert other.delete(detail_url, {"version": 1}, format="json").status_code == 404
    for role in ("manager", "interviewer"):
        reader = client_for(people[role])
        assert reader.get(URL).data["can_manage"] is False
        assert reader.get(detail_url).status_code == reader.get(f"{URL}export/").status_code == 200
        assert reader.post(URL, {"content": "越权"}, format="json").status_code == 403
        assert reader.patch(detail_url, {"version": 1}, format="json").status_code == 403
        assert reader.delete(detail_url, {"version": 1}, format="json").status_code == 403
    assert client_for(people["supervisor"]).get(URL).data["can_manage"] is True
    create_question(client_for(people["supervisor"]))
    hr = client_for(people["hr"])
    people["hr"].active = False
    people["hr"].save()
    assert hr.get(URL).status_code == hr.get(f"{URL}export/").status_code == 403
    assert APIClient().get(URL).status_code == 403


@pytest.mark.parametrize(
    "changes",
    [
        {"content": " \n "},
        {"content": "题" * 10001},
        {"content": 123},
        {"content": None},
        {"job_title": "职" * 121},
        {"dimension": "未知"},
        {"difficulty": "未知"},
        {"difficulty": ""},
        {"reference_answer": "答" * 10001},
        {"request_key": "invalid"},
    ],
)
def test_reject_invalid_questions_without_writing(team, changes):
    _, people = team
    client = client_for(people["hr"])
    response = client.post(
        URL,
        {
            "request_key": str(uuid.uuid4()),
            "content": "测试问题",
            **changes,
        },
        format="json",
    )
    assert response.status_code == 400, response.data
    assert not QuestionTemplate.objects.exists()
    assert not QuestionTemplateEvent.objects.exists()


def test_required_version_bad_filters_and_non_object_input(team):
    _, people = team
    client = client_for(people["hr"])
    question = create_question(client)
    detail_url = f"{URL}{question['id']}/"
    for version in (None, 0, "invalid", True):
        assert client.patch(detail_url, {"version": version}, format="json").status_code == 400
    assert client.patch(detail_url, {"content": "改写"}, format="json").status_code == 400
    assert client.delete(detail_url, {}, format="json").status_code == 400
    for invalid_body in ([], "content", 123, None):
        assert client.post(URL, invalid_body, format="json").status_code == 400
    for params in ({"dimension": "未知"}, {"difficulty": "未知"}, {"q": "a" * 201}):
        assert client.get(URL, params).status_code == 400
        assert client.get(f"{URL}export/", params).status_code == 400
    assert client.get(URL, {"page": 0}).status_code == 404
    assert client.get(detail_url).data["version"] == 1


def test_create_retry_is_idempotent_and_cannot_restore_deleted_question(team):
    _, people = team
    client = client_for(people["hr"])
    payload = {"request_key": str(uuid.uuid4()), "content": "如何推进招聘？"}
    first = client.post(URL, payload, format="json")
    second = client.post(URL, payload, format="json")
    assert first.status_code == 201 and second.status_code == 200
    assert first.data == second.data
    assert QuestionTemplate.objects.count() == QuestionTemplateEvent.objects.count() == 1
    conflict = client.post(URL, {**payload, "content": "改过的问题"}, format="json")
    assert conflict.status_code == 409
    assert (
        client.delete(f"{URL}{first.data['id']}/", {"version": 1}, format="json").status_code == 200
    )
    assert client.post(URL, payload, format="json").status_code == 409
    assert QuestionTemplate.objects.count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("operation", ["create", "update"])
def test_concurrent_create_is_idempotent_and_update_rejects_stale_version(team, operation):
    assert connection.vendor == "postgresql"
    _, people = team
    question = create_question(client_for(people["hr"])) if operation == "update" else None
    clients = [client_for(people["hr"]), client_for(people["supervisor"])]
    barrier = Barrier(2)
    request_key = str(uuid.uuid4())

    def update(index):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            if operation == "create":
                return (
                    clients[index]
                    .post(
                        URL,
                        {"request_key": request_key, "content": "并发新增题目"},
                        format="json",
                    )
                    .status_code
                )
            return (
                clients[index]
                .patch(
                    f"{URL}{question['id']}/",
                    {"version": 1, "content": f"并发内容 {index}"},
                    format="json",
                )
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(update, range(2))) == (
            [200, 201] if operation == "create" else [200, 409]
        )
    assert QuestionTemplate.objects.count() == 1
    assert QuestionTemplate.objects.get().version == (1 if operation == "create" else 2)
    assert QuestionTemplateEvent.objects.count() == (1 if operation == "create" else 2)


def test_dashboard_count_excludes_other_organizations_and_deleted_questions(team):
    _, people = team
    client = client_for(people["hr"])
    question = create_question(client)
    create_question(client_for(people["other"]))
    assert client.get("/api/v1/dashboard/").data["other_totals"]["question_bank"] == 1
    client.delete(f"{URL}{question['id']}/", {"version": 1}, format="json")
    assert client.get("/api/v1/dashboard/").data["other_totals"]["question_bank"] == 0
