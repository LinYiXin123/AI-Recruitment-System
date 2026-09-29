import io
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections
from django.utils import timezone
from pypdf import PdfWriter

from recruitment.models import (
    Application,
    ApplicationEntry,
    AuditEvent,
    Candidate,
    DepartmentRole,
    ImportItem,
    ResumeDocument,
    ResumeParse,
    ReviewDecision,
    StageEvent,
    Task,
)
from tests import test_jobs
from tests.test_jobs import action, actor, client_for, new_job, save_profile


@pytest.fixture
def team():
    return test_jobs.team.__wrapped__()


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def private_files(settings, tmp_path):
    settings.PRIVATE_RESUME_ROOT = tmp_path / "resumes"


def recruiting(team):
    c = client_for(team[2])
    job = save_profile(c, new_job(team)).data
    job = action(c, job, "submit-profile").data
    job = action(client_for(team[3]), job, "review-profile", outcome="confirm").data
    return action(c, job, "change-status", status="open").data


def docx():
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr(
            zipfile.ZipInfo("word/document.xml"),
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>虚构候选人，做过访谈。材料声明，尚未核实。</w:t></w:r></w:p></w:body></w:document>',
        )
    return data.getvalue()


def upload(c, job, raw=None, name="虚构简历.docx"):
    batch = c.post(
        "/api/v1/imports/",
        {"request_key": str(uuid.uuid4()), "job": job["id"], "source": "虚构验收资料", "total": 1},
        format="json",
    )
    assert batch.status_code == 201, batch.data
    url = f"/api/v1/imports/{batch.data['id']}/"
    key = str(uuid.uuid4())
    file = SimpleUploadedFile(name, raw if raw is not None else docx())
    response = c.post(url + "upload/", {"request_key": key, "file": file}, format="multipart")
    assert response.status_code == 201, response.data
    return url, response.data, key


def confirm(c, url, item, **changes):
    return c.post(
        f"{url}items/{item['id']}/confirm/",
        {
            "parse": item["parse"]["id"],
            "display_name": "虚构小林",
            "contact_note": "等待本人补充联系方式",
            **changes,
        },
        format="json",
    )


def review(c, app, action_name="advance", **changes):
    return c.post(
        f"/api/v1/applications/{app['id']}/review/",
        {
            "version": app["version"],
            "profile": app["profile"],
            "request_key": str(uuid.uuid4()),
            "action": action_name,
            "reason": "按本人提供的材料进行人工核对，访谈能力待面试验证",
            **changes,
        },
        format="json",
    )


def detail(c, item):
    return c.get(f"/api/v1/applications/{item['application']}/").data


@pytest.mark.django_db(transaction=True)
def test_file_identity_review_task_and_download_permissions(team):
    c = client_for(team[2])
    job = recruiting(team)
    url, item, key = upload(c, job)
    assert item["parse"]["status"] == "succeeded"
    assert "段落 1" in item["parse"]["text"]
    replay = c.post(
        url + "upload/",
        {"request_key": key, "file": SimpleUploadedFile("虚构简历.docx", docx())},
        format="multipart",
    )
    assert replay.status_code == 200
    assert ResumeDocument.objects.count() == 1
    item = confirm(c, url, item).data
    a = detail(c, item)
    assert a["stage"] == "pending_review" and a["ai_status"] == "not_connected"
    assert c.get("/api/v1/tasks/").data["results"][0]["application"] == a["id"]
    download = f"/api/v1/documents/{item['document']}/download/"
    assert c.get(download).status_code == 403
    grant = DepartmentRole.objects.create(
        membership=team[2], department=team[1], role="resume_download"
    )
    response = c.get(download)
    assert response.status_code == 200 and response["X-Content-Type-Options"] == "nosniff"
    response.close()
    grant.delete()
    assert c.get(download).status_code == 403
    result = review(c, a)
    assert result.status_code == 200, result.data
    assert result.data["stage"] == "ready_to_schedule"
    assert Task.objects.get(application_id=a["id"], status="pending").kind == "schedule"
    assert ReviewDecision.objects.get().input_parses == [item["parse"]["id"]]
    assert review(c, a, "reject").status_code == 409
    assert action(c, job, "change-status", status="closed", reason="停止招聘").status_code == 400


def test_scan_failure_manual_version_and_retries(team):
    c = client_for(team[2])
    out = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(out)
    url, item, _ = upload(c, recruiting(team), out.getvalue(), "扫描件.pdf")
    assert item["parse"]["status"] == "failed"
    assert confirm(c, url, item).status_code == 400
    path = f"{url}items/{item['id']}/parse/"
    body = {"request_key": str(uuid.uuid4()), "text": "人工摘录第 1 页：曾做访谈。未经核实。"}
    fixed = c.post(path, body, format="json")
    assert fixed.status_code == 200 and fixed.data["parse"]["version"] == 2
    assert c.post(path, body, format="json").status_code == 200
    assert ResumeParse.objects.count() == 2
    confirmed = confirm(c, url, fixed.data)
    assert confirmed.status_code == 200
    assert (
        c.post(path, {**body, "request_key": str(uuid.uuid4())}, format="json").status_code == 409
    )
    assert ResumeParse.objects.get(version=1).status == "failed"


