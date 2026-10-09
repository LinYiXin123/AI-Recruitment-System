import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.db import close_old_connections

from recruitment.models import AuditEvent, DepartmentRole, Job, JobMember
from recruitment.serializers import (
    RECRUITMENT_SITES,
    NewJobSerializer,
    RecruitmentSitesSerializer,
)
from tests import test_jobs
from tests.test_jobs import action, client_for, new_job

pytestmark = pytest.mark.django_db


@pytest.fixture
def team():
    return test_jobs.team.__wrapped__()


def test_sites_create_read_default_and_request_replay(team):
    client = client_for(team[2])
    body = {
        "request_id": str(uuid.uuid4()),
        "title": "招聘网站测试职位",
        "department": team[1].id,
        "approver": team[3].id,
        "location": "深圳",
        "headcount": 1,
        "recruitment_sites": list(RECRUITMENT_SITES),
    }
    created = client.post("/api/v1/jobs/", body, format="json")
    assert created.status_code == 201, created.data
    job = created.data
    assert job["recruitment_sites"] == list(RECRUITMENT_SITES)
    assert Job.objects.get(pk=job["id"]).recruitment_sites == job["recruitment_sites"]
    assert client.get(f"/api/v1/jobs/{job['id']}/").data["recruitment_sites"] == list(
        RECRUITMENT_SITES
    )
    assert client.get("/api/v1/jobs/").data["results"][0]["recruitment_sites"] == list(
        RECRUITMENT_SITES
    )
    replay = client.post("/api/v1/jobs/", body, format="json")
    assert replay.status_code == 200 and replay.data["id"] == job["id"]
    changed = client.post("/api/v1/jobs/", {**body, "recruitment_sites": ["猎聘"]}, format="json")
    assert changed.status_code == 409
    assert Job.objects.count() == AuditEvent.objects.count() == 1
    assert new_job(team)["recruitment_sites"] == []


@pytest.mark.parametrize("serializer_class", [NewJobSerializer, RecruitmentSitesSerializer])
@pytest.mark.parametrize(
    "value",
    [
        None,
        "BOSS直聘",
        {},
        True,
        1,
        ["BOSS直聘", "BOSS直聘"],
        ["未知网站"],
        [None],
        [{}],
        list(RECRUITMENT_SITES) + ["其他"],
    ],
)
def test_sites_reject_non_lists_duplicates_unknown_and_excess_entries(serializer_class, value):
    serializer = serializer_class(
        data={
            "request_id": str(uuid.uuid4()),
            "title": "招聘网站测试职位",
            "department": 1,
            "approver": 2,
            "location": "深圳",
            "headcount": 1,
            "version": 1,
            "recruitment_sites": value,
        }
    )
    assert not serializer.is_valid()
    assert "recruitment_sites" in serializer.errors


def test_sites_update_clear_require_field_and_reject_stale_version(team):
    client = client_for(team[2])
    job = new_job(team, salary_range="10-15K", recruitment_sites=["BOSS直聘"])
    changed = action(client, job, "recruitment-sites", recruitment_sites=["猎聘", "智联招聘"])
    assert changed.status_code == 200, changed.data
    current = changed.data
    assert current["recruitment_sites"] == ["猎聘", "智联招聘"]
    assert current["salary_range"] == "10-15K"
    assert current["version"] == job["version"] + 1
    event = AuditEvent.objects.get(job_id=job["id"], action="修改招聘网站")
    assert event.actor_id == team[2].id and event.job_version == current["version"]
    assert event.note == "猎聘、智联招聘"
    assert action(client, job, "recruitment-sites", recruitment_sites=[]).status_code == 409
    assert action(client, current, "recruitment-sites").status_code == 400
    assert (
        action(client, current, "recruitment-sites", recruitment_sites=["猎聘", "猎聘"]).status_code
        == 400
    )
    saved = Job.objects.get(pk=job["id"])
    assert saved.recruitment_sites == current["recruitment_sites"]
    assert saved.version == current["version"]
    assert AuditEvent.objects.filter(job=saved).count() == 2
    cleared = action(client, current, "recruitment-sites", recruitment_sites=[])
    assert cleared.status_code == 200 and cleared.data["recruitment_sites"] == []
    assert cleared.data["version"] == current["version"] + 1
    assert client.get(f"/api/v1/jobs/{job['id']}/").data["recruitment_sites"] == []


def test_sites_update_keeps_job_scope_edit_permission_and_closed_guard(team):
    owner, manager, other = (client_for(person) for person in team[2:])
    job = new_job(team)
    payload = {"recruitment_sites": ["BOSS直聘"]}
    assert action(manager, job, "recruitment-sites", **payload).status_code == 403
    assert action(other, job, "recruitment-sites", **payload).status_code == 404
    JobMember.objects.create(job_id=job["id"], membership=team[4])
    changed = action(other, job, "recruitment-sites", **payload)
    assert changed.status_code == 200
    job = changed.data
    DepartmentRole.objects.filter(membership=team[4], role="hr").delete()
    assert action(other, job, "recruitment-sites", **payload).status_code == 404
    Job.objects.filter(pk=job["id"]).update(status="closed")
    assert action(owner, job, "recruitment-sites", recruitment_sites=[]).status_code == 400
    saved = Job.objects.get(pk=job["id"])
    assert saved.recruitment_sites == ["BOSS直聘"] and saved.version == job["version"]
    assert AuditEvent.objects.filter(job=saved, action="修改招聘网站").count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_site_updates_only_one_commits(team):
    job = new_job(team)
    clients = [client_for(team[2]), client_for(team[2])]
    ready = Barrier(2)

    def update(index):
        close_old_connections()
        try:
            ready.wait(timeout=5)
            return action(
                clients[index],
                job,
                "recruitment-sites",
                recruitment_sites=[RECRUITMENT_SITES[index]],
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(update, range(2)))
    assert sorted(results) == [200, 409]
    saved = Job.objects.get(pk=job["id"])
    assert saved.recruitment_sites == [RECRUITMENT_SITES[results.index(200)]]
    assert saved.version == job["version"] + 1
    assert AuditEvent.objects.filter(job=saved, action="修改招聘网站").count() == 1
