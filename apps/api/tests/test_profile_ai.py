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
                "requirements": [generated_requirement(category="skill")],
            }
        ),
    ) as model:
        first = generate(c, job, payload)
        assert first.status_code == 200, first.data
        result = first.data
        assert result["status"] == "succeeded"
        assert result["requirements"][0]["category"] == "skill"
        assert generate(c, job, payload).data == result
        assert model.call_count == 1
        assert model.call_args.kwargs["thinking"] == {"type": "disabled"}
        assert model.call_args.kwargs["max_tokens"] == 8000
        assert model.call_args.kwargs["response_format"] == {"type": "json_object"}
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
    assert requirement["category"] == "skill"
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


def test_generate_job_description_is_versioned_and_does_not_save_the_job(team, settings):
    settings.LLM_MODEL = "fake-test-model"
    c = client_for(team[2])
    job = new_job(team)
    payload = {
        "request_key": str(uuid.uuid4()),
        "version": job["version"],
        "jd": "",
        "business_goal": "完成渠道试点并复盘结果",
    }
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps({"jd": "负责渠道拓展，推进合作并复盘结果。"}),
    ) as model:
        result = c.post(
            f"/api/v1/jobs/{job['id']}/job-description-ai/", payload, format="json"
        )
        assert result.status_code == 200, result.data
        assert result.data["status"] == "succeeded"
        assert result.data["jd"] == "负责渠道拓展，推进合作并复盘结果。"
        assert c.post(
            f"/api/v1/jobs/{job['id']}/job-description-ai/", payload, format="json"
        ).data == result.data
        assert model.call_count == 1
        assert "不得编造" in model.call_args.kwargs["system_prompt"]

    generation = ProfileGeneration.objects.get(pk=result.data["id"])
    assert generation.purpose == "job_description"
    assert generation.job_version == job["version"]
    assert generation.input_snapshot["business_goal"] == payload["business_goal"]
    saved_job = Job.objects.get(pk=job["id"])
    assert saved_job.jd == job["jd"]
    assert saved_job.profiles.count() == 0


@pytest.mark.parametrize("field", ["jd", "business_goal"])
@pytest.mark.parametrize("activate", [False, True])
def test_existing_job_rejects_changed_ai_input_without_changing_saved_state(team, field, activate):
    c = client_for(team[2])
    job = save_profile(c, new_job(team), business_goal="减少重复录入", activate=True).data
    payload = body(job)
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps({"requirements": [generated_requirement()]}),
    ):
        result = generate(c, job, payload).data
    events, tasks = AuditEvent.objects.count(), list(Task.objects.values())
    response = save_profile(
        c,
        job,
        generation_id=result["id"],
        requirements=result["requirements"],
        activate=activate,
        **{field: "已改变的岗位输入"},
    )
    assert response.status_code == 409
    assert "岗位需求或业务目标已改变" in str(response.data)
    assert c.get(f"/api/v1/jobs/{job['id']}/").data == job
    assert ProfileVersion.objects.count() == 1
    assert AuditEvent.objects.count() == events and list(Task.objects.values()) == tasks
    generation = ProfileGeneration.objects.get(pk=result["id"])
    assert generation.status == "succeeded" and generation.input_snapshot == result["input"]

    # 恢复生成输入后可继续使用同一草稿；省略目标沿用已有版本，首尾空白由表单规范化。
    edited = {**result["requirements"][0], "text": "独立完成需求分析及结果复盘"}
    retry = save_profile(
        c,
        job,
        jd=f" \n{payload['jd']}\n ",
        generation_id=result["id"],
        requirements=[edited],
        activate=activate,
    )
    assert retry.status_code == 201, retry.data
    profile = retry.data["latest_profile"]
    assert profile["business_goal"] == payload["business_goal"]
    assert profile["requirements"][0]["source_edited"] is True
    assert profile["requirements"][0]["source_quote"] == payload["jd"]
    assert profile["status"] == ("confirmed" if activate else "draft")
    assert ProfileVersion.objects.get(pk=job["active_profile"]).status == "confirmed"


def test_existing_job_cannot_omit_generated_goal_but_can_save_manual_requirements(team):
    c = client_for(team[2])
    job = new_job(team)
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps({"requirements": [generated_requirement()]}),
    ):
        result = generate(c, job).data
    assert (
        save_profile(
            c, job, generation_id=result["id"], requirements=result["requirements"]
        ).status_code
        == 409
    )
    assert not ProfileVersion.objects.exists()
    # 手工整理必须显式去掉生成编号及条目索引，不能保留伪造的 AI 引文。
    assert save_profile(c, job, requirements=result["requirements"]).status_code == 400
    manual = {
        key: value for key, value in result["requirements"][0].items() if key != "generation_index"
    }
    saved = save_profile(
        c, job, jd="调整后的岗位需求", source="HR 手工整理", requirements=[manual], activate=True
    )
    assert saved.status_code == 201, saved.data
    profile = ProfileVersion.objects.get(pk=saved.data["active_profile"])
    requirement = profile.requirements.get()
    assert profile.generation_id is None and requirement.generation_id is None
    assert requirement.source_kind == "manual" and requirement.source_quote == ""