def test_dedup_multiple_jobs_reapply_and_idempotent_review(team):
    c = client_for(team[2])
    job = recruiting(team)
    url, item, _ = upload(c, job)
    first = confirm(c, url, item).data
    a = detail(c, first)
    url2, item2, _ = upload(c, job)
    assert confirm(c, url2, item2).status_code == 409
    same = confirm(c, url2, item2, candidate=a["candidate"], identity_note="核对同一人").data
    assert same["application"] == a["id"]
    assert Candidate.objects.count() == 1 and Application.objects.count() == 1
    second_job = recruiting(team)
    entry = {"request_key": str(uuid.uuid4()), "job": second_job["id"], "source": "人工加入"}
    path = f"/api/v1/candidates/{a['candidate']}/apply/"
    assert c.post(path, entry, format="json").status_code == 200
    a = detail(c, first)
    key = str(uuid.uuid4())
    assert review(c, a, "reject", request_key=key).status_code == 200
    assert review(c, a, "reject", request_key=key).status_code == 200
    assert ReviewDecision.objects.count() == 1
    assert Application.objects.get(job_id=second_job["id"]).stage == "pending_review"
    result = c.post(
        path, {**entry, "request_key": str(uuid.uuid4()), "job": job["id"]}, format="json"
    )
    assert result.status_code == 200
    assert Application.objects.get(pk=result.data["application"]).attempt_no == 2
    url3, item3, _ = upload(c, job)
    assert confirm(c, url3, item3, identity_note="同名但不同的人，人工核对经历").status_code == 200
    assert Candidate.objects.count() == 2


def test_application_filter_matches_candidate_education_level(team):
    c = client_for(team[2])
    job = recruiting(team)
    created = c.post(
        "/api/v1/candidates/",
        {
            "request_key": str(uuid.uuid4()),
            "job": job["id"],
            "source": "BOSS直聘",
            "display_name": "学历筛选候选人",
            "phone": "13800138000",
            "education_level": "本科",
        },
        format="json",
    )
    assert created.status_code == 201, created.data
    rows = c.get("/api/v1/applications/?education_level=本科").data
    assert [item["candidate"] for item in rows["results"]] == [created.data["candidate"]]
    assert c.get("/api/v1/applications/?education_level=硕士").data["count"] == 0


def test_private_scope_and_revocation(team):
    c = client_for(team[2])
    url, item, _ = upload(c, recruiting(team))
    item = confirm(c, url, item).data
    a = detail(c, item)
    admin = actor(team[0], username="config_admin", admin=True)
    for person in [team[3], team[4], admin]:
        other = client_for(person)
        for path in ["applications", "candidates", "imports"]:
            assert other.get(f"/api/v1/{path}/").data["count"] == 0
        assert other.get(url).status_code == 404
        assert other.get(f"/api/v1/applications/{a['id']}/").status_code == 404
        assert other.get(f"/api/v1/documents/{item['document']}/download/").status_code == 403
    doc = ResumeDocument.objects.get(pk=item["document"])
    doc.access_state = "quarantine"
    doc.save()
    assert detail(c, item)["resumes"][0]["parse"] is None
    assert c.get(url).data["items"][0]["parse"] is None
    DepartmentRole.objects.filter(membership=team[2], role="hr").delete()
    assert c.get("/api/v1/applications/").data["count"] == 0
    assert c.get("/api/v1/tasks/").data["count"] == 0


def test_need_information_atomic_rollback_and_supplement(team):
    c = client_for(team[2])
    url, item, _ = upload(c, recruiting(team))
    a = detail(c, confirm(c, url, item).data)
    assert review(c, a, "need_info").status_code == 400
    with patch("recruitment.intake.audit", side_effect=RuntimeError("rollback")):
        with pytest.raises(RuntimeError):
            review(c, a)
    assert Application.objects.get(pk=a["id"]).stage == "pending_review"
    assert ReviewDecision.objects.count() == 0
    assert StageEvent.objects.count() == 1
    assert Task.objects.get(application_id=a["id"], status="pending").kind == "app_review"
    result = review(
        c,
        a,
        "need_info",
        followup_owner=team[2].id,
        due_at=(timezone.now() + timedelta(days=1)).isoformat(),
    )
    assert result.status_code == 200, result.data
    assert Task.objects.get(application_id=a["id"], status="pending").due_at
    result = review(
        c, result.data, "supplement", reason="电话访谈补齐项目参与范围，来源为人工记录，仍需复核"
    )
    assert result.status_code == 200 and result.data["stage"] == "pending_review"
    assert Task.objects.get(application_id=a["id"], status="pending").kind == "app_review"


