import json
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from recruitment.ai_screening import _parse_analysis
from recruitment.intake import requirement_data
from recruitment.models import (
    AIScreening,
    ApplicationResume,
    DepartmentRole,
    JobMember,
    Membership,
    ProfileRequirement,
    ProfileVersion,
    ResumeParse,
    ReviewDecision,
    StageEvent,
    Task,
)
from tests.test_ai_screening import complete_report, hr_context, screening_source
from tests.test_jobs import client_for

pytestmark = pytest.mark.django_db


def profile_context():
    client, membership, job = hr_context()
    application, parse = screening_source(membership, job)
    profile = ProfileVersion.objects.create(
        job=job,
        number=1,
        jd_snapshot="负责产品上线；优先行业背景，排除信号待确认。",
        source="虚构测试要求",
        created_by=membership,
        status="confirmed",
        confirmed_by=membership,
        confirmed_at=timezone.now(),
    )
    requirements = [
        ProfileRequirement.objects.create(
            profile=profile,
            kind=kind,
            text=text,
            rationale="岗位相关测试理由",
            needs_verification=pending,
            source_kind="jd",
            source_quote=text,
            source_reference="招聘需求",
            position=index,
        )
        for index, (kind, text, pending) in enumerate(
            [
                ("must", "负责产品上线", False),
                ("preferred", "优先行业背景", True),
                ("exclusion", "排除信号待确认", True),
            ]
        )
    ]
    job.active_profile = profile
    job.save(update_fields=["active_profile"])
    return client, membership, job, application, parse, requirements


def model_match(requirement_id, **values):
    return {
        "requirement_id": requirement_id,
        "status": "supported",
        "quote": "负责产品上线",
        "reason": "简历提及相关职责，需核实本人贡献。",
        "question": "请说明本人负责的上线步骤及交付物。",
        **values,
    }


def analyze(client, application, parse, requirements, **payload):
    report = {
        **complete_report(),
        "requirement_matches": [model_match(item.id) for item in requirements],
    }
    report["questions"][0]["requirement_id"] = requirements[0].id
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(report)
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {
                "resume": parse.text,
                "application_id": application.id,
                "resume_parse_id": parse.id,
                **payload,
            },
            format="json",
        )
    assert response.status_code == 200, response.data
    return response.data, json.loads(complete.call_args.kwargs["user_text"])


def test_unconfirmed_preferences_stay_out_of_model_input_and_keep_full_snapshot():
    client, _, job, application, parse, requirements = profile_context()
    report, prompt = analyze(client, application, parse, requirements)
    assert prompt["target_job"]["description"] == ""
    assert [item["id"] for item in prompt["target_job"]["requirements"]] == [requirements[0].id]
    assert all(item.text not in json.dumps(prompt, ensure_ascii=False) for item in requirements[1:])
    assert report["source_context"]["job"]["requirements"] == [
        requirement_data(item) for item in requirements
    ]
    assert report["source_context"]["job"]["description"] == job.active_profile.jd_snapshot
    assert [item["status"] for item in report["requirement_matches"]] == [
        "supported",
        "insufficient",
        "insufficient",
    ]
    assert all("尚待 HR 确认" in item["reason"] for item in report["requirement_matches"][1:])
    detail = client.get(f"/api/v1/applications/{application.id}/").data
    assert detail["requirements"] == [requirement_data(item) for item in requirements]
    assert detail["profile_analysis"]["id"] == report["id"]
    assert detail["profile_analysis"]["source_status"] == {
        "profile_stale": False,
        "material_stale": False,
    }
    application.refresh_from_db()
    assert application.stage == "pending_review" and application.version == 1
    assert not ReviewDecision.objects.exists()
    assert not StageEvent.objects.exists()
    assert not Task.objects.exists()


