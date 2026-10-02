import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

import pytest
from django.db import close_old_connections
from django.utils import timezone

from recruitment.llm import LLMServiceError
from recruitment.models import (
    AuditEvent,
    DepartmentRole,
    Job,
    ProfileGeneration,
    ProfileVersion,
    Task,
)
from tests import test_jobs
from tests.test_jobs import action, client_for, new_job, save_profile

pytestmark = pytest.mark.django_db


@pytest.fixture
def team():
    return test_jobs.team.__wrapped__()


def generated_requirement(**changes):
    return {
        "kind": "must",
        "text": "能独立完成需求分析",
        "rationale": "核实本人项目职责",
        "needs_verification": False,
        "source_kind": "jd",
        "source_quote": "负责招聘业务产品与需求分析",
        "source_reference": "jd",
        **changes,
    }


def body(job, **changes):
    return {
        "version": job["version"],
        "request_key": str(uuid.uuid4()),
        "jd": "负责招聘业务产品与需求分析",
        "business_goal": "减少重复录入",
        **changes,
    }


def generate(client, job, payload=None, **changes):
    return client.post(
        f"/api/v1/jobs/{job['id']}/profile-ai/", payload or body(job, **changes), format="json"
    )


def test_generate_save_edit_and_hr_directly_use_without_approval(team, settings):
    settings.LLM_MODEL = "fake-test-model"
    c = client_for(team[2])
    job = new_job(team)
    payload = body(job)
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps(
            {
                "requirements": [generated_requirement()],
            }
        ),
    ) as model:
        first = generate(c, job, payload)
        assert first.status_code == 200, first.data
        result = first.data
        assert result["status"] == "succeeded"
        assert generate(c, job, payload).data == result
        assert model.call_count == 1
        assert "减少重复录入" in model.call_args.kwargs["user_text"]
    assert not ProfileVersion.objects.exists()
    job = save_profile(
        c,
        job,
        requirements=result["requirements"],
        generation_id=result["id"],
        business_goal="减少重复录入",
        activate=True,
    ).data
    profile = job["latest_profile"]
    assert profile["status"] == "confirmed"
    assert profile["confirmed_by_name"] == "hr"
    assert profile["business_goal"] == "减少重复录入"
    assert job["active_profile"] == profile["id"]
    assert not Task.objects.filter(kind="review").exists()
    assert Task.objects.get(kind="start").status == "pending"
    requirement = profile["requirements"][0]
    assert requirement["source_quote"] == payload["jd"]
    assert requirement["source_edited"] is False
    edited = {**requirement, "text": "能独立完成并复盘需求分析"}
    newer = save_profile(c, job, requirements=[edited], activate=True).data
    assert newer["latest_profile"]["requirements"][0]["source_edited"] is True
    assert newer["latest_profile"]["requirements"][0]["source_quote"] == payload["jd"]
    assert newer["latest_profile"]["business_goal"] == "减少重复录入"
    assert (
        ProfileVersion.objects.get(pk=profile["id"]).requirements.get().text == requirement["text"]
    )
    assert newer["latest_profile"]["number"] == 2
    assert AuditEvent.objects.filter(action__startswith="HR 直接使用").count() == 2


def test_hr_can_use_pending_profile_closing_approval_and_stale_approval_is_rejected(team):
    c, manager = client_for(team[2]), client_for(team[3])
    job = save_profile(c, new_job(team)).data
    pending = action(c, job, "submit-profile").data
    used = action(c, pending, "activate-profile")
    assert used.status_code == 200, used.data
    assert Task.objects.get(kind="review").status == "done"
    assert used.data["latest_profile"]["confirmed_by_name"] == "hr"
    assert used.data["latest_profile"]["activated_by_hr"] is True
    assert action(manager, pending, "review-profile", outcome="confirm").status_code == 409
    assert action(c, pending, "activate-profile").status_code == 409
    team[3].active = False
    team[3].save()
    assert action(c, used.data, "change-status", status="open").status_code == 200


def test_use_checks_hr_scope_unresolved_requirements_and_pending_questions(team):
    c = client_for(team[2])
    job = new_job(team)
    requirements = [{"kind": "must", "text": "需要确认的经验", "needs_verification": True}]
    assert save_profile(c, job, requirements=requirements, activate=True).status_code == 400
    assert not ProfileVersion.objects.exists()
    job = save_profile(c, job, requirements=requirements).data
    assert action(c, job, "activate-profile").status_code == 400
    assert action(client_for(team[3]), job, "activate-profile").status_code == 403
    assert action(client_for(team[4]), job, "activate-profile").status_code == 404
    job = save_profile(c, job).data
    clarification = c.post(
        f"/api/v1/jobs/{job['id']}/clarifications/",
        {
            "version": job["version"],
            "profile": job["latest_profile"]["id"],
            "requirement": job["latest_profile"]["requirements"][0]["id"],
            "question": "需要独立负责吗？",
            "request_key": str(uuid.uuid4()),
        },
        format="json",
    )
    assert clarification.status_code == 201
    job = c.get(f"/api/v1/jobs/{job['id']}/").data
    assert action(c, job, "activate-profile").status_code == 400
    assert save_profile(c, job, activate=True).status_code == 400