@pytest.mark.parametrize("field", ["jd", "business_goal"])
def test_manual_revision_keeps_historical_ai_source_and_marks_changed_context(team, field):
    c = client_for(team[2])
    job = new_job(team)
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps({"requirements": [generated_requirement()]}),
    ):
        result = generate(c, job).data
    job = save_profile(
        c,
        job,
        business_goal=result["input"]["business_goal"],
        generation_id=result["id"],
        requirements=result["requirements"],
        activate=True,
    ).data
    original = ProfileVersion.objects.get(pk=job["active_profile"])
    revised = save_profile(
        c,
        job,
        source="HR 调整已有标准",
        requirements=job["latest_profile"]["requirements"],
        activate=True,
        **{field: "HR 调整后的岗位输入"},
    )
    assert revised.status_code == 201, revised.data
    profile = ProfileVersion.objects.get(pk=revised.data["active_profile"])
    requirement = profile.requirements.get()
    assert profile.generation_id is None
    assert requirement.generation_id == original.generation_id == result["id"]
    assert requirement.source_quote == result["input"]["jd"]
    assert requirement.source_edited is True
    assert original.requirements.get().source_edited is False
    assert original.jd_snapshot == result["input"]["jd"]
    assert original.business_goal == result["input"]["business_goal"]


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


@pytest.mark.parametrize(
    "failure",
    [
        "模型服务返回 HTTP 429",
        "模型服务网络连接失败或超时",
        "模型输出达到长度上限，回复可能被截断",
    ],
)
def test_model_failure_does_not_repeat_same_request_and_ai_suggestions_require_review(
    team, settings, failure
):
    settings.LLM_API_BASE_URL = "https://model.example/v1"
    settings.LLM_API_KEY = "unit-test-token"
    settings.LLM_MODEL = "fake-test-model"
    c = client_for(team[2])
    job = new_job(team)
    payload = body(job)
    with patch("recruitment.profile_ai.chat_completion", side_effect=LLMServiceError(failure)) as m:
        first = generate(c, job, payload)
        assert first.status_code == 200
        assert first.data["status"] == "failed"
        assert first.data["error"] == f"{failure}；输入已保留，请重试或继续手动填写。"
        assert first.data["input"]["jd"] == payload["jd"]
        assert first.data["input"]["business_goal"] == payload["business_goal"]
        assert first.data["requirements"] == []
        assert generate(c, job, payload).data == first.data
        assert m.call_count == 1
    saved = ProfileGeneration.objects.get(pk=first.data["id"])
    assert saved.input_snapshot == first.data["input"]
    assert saved.error == first.data["error"]
    assert not ProfileVersion.objects.exists()
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
            business_goal=result["input"]["business_goal"],
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
        business_goal=result["input"]["business_goal"],
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


def preview_payload(**changes):
    return {
        "request_key": str(uuid.uuid4()),
        "jd": "负责招聘业务产品与需求分析",
        "business_goal": "减少重复录入",
        **changes,
    }


def preview(client, payload):
    return client.post("/api/v1/jobs/profile-ai/", payload, format="json")


def create_with_preview(team, result, **changes):
    return {
        "request_id": str(uuid.uuid4()),
        "title": "预览后创建的测试职位",
        "department": team[1].pk,
        "location": "深圳",
        "headcount": 1,
        "approver": team[3].pk,
        "jd": result["input"]["jd"],
        "profile": {
            "generation_id": result["id"],
            "source": "AI 起草后由 HR 核对",
            "business_goal": result["input"]["business_goal"],
            "requirements": result["requirements"],
            "activate": True,
        },
        **changes,
    }


def successful_preview(c, payload=None):
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps(
            {
                "requirements": [generated_requirement()],
            }
        ),
    ):
        response = preview(c, payload or preview_payload())
    assert response.status_code == 200, response.data
    assert response.data["status"] == "succeeded", response.data
    return response.data


