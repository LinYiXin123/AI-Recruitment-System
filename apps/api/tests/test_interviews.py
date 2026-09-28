import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.db import close_old_connections
from django.utils import timezone

from recruitment.models import Interview, InterviewParticipant, InterviewRevision, StageEvent, Task
from tests import test_jobs
from tests.test_intake import confirm, detail, recruiting, review, upload
from tests.test_jobs import client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def team():
    return test_jobs.team.__wrapped__()


@pytest.fixture(autouse=True)
def private_files(settings, tmp_path):
    settings.PRIVATE_RESUME_ROOT = tmp_path / "resumes"


def ready_application(team, name="虚构小林"):
    client = client_for(team[2])
    url, item, _ = upload(client, recruiting(team))
    item = confirm(client, url, item, display_name=name).data
    return detail(client, item)


def advance(client, app):
    response = review(client, app)
    assert response.status_code == 200, response.data
    return response.data


def schedule_body(app, participant, **changes):
    starts_at = timezone.now().replace(second=0, microsecond=0) + timedelta(days=2)
    starts_at = starts_at.replace(hour=10, minute=0)
    body = {
        "application": app["id"],
        "version": app["version"],
        "request_key": str(uuid.uuid4()),
        "round_no": 1,
        "purpose": "核实需求分析方法与跨团队协作经历",
        "starts_at": starts_at.isoformat(),
        "ends_at": (starts_at + timedelta(hours=1)).isoformat(),
        "timezone": "Asia/Shanghai",
        "mode": "onsite",
        "location": "深圳南山区会议室 A",
        "meeting_url": "",
        "participants": [participant.id],
    }
    body.update(changes)
    return body


def schedule(client, app, participant, **changes):
    body = schedule_body(app, participant, **changes)
    return client.post("/api/v1/interviews/", body, format="json"), body


def test_schedule_writes_versioned_interview_and_retries_safely(team):
    client = client_for(team[2])
    app = advance(client, ready_application(team))
    response, body = schedule(client, app, team[3])
    assert response.status_code == 201, response.data
    assert response.data["status"] == "pending_confirmation"
    assert response.data["invitation_status"] == "not_sent"
    assert response.data["revision"]["participants"] == [
        {"id": team[3].id, "name": "manager", "required": True, "duty": "interviewer"}
    ]
    assert Interview.objects.count() == 1
    assert InterviewRevision.objects.count() == 1
    assert InterviewParticipant.objects.count() == 1
    assert client.get(f"/api/v1/applications/{app['id']}/").data["stage"] == "interviewing"
    assert Task.objects.get(application_id=app["id"], kind="schedule").status == "done"
    assert StageEvent.objects.get(application_id=app["id"], to_stage="interviewing")
    replay = client.post("/api/v1/interviews/", body, format="json")
    assert replay.status_code == 200 and Interview.objects.count() == 1
    assert client.get("/api/v1/interviews/").data["results"][0]["candidate_name"] == "虚构小林"


def test_schedule_rejects_invalid_participants_and_conflicts(team):
    client = client_for(team[2])
    first = advance(client, ready_application(team, "虚构小林"))
    bad, _ = schedule(client, first, team[2])
    assert bad.status_code == 400
    first_response, body = schedule(client, first, team[3])
    assert first_response.status_code == 201, first_response.data

    other = advance(client, ready_application(team, "虚构小周"))
    participant_conflict, _ = schedule(client, other, team[3], request_key=str(uuid.uuid4()))
    assert participant_conflict.status_code == 409
    assert "manager" in str(participant_conflict.data)

    second_job = recruiting(team)
    entry = client.post(
        f"/api/v1/candidates/{first['candidate']}/apply/",
        {"request_key": str(uuid.uuid4()), "job": second_job["id"], "source": "人工加入"},
        format="json",
    )
    assert entry.status_code == 200
    same_person = advance(
        client, client.get(f"/api/v1/applications/{entry.data['application']}/").data
    )
    candidate_conflict, _ = schedule(
        client,
        same_person,
        team[3],
        request_key=str(uuid.uuid4()),
        starts_at=body["starts_at"],
        ends_at=body["ends_at"],
    )
    assert candidate_conflict.status_code == 409
    assert "候选人虚构小林" in str(candidate_conflict.data)
    assert schedule(client_for(team[4]), same_person, team[3])[0].status_code == 403


@pytest.mark.django_db(transaction=True)
def test_concurrent_candidate_schedule_only_creates_one_appointment(team):
    client = client_for(team[2])
    first = advance(client, ready_application(team))
    second_job = recruiting(team)
    entry = client.post(
        f"/api/v1/candidates/{first['candidate']}/apply/",
        {"request_key": str(uuid.uuid4()), "job": second_job["id"], "source": "人工加入"},
        format="json",
    )
    second = advance(client, client.get(f"/api/v1/applications/{entry.data['application']}/").data)
    request = schedule_body(first, team[3])
    starts_at, ends_at = request["starts_at"], request["ends_at"]
    barrier = Barrier(2)

    def create(app):
        close_old_connections()
        concurrent_client = client_for(team[2])
        body = {
            **request,
            "application": app["id"],
            "version": app["version"],
            "request_key": str(uuid.uuid4()),
            "starts_at": starts_at,
            "ends_at": ends_at,
        }
        barrier.wait()
        response = concurrent_client.post("/api/v1/interviews/", body, format="json")
        close_old_connections()
        return response.status_code

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(create, [first, second]))
    assert sorted(results) == [201, 409]
    assert Interview.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_retry_with_same_request_key_returns_saved_interview(team):
    client = client_for(team[2])
    app = advance(client, ready_application(team))
    request = schedule_body(app, team[3])
    barrier = Barrier(2)

    def create():
        close_old_connections()
        concurrent_client = client_for(team[2])
        barrier.wait()
        response = concurrent_client.post("/api/v1/interviews/", request, format="json")
        close_old_connections()
        return response.status_code

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: create(), range(2)))
    assert sorted(results) == [200, 201]
    assert Interview.objects.count() == 1