@pytest.mark.parametrize(
    "variant",
    [
        "missing",
        "forged_quote",
        "whitespace_quote",
        "unknown_id",
        "duplicate",
        "bool_id",
        "unknown_status",
        "missing_reason",
    ],
)
def test_unverifiable_or_ambiguous_model_matches_are_insufficient(variant):
    requirements = [{"id": 1, "kind": "must", "text": "交付产品", "needs_verification": False}]
    row = model_match(1)
    raw = [row]
    if variant == "missing":
        raw = []
    elif variant == "forged_quote":
        row["quote"] = "提升转化率 30%"
    elif variant == "whitespace_quote":
        row["quote"] = "负责产品\n上线"
    elif variant == "unknown_id":
        row["requirement_id"] = 999
    elif variant == "duplicate":
        raw.append({**row})
    elif variant == "bool_id":
        row["requirement_id"] = True
    elif variant == "unknown_status":
        row["status"] = "approved"
    else:
        row.pop("reason")
    result = _parse_analysis(
        json.dumps({**complete_report(), "requirement_matches": raw}),
        "负责产品上线",
        has_job=True,
        requirements=requirements,
    )
    assert len(result["requirement_matches"]) == 1
    item = result["requirement_matches"][0]
    assert item["requirement_id"] == 1 and item["status"] == "insufficient"
    assert item["reason"] == "模型未提供可核验的对应依据，请对照简历补充核实。"
    assert item["question"] and item["question_index"] is None
    if variant in (
        "missing",
        "forged_quote",
        "whitespace_quote",
        "unknown_id",
        "duplicate",
        "bool_id",
    ):
        assert item["quote"] == ""
    assert result["match_score"] is None


def test_every_requirement_is_returned_and_question_links_only_use_confirmed_snapshot_ids():
    requirements = [
        {"id": index, "kind": "must", "text": f"要求{index}", "needs_verification": index == 7}
        for index in range(1, 8)
    ]
    question = complete_report()["questions"][0]
    report = {
        **complete_report(),
        "requirement_matches": [model_match(index) for index in range(1, 8)],
        "questions": [
            {"question": []},
            {**question, "requirement_id": 2},
            {**question, "requirement_id": 999},
            {**question, "requirement_id": True},
            {**question, "requirement_id": 7},
            {**question, "requirement_id": 6},
        ],
    }
    result = _parse_analysis(json.dumps(report), "负责产品上线", True, requirements)
    assert len(result["requirement_matches"]) == 7
    assert [item.get("requirement_id") for item in result["questions"]] == [2, None, None, None]
    assert result["requirement_matches"][1]["question_index"] == 0
    assert all(
        item["question_index"] is None
        for item in result["requirement_matches"]
        if item["requirement_id"] != 2
    )
    assert result["requirement_matches"][-1]["status"] == "insufficient"


def test_only_unconfirmed_conditions_cannot_produce_a_score_or_candidate_verification_link():
    client, _, _, application, parse, requirements = profile_context()
    requirements[0].kind = "preferred"
    requirements[0].needs_verification = True
    requirements[0].save(update_fields=["kind", "needs_verification"])
    report, prompt = analyze(client, application, parse, requirements)
    assert prompt["target_job"]["requirements"] == []
    assert report["match_score"] is None
    assert report["questions"][0]["requirement_id"] is None
    assert all(
        item["status"] == "insufficient" and item["question_index"] is None
        for item in report["requirement_matches"]
    )


def test_manual_input_does_not_claim_a_verified_material_version():
    client, _, _, application, parse, requirements = profile_context()
    report, _ = analyze(client, application, parse, requirements, resume_parse_id=None)
    assert report["source_context"]["source"]["kind"] == "manual"
    assert report["source_context"]["source"]["resume_parse_id"] is None
    assert report["source_status"] == {"profile_stale": False, "material_stale": None}


def test_old_reports_do_not_backfill_requirement_matches_or_source_status():
    client, membership, job, application, _, _ = profile_context()
    stored = AIScreening.objects.create(
        organization=membership.organization,
        creator=membership,
        application=application,
        job=job,
        request_key=uuid.uuid4(),
        input_digest="1" * 64,
        result=complete_report(),
    )
    report = client.get(f"/api/v1/applications/{application.id}/").data["profile_analysis"]
    assert report["id"] == stored.id
    assert report["requirement_matches"] == [] and report["source_context"] is None
    assert report["source_status"] == {"profile_stale": None, "material_stale": None}


