import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.mixins import CreateModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from .access import can_edit, department_ids, member, visible_jobs
from .errors import Conflict
from .models import (
    Application,
    ApplicationEntry,
    ApplicationResume,
    AuditEvent,
    Candidate,
    ImportBatch,
    ImportItem,
    Job,
    Membership,
    ResumeDocument,
    ResumeParse,
    ReviewDecision,
    StageEvent,
    Task,
)
from .serializers import display_name


def hr_jobs(m):
    return (
        visible_jobs(m)
        .filter(department_id__in=department_ids(m, ["hr"]))
        .filter(Q(owner=m) | Q(collaborators__membership=m))
        .distinct()
    )


def candidates(m):
    return Candidate.objects.filter(
        organization=m.organization, applications__job__in=hr_jobs(m)
    ).distinct()


def audit(m, job, action_name, application=None, note=""):
    AuditEvent.objects.create(
        job=job,
        actor=m,
        action=action_name,
        job_version=job.version,
        application=application,
        note=note,
    )


def open_job(m, pk):
    job = get_object_or_404(hr_jobs(m), pk=pk)
    if job.status != "open" or not job.active_profile_id:
        raise ValidationError("请先完成招人要求确认并开始招聘，再接收新的应聘。")
    if not job.owner.active or not job.owner.user.is_active or not can_edit(job.owner, job):
        raise ValidationError("职位 HR 负责人授权已失效，请先恢复有效负责人。")
    return job


def validated(cls, data):
    form = cls(data=data)
    form.is_valid(raise_exception=True)
    return form.validated_data


class BatchInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    job = serializers.IntegerField(min_value=1)
    source = serializers.CharField(max_length=200)
    total = serializers.IntegerField(min_value=1, max_value=20)


class ParseInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    text = serializers.CharField(max_length=100000, required=False)


class IdentityInput(serializers.Serializer):
    parse = serializers.IntegerField(min_value=1, required=False)
    display_name = serializers.CharField(max_length=100)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    contact_note = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=""
    )
    candidate = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    identity_note = serializers.CharField(
        max_length=1000, required=False, allow_blank=True, default=""
    )

    def validate_phone(self, value):
        value = re.sub(r"[\s()\-]", "", value)
        if value and not re.fullmatch(r"\+?[0-9]{6,20}", value):
            raise ValidationError("请填写有效电话，或留空并说明联系方式缺失。")
        return value

    def validate_email(self, value):
        return value.casefold()

    def validate(self, data):
        if (
            not data["candidate"]
            and not data["phone"]
            and not data["email"]
            and not data["contact_note"]
        ):
            raise ValidationError("联系方式缺失时，请说明待补充情况。")
        return data


class CandidateCreateInput(IdentityInput):
    request_key = serializers.UUIDField()
    job = serializers.IntegerField(min_value=1)
    source = serializers.CharField(max_length=200)


def possible_matches(m, data):
    query = Q(display_name__iexact=data["display_name"])
    if data["phone"]:
        query |= Q(phone=data["phone"])
    if data["email"]:
        query |= Q(email__iexact=data["email"])
    return candidates(m).filter(query).order_by("id")


def candidate_data(c, m):
    return {
        "id": c.id,
        "display_name": c.display_name,
        "phone": c.phone,
        "email": c.email,
        "contact_note": c.contact_note,
        "applications": list(
            c.applications.filter(job__in=hr_jobs(m)).values(
                "id", "job_id", "job__title", "attempt_no", "stage"
            )
        ),
    }


def parse_data(p):
    if not p:
        return None
    return {
        "id": p.id,
        "version": p.version,
        "status": p.status,
        "text": p.text,
        "error": p.error,
        "parser_version": p.parser_version,
        "created_at": p.created_at,
        "actor_name": display_name(p.actor),
    }


def item_data(item):
    return {
        "id": item.id,
        "document": item.document_id,
        "name": item.document.original_name,
        "application": item.application_id,
        "identity_note": item.identity_note,
        "parse": parse_data(item.document.parses.first())
        if item.document.access_state == "active"
        else None,
    }


def batch_data(batch, detail=True):
    items = list(batch.items.select_related("document"))
    done = sum(bool(i.application_id) for i in items)
    return {
        "id": batch.id,
        "job": batch.job_id,
        "job_title": batch.job.title,
        "source": batch.source,
        "total": batch.total,
        "received": len(items),
        "completed": done,
        "created_at": batch.created_at,
        "status": "completed" if done == batch.total else "needs_review",
        "items": [item_data(i) for i in items] if detail else [],
    }


