import json
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from identity.models import FeishuIdentity
from recruitment.models import Application, Candidate, Job, JobMember
from tests import test_jobs
from tests.test_jobs import client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def team(settings):
    settings.FEISHU_APP_ID = "test-current-app"
    team = test_jobs.team.__wrapped__()
    team[2].user.first_name = "本地经办人"
    team[2].user.save(update_fields=["first_name"])
    return team


def identity(member, **changes):
    return FeishuIdentity.objects.create(
        user=member.user,
        **{
            "app_id": "test-current-app",
            "open_id": f"private-open-{member.id}",
            "union_id": "private-union-id",
            "email": "private@example.test",
            "display_name": "飞书经办人",
            "avatar_url": "https://avatar.example.test/owner.png",
            "last_authenticated_at": timezone.now(),
            **changes,
        },
    )


def records(team):
    org, department, owner, manager, viewer = team
    job = Job.objects.create(
        organization=org,
        department=department,
        owner=owner,
        approver=manager,
        title="虚构画像职位",
        location="厦门",
        headcount=1,
    )
    JobMember.objects.create(job=job, membership=viewer)
    person = Candidate.objects.create(
        organization=org, created_by=owner, display_name="虚构画像人选"
    )
    application = Application.objects.create(
        organization=org, candidate=person, job=job, owner=owner, attempt_no=1, source=""
    )
    return job, application


def test_lists_and_details_show_record_owner_not_viewer(team):
    job, application = records(team)
    owner_identity = identity(team[2])
    identity(
        team[4], display_name="另一位访问者", avatar_url="https://avatar.example.test/viewer.png"
    )
    # 另一应用即使最近登录，也不能替代当前招聘应用的身份。
    identity(team[2], app_id="other-app", display_name="其他应用身份")
    client = client_for(team[4])
    for resource, item in [("jobs", job), ("applications", application)]:
        for path in [f"/api/v1/{resource}/", f"/api/v1/{resource}/{item.id}/"]:
            response = client.get(path)
            assert response.status_code == 200
            row = response.data["results"][0] if "results" in response.data else response.data
            assert row["owner_name"] == owner_identity.display_name
            assert row["owner_avatar_url"] == owner_identity.avatar_url
            link = urlsplit(row["owner_chat_url"])
            assert (link.scheme, link.netloc, link.path) == (
                "https",
                "applink.feishu.cn",
                "/client/chat/open",
            )
            assert parse_qs(link.query) == {"openId": [owner_identity.open_id]}
            assert not link.fragment
            # 私聊链接只携带必需的目标 openId，其他字段不能暴露飞书身份数据。
            without_link = {key: value for key, value in row.items() if key != "owner_chat_url"}
            assert "private-open-" not in json.dumps(without_link, default=str)
            assert b"private@example.test" not in response.content
            assert b"private-union-id" not in response.content
            assert not {"open_id", "union_id", "app_id"} & row.keys()


@pytest.mark.parametrize("fallback", ["unbound", "other_app", "blank", "no_app"])
def test_missing_identity_falls_back_without_borrowing_viewer(team, settings, fallback):
    records(team)
    identity(team[4], display_name="访问者姓名")
    if fallback == "other_app":
        identity(team[2], app_id="other-app")
    elif fallback == "blank":
        identity(team[2], display_name="   ", avatar_url="")
    elif fallback == "no_app":
        identity(team[2])
        settings.FEISHU_APP_ID = ""
    client = client_for(team[4])
    for resource in ["jobs", "applications"]:
        row = client.get(f"/api/v1/{resource}/").data["results"][0]
        assert row["owner_name"] == "本地经办人"
        assert row["owner_avatar_url"] == ""
        assert bool(row["owner_chat_url"]) == (fallback == "blank")


@pytest.mark.parametrize(
    "avatar",
    ["http://avatar.example.test/hr.png", "https://user:password@avatar.example.test/hr.png"],
)
def test_stored_unsafe_avatar_is_not_exposed(team, avatar):
    records(team)
    identity(team[2], avatar_url=avatar)
    for resource in ["jobs", "applications"]:
        row = client_for(team[4]).get(f"/api/v1/{resource}/").data["results"][0]
        assert row["owner_name"] == "飞书经办人"
        assert row["owner_avatar_url"] == ""


def test_multiple_bound_accounts_use_latest_authenticated_identity(team):
    records(team)
    identity(team[2], last_authenticated_at=timezone.now() - timedelta(days=1))
    identity(team[2], open_id="latest-private-id", display_name="最近登录经办人")
    identity(
        team[2],
        open_id="never-authenticated",
        display_name="未认证绑定",
        last_authenticated_at=None,
    )
    for resource in ["jobs", "applications"]:
        row = client_for(team[4]).get(f"/api/v1/{resource}/").data["results"][0]
        assert row["owner_name"] == "最近登录经办人"
        assert parse_qs(urlsplit(row["owner_chat_url"]).query) == {"openId": ["latest-private-id"]}


@pytest.mark.parametrize("open_id", ["", "   ", "private+id&appId=other#fragment"])
def test_chat_link_omits_empty_target_and_encodes_query(team, open_id):
    records(team)
    identity(team[2], open_id=open_id)
    for resource in ["jobs", "applications"]:
        row = client_for(team[4]).get(f"/api/v1/{resource}/").data["results"][0]
        if not open_id.strip():
            assert row["owner_chat_url"] == ""
        else:
            link = urlsplit(row["owner_chat_url"])
            assert parse_qs(link.query) == {"openId": [open_id]}
            assert not link.fragment


@pytest.mark.parametrize("resource", ["jobs", "applications"])
def test_list_batches_owner_identity_lookup(team, resource):
    records(team)
    identity(team[2])
    client = client_for(team[4])

    def identity_query_count():
        with CaptureQueriesContext(connection) as queries:
            response = client.get(f"/api/v1/{resource}/")
            assert response.status_code == 200
        return response.data["count"], sum(
            'FROM "identity_feishuidentity"' in query["sql"] for query in queries
        )

    assert identity_query_count() == (1, 1)
    for _ in range(4):
        records(team)
    assert identity_query_count() == (5, 1)