def test_preview_generates_before_any_job_and_saves_once_with_edited_sources(team):
    c = client_for(team[2])
    payload = preview_payload()
    with patch(
        "recruitment.profile_ai.chat_completion",
        return_value=json.dumps(
            {
                "requirements": [generated_requirement()],
            }
        ),
    ) as model:
        result = preview(c, payload).data
        assert result["job"] is None and result["job_version"] is None
        assert result["is_current"] is True
        assert preview(c, payload).data == result
        assert model.call_count == 1
        assert model.call_args.kwargs["thinking"] == {"type": "disabled"}
        assert model.call_args.kwargs["max_tokens"] == 8000
        assert model.call_args.kwargs["response_format"] == {"type": "json_object"}
    assert not Job.objects.exists()
    assert not ProfileVersion.objects.exists()
    assert not Task.objects.exists()
    assert c.get("/api/v1/jobs/profile-ai/").data["items"] == [result]
    data = create_with_preview(team, result)
    data["profile"]["requirements"][0]["text"] = "独立完成需求分析，并验证结果"
    data["profile"]["requirements"][0]["source_quote"] = "客户端伪造的来源会被忽略"
    saved = c.post("/api/v1/jobs/", data, format="json")
    assert saved.status_code == 201, saved.data
    profile = saved.data["latest_profile"]
    assert profile["status"] == "confirmed" and profile["activated_by_hr"]
    assert saved.data["active_profile"] == profile["id"]
    assert profile["requirements"][0]["source_edited"] is True
    assert profile["requirements"][0]["source_quote"] == payload["jd"]
    assert ProfileGeneration.objects.get().job_id == saved.data["id"]
    assert c.get("/api/v1/jobs/profile-ai/").data["items"] == []
    replay = c.post("/api/v1/jobs/", data, format="json")
    assert replay.status_code == 200 and replay.data["id"] == saved.data["id"]
    with patch("recruitment.profile_ai.chat_completion") as model:
        assert preview(c, payload).data["job"] == saved.data["id"]
        model.assert_not_called()
    assert Job.objects.count() == ProfileVersion.objects.count() == 1
    assert AuditEvent.objects.count() == 2
    # 后续版本不能替代原创建请求的画像内容参与幂等比较。
    revised = c.post(
        f"/api/v1/jobs/{saved.data['id']}/profiles/",
        {
            "version": saved.data["version"],
            "jd": data["jd"],
            "source": "HR 后续调整",
            "activate": True,
            "requirements": [{"kind": "must", "text": "完成需求梳理及上线验证"}],
        },
        format="json",
    )
    assert revised.status_code == 201, revised.data
    replay = c.post("/api/v1/jobs/", data, format="json")
    assert replay.status_code == 200 and replay.data["id"] == saved.data["id"]
    assert replay.data["latest_profile"]["number"] == 2
    assert Job.objects.count() == 1


@pytest.mark.parametrize("change", ["text", "source", "business_goal", "activate", "omit"])
def test_creation_retry_cannot_silently_ignore_changed_profile(team, change):
    c = client_for(team[2])
    data = create_with_preview(team, successful_preview(c))
    assert c.post("/api/v1/jobs/", data, format="json").status_code == 201
    if change == "text":
        data["profile"]["requirements"][0]["text"] = "不同的岗位要求"
    elif change == "omit":
        data.pop("profile")
    elif change == "activate":
        data["profile"][change] = False
    else:
        data["profile"][change] = "不同的内容"
    assert c.post("/api/v1/jobs/", data, format="json").status_code == 409
    assert Job.objects.count() == ProfileVersion.objects.count() == 1


@pytest.mark.parametrize("change", ["jd", "business_goal", "blank", "pending", "index", "id"])
def test_preview_creation_rejects_stale_invalid_input_and_rolls_back_binding(team, change):
    c = client_for(team[2])
    result = successful_preview(c)
    data = create_with_preview(team, result)
    if change == "jd":
        data["jd"] = "已改变的岗位需求"
    elif change == "business_goal":
        data["profile"]["business_goal"] = "已改变的业务目标"
    elif change == "blank":
        data["jd"] = "  \n  "
    elif change == "pending":
        data["profile"]["requirements"][0]["needs_verification"] = True
    else:
        field = "generation_index" if change == "index" else "id"
        data["profile"]["requirements"][0][field] = 9999
    response = c.post("/api/v1/jobs/", data, format="json")
    assert response.status_code == (409 if change in ["jd", "business_goal"] else 400)
    assert not Job.objects.exists()
    assert not ProfileVersion.objects.exists()
    assert not Task.objects.exists()
    assert not AuditEvent.objects.exists()
    assert ProfileGeneration.objects.get().job_id is None