def file_path(doc):
    return settings.PRIVATE_RESUME_ROOT / str(doc.file_key)


def create_parse(doc, m, key, manual=None):
    existing = doc.parses.filter(request_key=key).first()
    if existing:
        if (
            existing.actor_id != m.id
            or (manual is not None and existing.text != manual)
            or ((manual is not None) != (existing.parser_version == "人工摘录"))
        ):
            raise Conflict("这个解析请求已经用于其他内容，请刷新后重新操作。")
        return existing
    result = {"text": manual} if manual is not None else {}
    if manual is None:
        try:
            process = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("extract_resume.py")),
                    str(file_path(doc)),
                    doc.file_type,
                ],
                capture_output=True,
                timeout=15,
                check=True,
            )
            result = json.loads(process.stdout)
        except (subprocess.SubprocessError, ValueError, OSError):
            result = {"error": "提取超时或资源不足，可重试、重传精简文件或人工摘录。"}
    return ResumeParse.objects.create(
        document=doc,
        version=(doc.parses.aggregate(n=Max("version"))["n"] or 0) + 1,
        parser_version="人工摘录" if manual is not None else "pypdf6.19 / DOCX段落 v1",
        status="succeeded" if result.get("text") else "failed",
        text=result.get("text", ""),
        error=result.get("error", ""),
        actor=m,
        request_key=key,
    )


def enter_application(m, candidate, job, source, key):
    # 人→职位→应聘的固定加锁次序；数据库条件唯一保证同岗仅一条进行中记录。
    Candidate.objects.select_for_update().get(pk=candidate.pk)
    existing = ApplicationEntry.objects.filter(organization=m.organization, request_key=key).first()
    if existing:
        a = existing.application
        if (
            existing.actor_id != m.id
            or a.candidate_id != candidate.id
            or a.job_id != job.id
            or existing.source != source
        ):
            raise Conflict("请求已经用于另一项应聘，不能改变内容重试。")
        return a
    job = Job.objects.select_for_update().get(pk=job.pk)
    open_job(m, job.id)
    a = Application.objects.filter(candidate=candidate, job=job, closed_at__isnull=True).first()
    if not a:
        a = Application.objects.create(
            organization=m.organization,
            candidate=candidate,
            job=job,
            owner=job.owner,
            source=source,
            attempt_no=(
                Application.objects.filter(candidate=candidate, job=job).aggregate(
                    n=Max("attempt_no")
                )["n"]
                or 0
            )
            + 1,
        )
        StageEvent.objects.create(application=a, actor=m, to_stage=a.stage, request_key=key)
        Task.objects.create(application=a, kind="app_review", assignee=a.owner)
        audit(m, job, "建立本次应聘", a)
    try:
        with transaction.atomic():
            ApplicationEntry.objects.create(
                organization=m.organization, request_key=key, actor=m, application=a, source=source
            )
    except IntegrityError:
        raise Conflict("这个请求已用于另一项应聘，请重新核对后提交。") from None
    return a


class ImportViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    def get_queryset(self):
        return (
            ImportBatch.objects.filter(job__in=hr_jobs(member(self.request)))
            .select_related("job")
            .order_by("-id")
        )

    def list(self, request):
        return self.get_paginated_response(
            [batch_data(b, detail=False) for b in self.paginate_queryset(self.get_queryset())]
        )

    def retrieve(self, request, pk=None):
        return Response(batch_data(self.get_object()))

    @transaction.atomic
    def create(self, request):
        m = member(request)
        data = validated(BatchInput, request.data)
        Membership.objects.select_for_update().get(pk=m.pk)
        old = ImportBatch.objects.filter(
            organization=m.organization, request_key=data["request_key"]
        ).first()
        if old:
            if (
                old.actor_id != m.id
                or old.job_id != data["job"]
                or old.source != data["source"]
                or old.total != data["total"]
            ):
                raise Conflict("导入请求已使用，请勿改变内容重试。")
            get_object_or_404(hr_jobs(m), pk=old.job_id)
            return Response(batch_data(old))
        job = open_job(m, data.pop("job"))
        try:
            with transaction.atomic():
                batch = ImportBatch.objects.create(
                    organization=m.organization, actor=m, job=job, **data
                )
        except IntegrityError:
            raise Conflict("这个导入请求已被使用，请重新核对后提交。") from None
        audit(m, job, "建立简历导入批次", note=f"批次 {batch.id}，计划 {batch.total} 份")
        return Response(batch_data(batch), status=201)

    def locked(self):
        batch = self.get_object()
        return ImportBatch.objects.select_for_update().get(pk=batch.pk)

    @action(detail=True, methods=["post"])
    def upload(self, request, pk=None):
        saved_path = None
        try:
            with transaction.atomic():
                batch = self.locked()
                m = member(request)
                key = validated(ParseInput, request.data)["request_key"]
                upload = request.FILES.get("file")
                if not upload or upload.size == 0 or upload.size > 20 * 1024 * 1024:
                    raise ValidationError("请选择 20MB 以内的非空 PDF 或 DOCX。")
                raw = upload.read()
                digest = hashlib.sha256(raw).hexdigest()
                old = batch.items.filter(request_key=key).first()
                if old:
                    if old.document.sha256 != digest:
                        raise Conflict("这个上传请求已接收不同文件，请重新选择文件。")
                    return Response(item_data(old))
                open_job(m, batch.job_id)
                if batch.items.count() >= batch.total:
                    raise ValidationError("该批次已收齐文件，请建立新批次。")
                kind = Path(upload.name).suffix.lower().lstrip(".")
                if kind not in ["pdf", "docx"] or not raw.startswith(
                    b"%PDF-" if kind == "pdf" else b"PK\x03\x04"
                ):
                    raise ValidationError("文件内容与格式不符，请上传有效 PDF 或 DOCX。")
                doc = ResumeDocument.objects.create(
                    organization=m.organization,
                    original_name=Path(upload.name).name[:255],
                    file_type=kind,
                    size=len(raw),
                    sha256=digest,
                    uploaded_by=m,
                )
                settings.PRIVATE_RESUME_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
                saved_path = file_path(doc)
                with saved_path.open("xb") as stream:
                    saved_path.chmod(0o600)
                    stream.write(raw)
                item = ImportItem.objects.create(batch=batch, document=doc, request_key=key)
                create_parse(doc, m, key)
                audit(m, batch.job, "接收简历并提取文字", note=f"批次 {batch.id}，文件 {doc.id}")
                result = item_data(item)
            return Response(result, status=201)
        except Exception:
            if saved_path:
                saved_path.unlink(missing_ok=True)
            raise

    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/parse")
    @transaction.atomic
    def parse(self, request, pk=None, item_id=None):
        batch = self.locked()
        item = get_object_or_404(batch.items, pk=item_id)
        if item.application_id:
            raise Conflict("本次材料已固定。补充材料请新建导入批次，不覆盖原解析版本。")
        if item.document.access_state != "active":
            raise PermissionDenied("该文件已停止访问。")
        data = validated(ParseInput, request.data)
        before = item.document.parses.count()
        create_parse(item.document, member(request), data["request_key"], data.get("text"))
        if item.document.parses.count() != before:
            audit(member(request), batch.job, "追加简历文字版本", note=f"文件 {item.document_id}")
        return Response(item_data(item))

    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/matches")
    def matches(self, request, pk=None, item_id=None):
        batch = self.get_object()
        get_object_or_404(batch.items, pk=item_id)
        data = validated(IdentityInput, request.data)
        matches = possible_matches(member(request), data)
        return Response(
            {
                "count": matches.count(),
                "results": [candidate_data(c, member(request)) for c in matches[:20]],
            }
        )

    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/confirm")
    @transaction.atomic
    def confirm(self, request, pk=None, item_id=None):
        batch = self.locked()
        item = get_object_or_404(batch.items, pk=item_id)
        m = member(request)
        data = validated(IdentityInput, request.data)
        if item.application_id:
            if item.identity_payload != data or item.confirmed_by_id != m.id:
                raise Conflict("身份已经由其他内容确认，请刷新查看原结果。")
            return Response(item_data(item))
        job = open_job(m, batch.job_id)
        parse = item.document.parses.first()
        if item.document.access_state != "active" or not parse or parse.status != "succeeded":
            raise ValidationError("请先完成文字提取或人工摘录，再核对身份。")
        if data.get("parse") != parse.id:
            raise Conflict("文字版本已更新，请重新查看最新材料后核对身份。当前输入不会被覆盖。")
        if data["candidate"]:
            person = get_object_or_404(candidates(m), pk=data["candidate"])
            if not data["identity_note"]:
                raise ValidationError("选用已有主档时，请记录核对依据。")
        else:
            if possible_matches(m, data).exists() and not data["identity_note"]:
                raise Conflict("找到疑似重复，请核对已有主档；若为不同的人，请填写区分依据。")
            person = Candidate.objects.create(
                organization=m.organization,
                created_by=m,
                **{key: data[key] for key in ["display_name", "phone", "email", "contact_note"]},
            )
        a = enter_application(m, person, job, batch.source, item.request_key)
        item.document.candidate = person
        item.document.save(update_fields=["candidate"])
        ApplicationResume.objects.get_or_create(
            application=a, parse=parse, defaults={"assigned_by": m}
        )
        item.application = a
        item.identity_note = data["identity_note"]
        item.identity_payload = data
        item.confirmed_by = m
        item.save()
        a.version += 1
        a.save(update_fields=["version", "updated_at"])
        audit(
            m, job, "核对简历身份并关联本次应聘", a, note=f"导入项 {item.id}；解析版本 {parse.id}"
        )
        return Response(item_data(item))