@pytest.mark.django_db(transaction=True)
def test_concurrent_same_person_same_job_and_review(team):
    c = client_for(team[2])
    job = recruiting(team)
    url, item, _ = upload(c, job)
    a = detail(c, confirm(c, url, item).data)
    second = recruiting(team)
    barrier = Barrier(2)

    def enter(_):
        close_old_connections()
        client = client_for(team[2])
        barrier.wait()
        response = client.post(
            f"/api/v1/candidates/{a['candidate']}/apply/",
            {"request_key": str(uuid.uuid4()), "job": second["id"], "source": "并发加入"},
            format="json",
        )
        close_old_connections()
        return response.status_code, response.data

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(enter, range(2)))
    assert [r[0] for r in results] == [200, 200]
    assert results[0][1] == results[1][1]
    assert ApplicationEntry.objects.filter(application__job_id=second["id"]).count() == 2
    barrier = Barrier(2)

    def decide(outcome):
        close_old_connections()
        client = client_for(team[2])
        barrier.wait()
        response = review(client, a, outcome)
        close_old_connections()
        return response.status_code

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(decide, ["advance", "reject"]))
    assert sorted(results) == [200, 409]
    assert ReviewDecision.objects.count() == 1
    assert AuditEvent.objects.filter(action="人工复核应聘").count() == 1
    assert ImportItem.objects.count() == 1


def test_profile_changes_conflict_and_withdraw_preserves_other_attempt(team):
    c = client_for(team[2])
    job = recruiting(team)
    url, item, _ = upload(c, job)
    a = detail(c, confirm(c, url, item).data)
    updated = save_profile(c, job).data
    updated = action(c, updated, "submit-profile").data
    updated = action(client_for(team[3]), updated, "review-profile", outcome="confirm").data
    assert review(c, a).status_code == 409
    fresh = c.get(f"/api/v1/applications/{a['id']}/").data
    assert fresh["version"] == a["version"] and fresh["profile"] != a["profile"]
    ready = review(c, fresh).data
    assert ready["stage"] == "ready_to_schedule"
    ended = review(c, ready, "withdraw", reason="本人撤回应聘，保留本次历史")
    assert ended.status_code == 200 and ended.data["stage"] == "closed"
    assert Task.objects.filter(application_id=a["id"], status="pending").count() == 0
    assert (
        action(c, updated, "change-status", status="closed", reason="招聘取消").status_code == 200
    )


def test_partial_upload_bad_type_scope_and_parse_payload_reuse(team):
    c = client_for(team[2])
    job = recruiting(team)
    key = str(uuid.uuid4())
    batch = c.post(
        "/api/v1/imports/",
        {"request_key": key, "job": job["id"], "source": "虚构", "total": 2},
        format="json",
    ).data
    path = f"/api/v1/imports/{batch['id']}/"
    bad = c.post(
        path + "upload/",
        {"request_key": str(uuid.uuid4()), "file": SimpleUploadedFile("fake.pdf", b"not a PDF")},
        format="multipart",
    )
    assert bad.status_code == 400 and not ResumeDocument.objects.exists()
    key = str(uuid.uuid4())
    result = c.post(
        path + "upload/",
        {"request_key": key, "file": SimpleUploadedFile("fiction.docx", docx())},
        format="multipart",
    )
    assert result.status_code == 201
    assert c.get(path).data["received"] == 1
    assert c.get("/api/v1/imports/").data["results"][0]["items"] == []
    retry = c.post(
        path + "upload/",
        {"request_key": key, "file": SimpleUploadedFile("other.docx", docx() + b"changed")},
        format="multipart",
    )
    assert retry.status_code == 409 and ResumeDocument.objects.count() == 1
    parse_path = f"{path}items/{result.data['id']}/parse/"
    key = str(uuid.uuid4())
    assert (
        c.post(
            parse_path, {"request_key": key, "text": "人工摘录，未经核实"}, format="json"
        ).status_code
        == 200
    )
    assert c.post(parse_path, {"request_key": key}, format="json").status_code == 409
    assert (
        c.post(
            parse_path, {"request_key": key, "text": "试图覆盖旧版本"}, format="json"
        ).status_code
        == 409
    )
    assert (
        client_for(team[4])
        .post(parse_path, {"request_key": str(uuid.uuid4()), "text": "越权"}, format="json")
        .status_code
        == 404
    )


def test_identity_pins_the_text_the_reviewer_saw(team):
    c = client_for(team[2])
    url, item, _ = upload(c, recruiting(team))
    path = f"{url}items/{item['id']}/parse/"
    newer = c.post(
        path,
        {"request_key": str(uuid.uuid4()), "text": "另一位 HR 补充了文字来源，需要重新查看"},
        format="json",
    )
    assert newer.status_code == 200
    assert confirm(c, url, item).status_code == 409
    assert Candidate.objects.count() == 0
    assert confirm(c, url, newer.data).status_code == 200
    assert Application.objects.get().resumes.get().parse_id == newer.data["parse"]["id"]