@pytest.mark.parametrize("change", ["profile", "text", "add_material", "remove_material"])
def test_latest_report_marks_changed_profile_or_material_without_rewriting_snapshot(change):
    client, membership, job, application, parse, requirements = profile_context()
    extra = ResumeParse.objects.create(
        document=parse.document,
        version=2,
        parser_version="test",
        status="succeeded",
        text="另一次人工补充",
        actor=membership,
        request_key=uuid.uuid4(),
    )
    if change == "remove_material":
        ApplicationResume.objects.create(
            application=application, parse=extra, assigned_by=membership
        )
    report, _ = analyze(client, application, parse, requirements)
    if change == "profile":
        job.active_profile = ProfileVersion.objects.create(
            job=job,
            number=2,
            jd_snapshot="新岗位要求",
            source="人工修订",
            created_by=membership,
            status="confirmed",
            confirmed_by=membership,
            confirmed_at=timezone.now(),
        )
        job.save(update_fields=["active_profile"])
    elif change == "text":
        parse.text = "修订后的产品交付描述"
        parse.save(update_fields=["text"])
    elif change == "add_material":
        ApplicationResume.objects.create(
            application=application, parse=extra, assigned_by=membership
        )
    else:
        ApplicationResume.objects.filter(application=application, parse=extra).delete()
    current = client.get(f"/api/v1/applications/{application.id}/").data["profile_analysis"]
    assert current["source_context"] == report["source_context"]
    assert current["requirement_matches"] == report["requirement_matches"]
    assert current["source_status"] == {
        "profile_stale": change == "profile",
        "material_stale": change != "profile",
    }


@pytest.mark.parametrize("revoke", ["quarantine", "unlink", "deleted", "permission"])
def test_report_is_not_exposed_when_original_source_or_job_access_is_revoked(revoke):
    client, membership, job, application, parse, requirements = profile_context()
    report, _ = analyze(client, application, parse, requirements)
    if revoke == "quarantine":
        parse.document.access_state = "quarantine"
        parse.document.save(update_fields=["access_state"])
    elif revoke == "unlink":
        ApplicationResume.objects.filter(application=application, parse=parse).delete()
    elif revoke == "deleted":
        AIScreening.objects.filter(pk=report["id"]).update(deleted_at=timezone.now())
    else:
        DepartmentRole.objects.filter(membership=membership, department=job.department).delete()
    detail = client.get(f"/api/v1/applications/{application.id}/")
    assert detail.status_code == (404 if revoke == "permission" else 200)
    if detail.status_code == 200:
        assert detail.data["profile_analysis"] is None
    assert client.get(f"/api/v1/ai-screenings/{report['id']}/").status_code in (403, 404)


def test_latest_analysis_remains_creator_and_application_scoped():
    client, membership, job, application, parse, requirements = profile_context()
    report, _ = analyze(client, application, parse, requirements)
    other = Membership.objects.create(
        organization=membership.organization,
        user=get_user_model().objects.create_user("other-matching-hr"),
    )
    DepartmentRole.objects.create(membership=other, department=job.department, role="hr")
    JobMember.objects.create(job=job, membership=other)
    other_client = client_for(other)
    assert (
        other_client.get(f"/api/v1/applications/{application.id}/").data["profile_analysis"] is None
    )
    other_report, _ = analyze(other_client, application, parse, requirements)
    second_application, second_parse = screening_source(membership, job)
    second_report, _ = analyze(client, second_application, second_parse, requirements)
    assert (
        client.get(f"/api/v1/applications/{application.id}/").data["profile_analysis"]["id"]
        == report["id"]
    )
    assert (
        other_client.get(f"/api/v1/applications/{application.id}/").data["profile_analysis"]["id"]
        == other_report["id"]
    )
    assert second_report["id"] not in (report["id"], other_report["id"])


def test_human_verification_stays_separate_from_material_support():
    client, _, _, application, parse, requirements = profile_context()
    report, _ = analyze(client, application, parse, requirements)
    item = report["requirement_matches"][0]
    assert item["question_index"] == 0
    endpoint = f"/api/v1/ai-screenings/{report['id']}/verifications/"
    base = {
        "question_index": 0,
        "version": 0,
        "request_key": str(uuid.uuid4()),
        "status": "pending",
    }
    assert client.post(endpoint, base, format="json").status_code == 200
    saved = client.post(
        endpoint,
        {
            **base,
            "request_key": str(uuid.uuid4()),
            "version": 1,
            "status": "contradicted",
            "answer": "本人仅参与联调，未负责上线",
            "evidence": "本轮核实笔记第 1 条",
        },
        format="json",
    )
    assert saved.status_code == 200, saved.data
    current = client.get(f"/api/v1/applications/{application.id}/").data["profile_analysis"]
    assert current["requirement_matches"][0] == item
    assert current["verifications"][0]["status"] == "contradicted"
    application.refresh_from_db()
    assert application.stage == "pending_review"