class CandidateViewSet(CreateModelMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    def get_queryset(self):
        search = self.request.query_params.get("search", "")[:100]
        return (
            candidates(member(self.request))
            .filter(
                Q(display_name__icontains=search)
                | Q(phone__icontains=search)
                | Q(email__icontains=search)
            )
            .order_by("-id")
        )

    def list(self, request):
        return self.get_paginated_response(
            [
                candidate_data(c, member(request))
                for c in self.paginate_queryset(self.get_queryset())
            ]
        )

    def retrieve(self, request, pk=None):
        return Response(candidate_data(self.get_object(), member(request)))

    @transaction.atomic
    def create(self, request):
        m = member(request)
        data = validated(CandidateCreateInput, request.data)
        existing = (
            ApplicationEntry.objects.select_related("application__candidate")
            .filter(organization=m.organization, request_key=data["request_key"])
            .first()
        )
        if existing:
            person = existing.application.candidate
            if (
                existing.actor_id != m.id
                or existing.application.job_id != data["job"]
                or existing.source != data["source"]
                or any(
                    getattr(person, field) != data[field]
                    for field in ["display_name", "phone", "email", "contact_note"]
                )
            ):
                raise Conflict("该保存请求已用于另一位候选人，请刷新后再试。")
            return Response({"candidate": person.id, "application": existing.application_id})

        job = open_job(m, data["job"])
        if possible_matches(m, data).exists():
            raise Conflict("发现疑似重复候选人，请先从已有档案核对后加入本次应聘。")
        person = Candidate.objects.create(
            organization=m.organization,
            created_by=m,
            **{field: data[field] for field in ["display_name", "phone", "email", "contact_note"]},
        )
        application = enter_application(m, person, job, data["source"], data["request_key"])
        audit(m, job, "人工新增候选人并建立应聘", application, note=f"候选人 {person.id}")
        return Response({"candidate": person.id, "application": application.id}, status=201)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def apply(self, request, pk=None):
        class EntryInput(serializers.Serializer):
            request_key = serializers.UUIDField()
            job = serializers.IntegerField(min_value=1)
            source = serializers.CharField(max_length=200)

        person = self.get_object()
        m = member(request)
        data = validated(EntryInput, request.data)
        job = get_object_or_404(hr_jobs(m), pk=data["job"])
        a = enter_application(m, person, job, data["source"], data["request_key"])
        return Response({"application": a.id})


def app_data(a, m, detail=False):
    result = {
        "id": a.id,
        "candidate": a.candidate_id,
        "name": a.candidate.display_name,
        "job": a.job_id,
        "job_title": a.job.title,
        "attempt_no": a.attempt_no,
        "stage": a.stage,
        "version": a.version,
        "profile": a.job.active_profile_id,
        "source": a.source,
        "owner_name": display_name(a.owner),
        "closed_at": a.closed_at,
        "close_reason": a.close_reason,
        "ai_status": "not_connected",
    }
    if detail:
        result.update(
            phone=a.candidate.phone,
            email=a.candidate.email,
            contact_note=a.candidate.contact_note,
            resumes=[
                {
                    "document": r.parse.document_id,
                    "name": r.parse.document.original_name,
                    "download": a.job.department_id in department_ids(m, ["resume_download"]),
                    "parse": parse_data(r.parse)
                    if r.parse.document.access_state == "active"
                    else None,
                }
                for r in a.resumes.select_related("parse__document", "parse__actor__user")
            ],
            reviews=[
                {
                    "id": r.id,
                    "action": r.action,
                    "reason": r.reason,
                    "created_at": r.created_at,
                    "reviewer_name": display_name(r.reviewer),
                    "result_stage": r.result_stage,
                    "profile": r.profile_id,
                    "input_parses": r.input_parses,
                    "followup_owner": display_name(r.followup_owner) if r.followup_owner else None,
                    "due_at": r.due_at,
                }
                for r in a.reviews.select_related(
                    "reviewer__user", "followup_owner__user"
                ).order_by("-id")
            ],
            handlers=[
                {"id": p.id, "name": display_name(p)}
                for p in Membership.objects.filter(
                    organization=m.organization, active=True, user__is_active=True
                )
                .filter(Q(id=a.job.owner_id) | Q(jobmember__job=a.job))
                .distinct()
                if can_edit(p, a.job)
            ],
            interviewers=[
                {"id": p.id, "name": display_name(p)}
                for p in Membership.objects.filter(
                    organization=m.organization,
                    active=True,
                    user__is_active=True,
                    roles__department=a.job.department,
                    roles__role__in=["manager", "supervisor", "interviewer"],
                )
                .select_related("user")
                .distinct()
                .order_by("id")
            ],
            requirements=list(
                a.job.active_profile.requirements.values("id", "kind", "text", "rationale")
            )
            if a.job.active_profile_id
            else [],
            job_status=a.job.status,
        )
    return result


class ReviewInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    profile = serializers.IntegerField(min_value=1)
    request_key = serializers.UUIDField()
    action = serializers.ChoiceField(
        choices=["advance", "need_info", "reject", "supplement", "withdraw"]
    )
    reason = serializers.CharField(max_length=2000)
    followup_owner = serializers.IntegerField(
        min_value=1, required=False, allow_null=True, default=None
    )
    due_at = serializers.DateTimeField(required=False, allow_null=True, default=None)

    def validate(self, data):
        if data["action"] == "need_info":
            if not data["followup_owner"] or not data["due_at"]:
                raise ValidationError("待补充必须指定本岗 HR 跟进人和期限。")
        elif data["followup_owner"] or data["due_at"]:
            raise ValidationError("只有待补充动作需要指定跟进人和期限。")
        return data


class ApplicationViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    def scoped_queryset(self):
        return Application.objects.filter(
            organization=member(self.request).organization, job__in=hr_jobs(member(self.request))
        ).select_related("candidate", "job__active_profile", "owner__user")

    def get_queryset(self):
        qs = self.scoped_queryset()
        search = self.request.query_params.get("search", "")[:100]
        qs = qs.filter(
            Q(candidate__display_name__icontains=search) | Q(job__title__icontains=search)
        )
        if self.request.query_params.get("stage"):
            qs = qs.filter(stage=self.request.query_params["stage"])
        if self.request.query_params.get("job"):
            qs = qs.filter(job_id=self.request.query_params["job"])
        if self.request.query_params.get("source"):
            qs = qs.filter(source=self.request.query_params["source"][:200])
        if self.request.query_params.get("owner"):
            qs = qs.filter(owner_id=self.request.query_params["owner"])
        return qs

    def list(self, request):
        return self.get_paginated_response(
            [app_data(a, member(request)) for a in self.paginate_queryset(self.get_queryset())]
        )

    def retrieve(self, request, pk=None):
        return Response(app_data(self.get_object(), member(request), True))

    @action(detail=False, methods=["get"], url_path="filter-options")
    def filter_options(self, request):
        qs = self.scoped_queryset()
        return Response(
            {
                "jobs": list(
                    qs.values("job_id", "job__title")
                    .distinct()
                    .order_by("job__title", "job_id")
                ),
                "sources": list(
                    qs.exclude(source="")
                    .values_list("source", flat=True)
                    .distinct()
                    .order_by("source")
                ),
                "owners": list(
                    qs.values("owner_id", "owner__user__first_name", "owner__user__username")
                    .distinct()
                    .order_by("owner__user__first_name", "owner__user__username", "owner_id")
                ),
            }
        )

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def review(self, request, pk=None):
        original = self.get_object()
        Candidate.objects.select_for_update().get(pk=original.candidate_id)
        Job.objects.select_for_update().get(pk=original.job_id)
        a = Application.objects.select_for_update().get(pk=original.pk)
        m = member(request)
        get_object_or_404(hr_jobs(m), pk=a.job_id)
        data = validated(ReviewInput, request.data)
        old = a.reviews.filter(request_key=data["request_key"]).first()
        if old:
            if (
                old.reviewer_id != m.id
                or old.profile_id != data["profile"]
                or any(getattr(old, k) != data[k] for k in ["action", "reason", "due_at"])
                or old.followup_owner_id != data["followup_owner"]
            ):
                raise Conflict("该复核请求已用于其他结果，请刷新查看。")
            return Response(app_data(a, m, True))
        if a.version != data["version"] or a.job.active_profile_id != data["profile"]:
            raise Conflict()
        if a.job.status != "open" and data["action"] != "withdraw":
            raise Conflict("职位当前未招聘，请先处理职位状态再复核。")
        allowed = (
            ["needs_information"]
            if data["action"] == "supplement"
            else ["pending_review", "needs_information"]
        )
        if data["action"] == "withdraw":
            allowed = ["pending_review", "needs_information", "ready_to_schedule"]
        if a.stage not in allowed:
            raise Conflict("当前阶段不能执行这项复核，请刷新查看。")
        handler = a.owner
        if data["action"] == "need_info":
            if data["due_at"] <= timezone.now():
                raise ValidationError("跟进期限需要晚于现在。")
            handler = get_object_or_404(
                Membership,
                pk=data["followup_owner"],
                organization=m.organization,
                active=True,
                user__is_active=True,
            )
        if data["action"] not in ["reject", "withdraw"] and (
            not handler.active or not handler.user.is_active or not can_edit(handler, a.job)
        ):
            raise ValidationError("接手人必须仍有本职位 HR 权限。")
        previous = a.stage
        a.stage = {
            "advance": "ready_to_schedule",
            "need_info": "needs_information",
            "reject": "closed",
            "supplement": "pending_review",
            "withdraw": "closed",
        }[data["action"]]
        if a.stage == "closed":
            a.closed_at = timezone.now()
            a.close_reason = data["reason"]
        a.version += 1
        a.save()
        ReviewDecision.objects.create(
            application=a,
            reviewer=m,
            request_key=data["request_key"],
            action=data["action"],
            reason=data["reason"],
            followup_owner=handler if data["action"] == "need_info" else None,
            due_at=data["due_at"],
            previous_stage=previous,
            result_stage=a.stage,
            profile=a.job.active_profile,
            input_parses=list(a.resumes.values_list("parse_id", flat=True)),
        )
        StageEvent.objects.create(
            application=a,
            actor=m,
            from_stage=previous,
            to_stage=a.stage,
            request_key=data["request_key"],
        )
        Task.objects.filter(application=a, status="pending").update(
            status="done", completed_at=timezone.now()
        )
        if a.stage != "closed":
            Task.objects.create(
                application=a,
                assignee=handler,
                due_at=data["due_at"],
                kind={
                    "ready_to_schedule": "schedule",
                    "needs_information": "need_info",
                    "pending_review": "app_review",
                }[a.stage],
            )
        audit(m, a.job, "人工复核应聘", a, note=f"{previous} → {a.stage}")
        return Response(app_data(a, m, True))


class DocumentViewSet(GenericViewSet):
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        m = member(request)
        doc = get_object_or_404(
            ResumeDocument, pk=pk, organization=m.organization, access_state="active"
        )
        jobs = hr_jobs(m).filter(department_id__in=department_ids(m, ["resume_download"]))
        job = (
            jobs.filter(
                Q(importbatch__items__document=doc) | Q(application__resumes__parse__document=doc)
            )
            .distinct()
            .first()
        )
        if not job:
            raise PermissionDenied("当前没有该简历原件的下载授权。")
        try:
            stream = file_path(doc).open("rb")
        except FileNotFoundError:
            raise ValidationError("原件暂时不可用，请联系维护人员恢复文件。") from None
        audit(m, job, "下载简历原件", note=f"文件 {doc.id}")
        response = FileResponse(
            stream,
            as_attachment=True,
            filename=doc.original_name,
            content_type="application/octet-stream",
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