@pytest.mark.parametrize(
    "result",
    [
        "not json",
        json.dumps({"requirements": []}),
        json.dumps({"requirements": [generated_requirement(source_quote="不存在的原文")]}),
        json.dumps({"requirements": [generated_requirement(needs_verification="false")]}),
    ],
)
def test_invalid_output_is_retained_as_failed_input_and_cannot_be_adopted(team, result):
    c = client_for(team[2])
    job = new_job(team)
    with patch("recruitment.profile_ai.chat_completion", return_value=result):
        response = generate(c, job)
    assert response.data["status"] == "failed"
    assert response.data["requirements"] == []
    assert response.data["input"]["business_goal"] == "减少重复录入"
    assert c.get(f"/api/v1/jobs/{job['id']}/profile-ai/").data["items"][0] == response.data
    assert save_profile(c, job, generation_id=response.data["id"]).status_code == 404
    assert not ProfileVersion.objects.exists()


def test_model_failure_does_not_repeat_same_request_and_ai_suggestions_require_review(team):
    c = client_for(team[2])
    job = new_job(team)
    payload = body(job)
    with patch(
        "recruitment.profile_ai.chat_completion", side_effect=LLMServiceError("timeout")
    ) as m:
        assert generate(c, job, payload).data["status"] == "failed"
        assert generate(c, job, payload).data["status"] == "failed"
        assert m.call_count == 1
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps(
            {
                "requirements": [
                    generated_requirement(
                        source_kind="ai_suggestion",
                        source_quote="",
                        source_reference="",
                    )
                ],
            }
        ),
    ):
        result = generate(c, job).data
    assert result["requirements"][0]["needs_verification"] is True
    assert (
        save_profile(
            c,
            job,
            generation_id=result["id"],
            requirements=result["requirements"],
            activate=True,
        ).status_code
        == 400
    )


@pytest.mark.parametrize("change", ["version", "revoke"])
def test_changes_during_generation_reject_result_and_never_create_profile(team, change):
    c = client_for(team[2])
    job = new_job(team)

    def respond(**kwargs):
        if change == "version":
            Job.objects.filter(pk=job["id"]).update(version=job["version"] + 1)
        else:
            DepartmentRole.objects.filter(membership=team[2], role="hr").delete()
        return json.dumps({"requirements": [generated_requirement()]})

    with patch("recruitment.profile_ai.chat_completion", side_effect=respond):
        response = generate(c, job)
    assert response.status_code == (409 if change == "version" else 404)
    assert ProfileGeneration.objects.get().status == "stale"
    assert ProfileGeneration.objects.get().result == []
    assert not ProfileVersion.objects.exists()


def test_generation_scope_request_payload_and_requirement_provenance(team):
    c = client_for(team[2])
    job = new_job(team)
    other = new_job(team)
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps(
            {
                "requirements": [generated_requirement()],
            }
        ),
    ) as model:
        assert generate(client_for(team[3]), job).status_code == 403
        assert generate(client_for(team[4]), job).status_code == 404
        assert model.call_count == 0
        payload = body(job)
        result = generate(c, job, payload).data
        assert generate(c, job, {**payload, "jd": "已更改的输入"}).status_code == 409
    assert save_profile(c, other, generation_id=result["id"]).status_code == 404
    adopted = save_profile(
        c,
        job,
        generation_id=result["id"],
        requirements=result["requirements"],
    ).data
    assert (
        save_profile(c, other, requirements=adopted["latest_profile"]["requirements"]).status_code
        == 404
    )
    assert save_profile(c, adopted, generation_id=result["id"]).status_code == 409


@pytest.mark.django_db(transaction=True)
def test_concurrent_generation_retry_does_not_hold_job_lock_or_call_model_twice(team):
    c = client_for(team[2])
    job = new_job(team)
    payload = body(job)
    entered, release = Event(), Event()

    def respond(**kwargs):
        entered.set()
        assert release.wait(10)
        return json.dumps({"requirements": [generated_requirement()]})

    def run():
        close_old_connections()
        try:
            return generate(client_for(team[2]), job, payload)
        finally:
            close_old_connections()

    with patch("recruitment.profile_ai.chat_completion", side_effect=respond) as model:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(run)
            assert entered.wait(10)
            try:
                replay = generate(c, job, payload)
                assert replay.data["status"] == "running"
                # 模型等待期间岗位仍能保存；返回结果必须拒绝过期版本。
                assert save_profile(c, job).status_code == 201
            finally:
                release.set()
            assert first.result().status_code == 409
        assert model.call_count == 1
    assert ProfileGeneration.objects.count() == 1
    assert ProfileGeneration.objects.get().status == "stale"


def test_interrupted_generation_preserves_input_without_an_automatic_retry(team):
    c = client_for(team[2])
    job = new_job(team)
    payload = body(job)
    row = ProfileGeneration.objects.create(
        job_id=job["id"],
        creator=team[2],
        request_key=payload["request_key"],
        job_version=job["version"],
        model="fake",
        prompt_version="test",
        input_snapshot={"jd": payload["jd"], "business_goal": payload["business_goal"]},
    )
    ProfileGeneration.objects.filter(pk=row.pk).update(
        updated_at=timezone.now() - timezone.timedelta(minutes=3)
    )
    with patch("recruitment.profile_ai.chat_completion") as model:
        rows = c.get(f"/api/v1/jobs/{job['id']}/profile-ai/").data["items"]
        assert rows[0]["status"] == "failed"
        assert generate(c, job, payload).data["status"] == "failed"
        model.assert_not_called()
