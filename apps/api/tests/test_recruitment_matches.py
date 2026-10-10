import json
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from recruitment.ai_screening import _parse_analysis
from recruitment.intake import candidate_data, requirement_data
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


def test_candidate_talent_profile_is_job_free_and_shown_in_the_person_record():
    client, membership, _, application, parse, _ = profile_context()
    candidate = application.candidate
    candidate.profile_resume_parse = parse
    candidate.save(update_fields=["profile_resume_parse"])
    report = {**complete_report(), "conclusion": "建议录用", "match_score": 98}
    with patch(
        "recruitment.ai_screening.chat_completion", return_value=json.dumps(report)
    ) as complete:
        response = client.post(
            "/api/v1/ai-screenings/",
            {
                "request_key": str(uuid.uuid4()),
                "candidate_id": candidate.id,
                "resume_parse_id": parse.id,
                "resume": parse.text,
            },
            format="json",
        )

    assert response.status_code == 200, response.data
    assert response.data["application_id"] is None and response.data["job_id"] is None
    assert response.data["match_score"] is None
    assert response.data["conclusion"] == "通用初判"
    prompt = json.loads(complete.call_args.kwargs["user_text"])
    assert prompt["target_job"] is None
    assert prompt["resume"] == parse.text
    assert response.data["source_context"]["source"]["kind"] == "candidate_resume"
    assert response.data["source_context"]["candidate"]["id"] == candidate.id

    detail = candidate_data(candidate, membership, detail=True)
    assert detail["talent_profile_analysis"]["id"] == response.data["id"]
    assert detail["talent_profile_analysis"]["source_is_current"] is True
    assert detail["ai_screenings"] == []
    assert response.data["id"] not in {
        item["id"] for item in client.get("/api/v1/ai-screenings/").data["items"]
    }
    assert not AIScreening.objects.get(pk=response.data["id"]).application_id

    ApplicationResume.objects.filter(application=application, parse=parse).delete()
    assert client.get(f"/api/v1/ai-screenings/{response.data['id']}/").status_code == 404
    detail = candidate_data(candidate, membership, detail=True)
    assert detail["talent_profile_analysis"] is None and detail["resume_text"] == ""


def test_candidate_talent_profile_rejects_other_resume_and_job_context():
    client, _, _, application, parse, _ = profile_context()
    payload = {
        "request_key": str(uuid.uuid4()),
        "candidate_id": application.candidate_id,
        "resume_parse_id": parse.id,
        "resume": "伪造的简历内容",
    }
    with patch("recruitment.ai_screening.chat_completion") as complete:
        changed_resume = client.post("/api/v1/ai-screenings/", payload, format="json")
        mixed_context = client.post(
            "/api/v1/ai-screenings/",
            {**payload, "request_key": str(uuid.uuid4()), "job_id": application.job_id},
            format="json",
        )

    assert changed_resume.status_code == 400
    assert mixed_context.status_code == 400
    assert not AIScreening.objects.exists()
    complete.assert_not_called()


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
        "unknown_id",
        "duplicate",
        "bool_id",
        "unknown_status",
        "missing_reason",
    ],
)
def test_unverifiable_or_ambiguous_model_matches_are_analysis_errors_not_material_gaps(variant):
    requirements = [{"id": 1, "kind": "must", "text": "交付产品", "needs_verification": False}]
    row = model_match(1)
    raw = [row]
    if variant == "missing":
        raw = []
    elif variant == "forged_quote":
        row["quote"] = "提升转化率 30%"
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
    assert item["requirement_id"] == 1 and item["status"] == "analysis_error"
    assert "不代表候选人缺少相关经历" in item["reason"]
    assert item["question"] and item["question_index"] == 0
    assert item["quote"] == "" and item["quotes"] == []
    assert result["gaps"][0]["kind"] == "analysis_error"
    assert result["questions"][0]["origin"] == "verification_fallback"
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
    assert [item.get("requirement_id") for item in result["questions"]] == [2, 1, 3, 4, 5]
    assert result["requirement_matches"][1]["question_index"] == 0
    assert all(
        item["question_index"] is None
        for item in result["requirement_matches"]
        if item["requirement_id"] in (6, 7)
    )
    assert result["requirement_matches"][-1]["status"] == "insufficient"


def test_resume_quote_whitespace_is_normalized_consistently_across_report_sections():
    quote = "负责产品\n上线"
    requirements = [{"id": 1, "kind": "must", "text": "交付产品", "needs_verification": False}]
    report = complete_report()
    report["evidence"][0]["quote"] = quote
    report["questions"][0].update(quote=quote, requirement_id=1)
    report["requirement_matches"] = [model_match(1, quote=quote)]
    result = _parse_analysis(json.dumps(report), "负责产品上线", True, requirements)
    assert result["requirement_matches"][0]["status"] == "supported"
    assert result["requirement_matches"][0]["quotes"] == [quote]
    assert result["requirement_matches"][0]["question"] == report["questions"][0]["question"]
    assert (
        result["requirement_matches"][0]["question"] != report["requirement_matches"][0]["question"]
    )
    assert result["evidence"][0]["quote"] == result["questions"][0]["quote"] == quote
    assert result["analysis_issues"] == []