def test_preview_scope_binding_once_and_ordinary_creation_retry_are_separate(team):
    c = client_for(team[2])
    result = successful_preview(c)
    assert preview(client_for(team[3]), preview_payload()).status_code == 403
    assert client_for(team[4]).get("/api/v1/jobs/profile-ai/").data["items"] == []
    data = create_with_preview(team, result)
    assert client_for(team[4]).post("/api/v1/jobs/", data, format="json").status_code == 404
    assert not Job.objects.exists()
    assert c.post("/api/v1/jobs/", data, format="json").status_code == 201
    another = create_with_preview(team, result)
    assert c.post("/api/v1/jobs/", another, format="json").status_code == 409
    assert Job.objects.count() == 1
    ordinary = create_with_preview(team, result)
    ordinary.pop("profile")
    assert c.post("/api/v1/jobs/", ordinary, format="json").status_code == 201
    ordinary["profile"] = data["profile"]
    assert c.post("/api/v1/jobs/", ordinary, format="json").status_code == 409


def test_late_creation_failure_rolls_back_job_profile_tasks_and_preview_binding(team):
    c = client_for(team[2])
    data = create_with_preview(team, successful_preview(c))
    with patch("recruitment.views.record", side_effect=RuntimeError("test transaction failure")):
        with pytest.raises(RuntimeError, match="test transaction failure"):
            c.post("/api/v1/jobs/", data, format="json")
    assert not Job.objects.exists()
    assert not ProfileVersion.objects.exists()
    assert not Task.objects.exists()
    assert not AuditEvent.objects.exists()
    assert ProfileGeneration.objects.get().job_id is None
    assert c.post("/api/v1/jobs/", data, format="json").status_code == 201


def test_manual_creation_after_model_failure_is_atomic_and_rejects_fake_sources(team):
    c = client_for(team[2])
    payload = preview_payload()
    with patch("recruitment.profile_ai.chat_completion", side_effect=LLMServiceError("timeout")):
        failed = preview(c, payload).data
    assert failed["status"] == "failed"
    data = create_with_preview(team, failed)
    data["profile"].update(
        generation_id=None,
        source="HR 手工整理",
        requirements=[{"kind": "must", "text": "能完成需求分析", "generation_index": 0}],
    )
    assert c.post("/api/v1/jobs/", data, format="json").status_code == 400
    assert not Job.objects.exists()
    data["profile"]["requirements"][0].pop("generation_index")
    result = c.post("/api/v1/jobs/", data, format="json")
    assert result.status_code == 201, result.data
    assert result.data["latest_profile"]["requirements"][0]["source_kind"] == "manual"
    assert result.data["latest_profile"]["status"] == "confirmed"
    assert ProfileVersion.objects.get().created_with_job
    assert c.post("/api/v1/jobs/", data, format="json").status_code == 200
    data["profile"]["requirements"][0]["text"] = "不相同的要求"
    assert c.post("/api/v1/jobs/", data, format="json").status_code == 409
    assert ProfileGeneration.objects.get().job_id is None


@pytest.mark.parametrize("when", ["before", "during"])
def test_preview_rechecks_hr_before_send_and_after_model_response(team, when):
    from recruitment import profile_ai

    c = client_for(team[2])
    original_context = profile_ai.generation_context
    checks = 0

    def context(*args, **kwargs):
        nonlocal checks
        checks += 1
        if when == "before" and checks == 2:
            DepartmentRole.objects.filter(membership=team[2], role="hr").delete()
        return original_context(*args, **kwargs)

    def respond(**kwargs):
        DepartmentRole.objects.filter(membership=team[2], role="hr").delete()
        return json.dumps({"requirements": [generated_requirement()]})

    with (
        patch("recruitment.profile_ai.generation_context", side_effect=context),
        patch("recruitment.profile_ai.chat_completion", side_effect=respond) as model,
    ):
        assert preview(c, preview_payload()).status_code == 403
        assert model.call_count == (0 if when == "before" else 1)
    assert ProfileGeneration.objects.get().status == "stale"
    assert ProfileGeneration.objects.get().result == []
    assert c.get("/api/v1/jobs/profile-ai/").status_code == 403
    assert not Job.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_preview_and_creation_requests_produce_one_model_call_and_job(team):
    c = client_for(team[2])
    payload = preview_payload()
    entered, release = Event(), Event()

    def respond(**kwargs):
        entered.set()
        assert release.wait(10)
        return json.dumps({"requirements": [generated_requirement()]})

    def run_preview():
        close_old_connections()
        try:
            return preview(client_for(team[2]), payload)
        finally:
            close_old_connections()

    with patch("recruitment.profile_ai.chat_completion", side_effect=respond) as model:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(run_preview)
            assert entered.wait(10)
            try:
                assert preview(c, payload).data["status"] == "running"
            finally:
                release.set()
            result = first.result().data
        assert model.call_count == 1
    data = create_with_preview(team, result)

    def save():
        close_old_connections()
        try:
            return client_for(team[2]).post("/api/v1/jobs/", data, format="json").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: save(), range(2)))
    assert sorted(statuses) == [200, 201]
    assert (
        ProfileGeneration.objects.count()
        == Job.objects.count()
        == ProfileVersion.objects.count()
        == 1
    )