@pytest.mark.parametrize(
    "quotes,expected",
    [
        (["2025年实习", "2026年同一实习"], "contradictory"),
        (["2025年实习"], "analysis_error"),
        (["2025年实习", "2025年\n实习"], "analysis_error"),
        (["2025年实习", "不存在的经历"], "analysis_error"),
    ],
)
def test_material_conflicts_require_two_distinct_verifiable_quotes(quotes, expected):
    requirements = [{"id": 1, "kind": "must", "text": "一年相关经验", "needs_verification": False}]
    report = {
        **complete_report(),
        "requirement_matches": [
            model_match(
                1,
                status="contradictory",
                quote="",
                quotes=quotes,
                reason="同一段实习记录的年份不同，需核实具体年份，并非直接判断经历不实。",
                question="同一段实习的实际起止年月是什么？",
            )
        ],
    }
    result = _parse_analysis(json.dumps(report), "2025年实习；2026年同一实习", True, requirements)
    item = result["requirement_matches"][0]
    assert item["status"] == expected
    assert result["gaps"][0]["kind"] == (
        "material_conflict" if expected == "contradictory" else "analysis_error"
    )
    assert len(item["quotes"]) == (2 if expected == "contradictory" else 0)


def test_partial_material_is_kept_and_mandatory_gaps_get_complete_linked_questions_first():
    requirements = [
        {
            "id": index,
            "kind": "must" if index <= 3 else "preferred",
            "text": f"岗位要求{index}",
            "needs_verification": False,
        }
        for index in range(1, 8)
    ]
    requirements[1]["text"] = "数据集制作与LoRA训练"
    rows = [model_match(index) for index in range(1, 8)]
    rows[1].update(
        status="insufficient",
        quote="负责采集双摄像头数据并训练ACT策略",
        reason="有数据采集和训练材料；未说明是否进行LoRA训练，需要核实，不等于没有数据集经验。",
        question="在已有数据采集和ACT训练之外，是否实际进行过LoRA训练？",
    )
    rows[2].update(status="insufficient", quote="", reason="需要补充与该要求对应的材料。")
    report = {
        **complete_report(),
        "gaps": [{"criterion": "伪造另一套风险", "note": "未提及数据集制作。"}],
        "requirement_matches": rows,
        "questions": [
            {**complete_report()["questions"][0], "requirement_id": 1},
            {**complete_report()["questions"][0], "requirement_id": 999},
        ],
    }
    result = _parse_analysis(
        json.dumps(report), "负责产品上线；负责采集双摄像头数据并训练ACT策略", True, requirements
    )
    assert [item["requirement_id"] for item in result["questions"]] == [2, 3, 1, 4, 5]
    assert result["questions"][0]["origin"] == "verification_fallback"
    assert result["questions"][2]["origin"] == "generated"
    assert all(
        item["question"] and item["reason"] and item["follow_up"] and item["answer_points"]
        for item in result["questions"]
    )
    assert result["gaps"][0]["quotes"] == ["负责采集双摄像头数据并训练ACT策略"]
    assert "未提及数据集制作" not in json.dumps(result, ensure_ascii=False)
    assert len(result["requirement_matches"]) == 7
    assert all(item["question"] for item in result["requirement_matches"])
    assert result["requirement_matches"][5]["status"] == "supported"
    assert result["requirement_matches"][5]["question_index"] is None


def test_supported_exclusion_signal_is_prioritized_ahead_of_five_other_material_gaps():
    requirements = [
        {
            "id": index,
            "kind": "exclusion" if index == 7 else "must",
            "text": f"岗位要求{index}",
            "needs_verification": False,
        }
        for index in range(1, 8)
    ]
    rows = [
        model_match(index, status="insufficient", quote="", reason="需补充具体材料。")
        for index in range(1, 7)
    ]
    rows.append(
        model_match(
            7,
            quote="职责与已披露的合作约束可能冲突",
            reason="出现需人工核实的排除信号，不能据此淘汰。",
            question="该合作约束与本岗位职责是否实际冲突？请说明适用范围。",
        )
    )
    result = _parse_analysis(
        json.dumps({**complete_report(), "requirement_matches": rows}),
        "职责与已披露的合作约束可能冲突",
        True,
        requirements,
    )
    assert len(result["questions"]) == 5
    assert result["questions"][0]["requirement_id"] == 7
    assert result["requirement_matches"][-1]["question_index"] == 0
    assert result["requirement_matches"][-1]["status"] == "supported"
    assert result["conclusion"] == "待复核" and result["match_score"] is None


def test_only_unconfirmed_conditions_cannot_produce_a_score_or_candidate_verification_link():
    client, _, _, application, parse, requirements = profile_context()
    requirements[0].kind = "preferred"
    requirements[0].needs_verification = True
    requirements[0].save(update_fields=["kind", "needs_verification"])
    report, prompt = analyze(client, application, parse, requirements)
    assert prompt["target_job"]["requirements"] == []
    assert report["match_score"] is None
    assert report["questions"] == []
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
    assert report["quality_version"] == 1 and report["analysis_date"] is None
    assert report["match_score"] == 73
    assert report["analysis_issues"] == []
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
