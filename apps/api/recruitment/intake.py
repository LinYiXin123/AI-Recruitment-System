import hashlib
import json
import re
import subprocess
import sys
import uuid
from datetime import date
from pathlib import Path

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.db.models import Max, Prefetch, Q
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
    CandidateEditRequest,
    ImportBatch,
    ImportItem,
    Job,
    Membership,
    Organization,
    ResumeDocument,
    ResumeParse,
    ReviewDecision,
    StageEvent,
    Task,
)
from .serializers import display_name, member_profile, member_profiles


def hr_jobs(m):
    return (
        visible_jobs(m)
        .filter(department_id__in=department_ids(m, ["hr"]))
        .filter(Q(owner=m) | Q(collaborators__membership=m))
        .distinct()
    )


def requirement_data(item):
    return {
        "id": item.id,
        "category": item.category,
        "kind": item.kind,
        "text": item.text,
        "rationale": item.rationale,
        "needs_verification": item.needs_verification,
        "source_kind": item.source_kind,
        "source_quote": item.source_quote,
        "source_reference": item.source_reference,
        "source_edited": item.source_edited,
    }


def candidates(m, *, include_deleted=False):
    own_unassigned = Q(created_by=m, applications__isnull=True)
    if not department_ids(m, ["hr"]).exists():
        own_unassigned = Q(pk__in=[])
    queryset = (
        Candidate.objects.filter(organization=m.organization)
        .filter(Q(applications__job__in=hr_jobs(m)) | own_unassigned)
        .distinct()
    )
    return queryset if include_deleted else queryset.filter(deleted_at__isnull=True)


def require_hr(m):
    if not department_ids(m, ["hr"]).exists():
        raise PermissionDenied("当前没有候选人录入权限。")


CANDIDATE_FIELDS = (
    "display_name",
    "phone",
    "email",
    "contact_note",
    "gender",
    "current_city",
    "identity_number",
    "birthday",
    "intended_role",
    "education_level",
    "school",
    "work_years",
    "current_salary",
    "expected_salary",
    "work_experience",
    "education_experience",
    "remarks",
    "resume_text",
)


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
    if job.archived_at:
        raise ValidationError("该职位画像已删除，不能接收新的应聘。")
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
    source = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    total = serializers.IntegerField(min_value=1, max_value=20)


class ParseInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    text = serializers.CharField(max_length=100000, required=False)


class CandidateProfileInput(serializers.Serializer):
    current_city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    education_level = serializers.ChoiceField(
        choices=["高中及以下", "大专", "本科", "硕士", "博士", "其他"],
        required=False,
        allow_blank=True,
    )
    school = serializers.CharField(max_length=200, required=False, allow_blank=True)
    work_years = serializers.CharField(max_length=100, required=False, allow_blank=True)
    current_salary = serializers.CharField(max_length=100, required=False, allow_blank=True)
    expected_salary = serializers.CharField(max_length=100, required=False, allow_blank=True)
    intended_role = serializers.CharField(max_length=200, required=False, allow_blank=True)
    source = serializers.ChoiceField(
        choices=[
            "BOSS直聘",
            "智联招聘",
            "前程无忧",
            "猎聘",
            "拉勾",
            "内推",
            "猎头推荐",
            "校园招聘",
            "官网投递",
            "其他",
        ],
        required=False,
        allow_blank=True,
    )

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - self.fields.keys()
            if unknown:
                raise ValidationError({field: "不支持修改此字段。" for field in sorted(unknown)})
        return super().to_internal_value(data)


PROFILE_FIELDS = tuple(CandidateProfileInput().fields)


class IdentityInput(CandidateProfileInput):
    parse = serializers.IntegerField(min_value=1, required=False)
    application = serializers.IntegerField(min_value=1, required=False)
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
        if data.get("application") and not data["candidate"]:
            raise ValidationError({"candidate": "补充本次应聘材料时，请选定已有的人才主档。"})
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
    job = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    resume_document = serializers.IntegerField(
        min_value=1, required=False, allow_null=True, default=None
    )
    resume_parse = serializers.IntegerField(
        min_value=1, required=False, allow_null=True, default=None
    )
    gender = serializers.ChoiceField(
        choices=["男", "女"], required=False, allow_blank=True, default=""
    )
    identity_number = serializers.CharField(
        max_length=18, required=False, allow_blank=True, default=""
    )
    birthday = serializers.CharField(max_length=10, required=False, allow_blank=True, default="")
    stage = serializers.ChoiceField(
        choices=[
            "pending_review",
            "ready_to_schedule",
            "first_interview_passed",
            "second_interview",
            "second_interview_passed",
            "offer_sent",
            "hired",
            "closed",
            "talent_pool",
        ],
        default="pending_review",
    )
    expected_start_date = serializers.DateField(required=False, allow_null=True, default=None)
    work_experience = serializers.CharField(
        max_length=4000, required=False, allow_blank=True, default=""
    )
    education_experience = serializers.CharField(
        max_length=4000, required=False, allow_blank=True, default=""
    )
    remarks = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    resume_text = serializers.CharField(
        max_length=100000, required=False, allow_blank=True, default=""
    )

    def validate_identity_number(self, value):
        value = value.strip().upper()
        if value and not re.fullmatch(r"\d{17}[\dX]", value):
            raise ValidationError("身份证号应为 18 位数字，最后一位可为 X。")
        return value

    def validate_birthday(self, value):
        value = value.strip()
        if not value:
            return value
        try:
            if re.fullmatch(r"\d{2}-\d{2}", value):
                date.fromisoformat(f"2000-{value}")
            else:
                date.fromisoformat(value)
        except ValueError:
            raise ValidationError("生日请填写 09-28 或 1998-09-28。") from None
        return value

    def validate(self, data):
        for field in PROFILE_FIELDS:
            data.setdefault(field, "")
        if not data["phone"] and not data["email"] and not data["contact_note"]:
            raise ValidationError("请至少填写手机号或邮箱。")
        if not data["job"] and data["stage"] != "pending_review":
            raise ValidationError("未关联职位时只能先入库，不能记录应聘阶段。")
        if bool(data["resume_document"]) != bool(data["resume_parse"]):
            raise ValidationError("请同时提交简历附件及本次核对的文字版本。")
        if data["identity_number"] and not data["birthday"]:
            raw_birthday = data["identity_number"][6:14]
            try:
                date.fromisoformat(f"{raw_birthday[:4]}-{raw_birthday[4:6]}-{raw_birthday[6:]}")
            except ValueError:
                raise ValidationError("身份证号中的生日无效，请核对后再保存。") from None
            data["birthday"] = f"{raw_birthday[:4]}-{raw_birthday[4:6]}-{raw_birthday[6:]}"
        return data


class CandidateEditFields(CandidateCreateInput):
    source = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate_source(self, value):
        if (
            value
            and value not in CandidateProfileInput().fields["source"].choices
            and value != self.context.get("original_source")
        ):
            raise ValidationError("请选择有效的简历来源。")
        return value

    def get_fields(self):
        return {
            key: field
            for key, field in super().get_fields().items()
            if key in [*CANDIDATE_FIELDS, "source"]
        }

    def validate(self, data):
        # 复用创建表单的身份、生日、联系方式和资料字段校验，不接收其业务动作字段。
        checked = super().validate(
            {
                **data,
                "job": None,
                "stage": "pending_review",
                "resume_document": None,
                "resume_parse": None,
            }
        )
        return {key: value for key, value in checked.items() if key in self.fields}


class CandidateApplicationEditInput(serializers.Serializer):
    id = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    version = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    stage = serializers.ChoiceField(
        choices=[
            *CandidateCreateInput().fields["stage"].choices,
            "needs_information",
            "interviewing",
        ],
        required=False,
    )
    expected_start_date = serializers.DateField(required=False, allow_null=True)

    def validate(self, data):
        if bool(data["id"]) != bool(data["version"]):
            raise ValidationError("编辑已有应聘时请同时提交应聘 ID 和版本。")
        return data


class CandidateEditInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    updated_at = serializers.DateTimeField()
    fields = serializers.DictField(required=False, default=dict)
    application = CandidateApplicationEditInput(required=False)
    job = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    resume_document = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    resume_parse = serializers.IntegerField(min_value=1, required=False, allow_null=True)

    def validate(self, data):
        if bool(data.get("resume_document")) != bool(data.get("resume_parse")):
            raise ValidationError("请同时提交简历附件及本次核对的文字版本。")
        application = data.get("application", {})
        if (
            not application.get("id")
            and not data["job"]
            and (
                application.get("stage", "pending_review") != "pending_review"
                or application.get("expected_start_date")
            )
        ):
            raise ValidationError("请先选择关联职位，再填写应聘阶段或预计入职日期。")
        return data


def possible_matches(m, data):
    query = Q(display_name__iexact=data["display_name"])
    if data["phone"]:
        query |= Q(phone=data["phone"])
    if data["email"]:
        query |= Q(email__iexact=data["email"])
    return candidates(m).filter(query).order_by("id")


def lock_candidate_creation(m):
    # ponytail: 同组织的新建短事务串行；出现锁争用后再细分身份锁，不阻塞组织外键引用。
    Organization.objects.select_for_update(no_key=True).get(pk=m.organization_id)


def standalone_download_allowed(c, m):
    return (
        c.deleted_at is None
        and c.created_by_id == m.id
        and not c.applications.exists()
        and department_ids(m, ["hr"])
        .filter(department_id__in=department_ids(m, ["resume_download"]))
        .exists()
    )


def candidate_data(c, m, detail=False):
    applications = list(
        c.applications.filter(job__in=hr_jobs(m))
        .select_related("owner__user", "job")
        .order_by("-id")
    )
    source = c.source or (applications[0].source if applications else "")
    result = {
        "id": c.id,
        "display_name": c.display_name,
        "phone": c.phone,
        "email": c.email,
        "contact_note": c.contact_note,
        "current_city": c.current_city,
        "education_level": c.education_level,
        "work_years": c.work_years,
        "expected_salary": c.expected_salary,
        "source": "" if source in ["HR 上传", "未标注"] else source,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
        "active_application_count": sum(a.closed_at is None for a in applications),
        "applications": [
            {
                "id": a.id,
                "job_id": a.job_id,
                "job__title": a.job.title,
                "attempt_no": a.attempt_no,
                "stage": a.stage,
                "version": a.version,
                "can_edit": can_edit(m, a.job),
                "expected_start_date": a.expected_start_date,
                "offer_sent_at": None,
                "hired_at": None,
                "closed_at": a.closed_at,
                "source": a.source,
                "owner_name": display_name(a.owner),
            }
            for a in applications
        ],
    }
    docs = (
        ResumeDocument.objects.filter(candidate=c)
        .filter(
            Q(parses__applicationresume__application__in=applications)
            | Q(uploaded_by=m, candidate__applications__isnull=True)
        )
        .distinct()
    )
    current_parse = c.profile_resume_parse
    source_doc = (
        current_parse.document_id if current_parse else c.creation_payload.get("resume_document")
    )
    source_job = c.creation_payload.get("job")
    if not c.creation_payload and not current_parse:
        source_doc = (
            ResumeDocument.objects.filter(
                candidate=c, uploaded_by_id=c.created_by_id, created_at__lte=c.created_at
            )
            .order_by("id")
            .values_list("id", flat=True)
            .first()
        )
    source_visible = (
        docs.filter(pk=source_doc, access_state="active").exists()
        if source_doc
        else (
            any(a.job_id == source_job for a in applications)
            if source_job
            else c.created_by_id == m.id
        )
    )
    if current_parse:
        source_visible = source_visible and (
            current_parse.applicationresume_set.filter(application__in=applications).exists()
            if applications
            else current_parse.document.uploaded_by_id == m.id
        )
    can_edit_profile = source_visible and department_ids(m, ["hr"]).exists()
    result["can_edit_profile"] = can_edit_profile
    result["can_delete"] = (
        can_edit_profile and not c.applications.exclude(job__in=hr_jobs(m)).exists()
    )
    if detail:
        result.update({field: getattr(c, field) for field in CANDIDATE_FIELDS})
        result["can_edit_profile"] = can_edit_profile
        result["offer_sent_at"] = None
        result["hired_at"] = None
        if not source_visible:
            # 附件失去授权后，不通过保存在主档的文字副本继续提供原材料。
            for field in [
                "identity_number",
                "birthday",
                "current_salary",
                "work_experience",
                "education_experience",
                "remarks",
                "resume_text",
            ]:
                result[field] = ""
        result["resume_documents"] = []
        visible_profile_parse = None
        for doc in docs:
            visible_parses = doc.parses.filter(applicationresume__application__in=applications)
            parse = visible_parses.first() if applications else doc.parses.first()
            if doc.id == source_doc and source_visible:
                if current_parse:
                    parse = current_parse
                result["resume_text"] = parse.text if parse and doc.access_state == "active" else ""
                visible_profile_parse = parse
            download = standalone_download_allowed(c, m) or any(
                a.job.department_id in department_ids(m, ["resume_download"])
                and a.resumes.filter(parse__document=doc).exists()
                for a in applications
            )
            result["resume_documents"].append(
                {
                    "document": doc.id,
                    "name": doc.original_name,
                    "download": download and doc.access_state == "active",
                    "is_current": doc.id == source_doc and source_visible,
                    "file_type": doc.file_type,
                    "size": doc.size,
                    "created_at": doc.created_at,
                    "parse": parse_data(parse) if doc.access_state == "active" else None,
                }
            )
        from .ai_screening import _report_data, _visible_screenings
        from .interviews import interview_data, visible_interviews

        result["interview_records"] = [
            interview_data(row)
            for row in visible_interviews(m).filter(application__in=applications)
        ]
        result["interview_count"] = len(result["interview_records"])
        result["ai_screenings"] = [
            _report_data(row, detail=False)
            for row in _visible_screenings(m).filter(application__in=applications)
        ]
        result["ai_screening_count"] = len(result["ai_screenings"])
        portrait = _visible_screenings(m).filter(
            application__isnull=True,
            job__isnull=True,
            resume_parse__document__candidate=c,
        ).first()
        result["talent_profile_analysis"] = None
        if portrait:
            profile_result = portrait.result
            source = (portrait.source_context or {}).get("source")
            result["talent_profile_analysis"] = {
                "id": portrait.id,
                "created_at": portrait.created_at.isoformat(),
                "summary": profile_result.get("summary", ""),
                "source_context": {"source": source} if source else None,
                "evidence": profile_result.get("evidence", []),
                "gaps": profile_result.get("gaps", []),
                "questions": profile_result.get("questions", []),
                "resume_parse_id": portrait.resume_parse_id,
                "source_is_current": bool(
                    visible_profile_parse and portrait.resume_parse_id == visible_profile_parse.id
                ),
            }
    return result


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


def extract_resume_text(path, kind):
    if kind not in ["pdf", "docx", "txt"]:
        return {
            "error": "附件已保留。图片 OCR 和旧版 DOC 识别未接通，请人工填写或改用 PDF、DOCX、TXT。"
        }
    try:
        process = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).with_name("extract_resume.py")),
                str(path),
                kind,
            ],
            capture_output=True,
            timeout=15,
            check=True,
        )
        return json.loads(process.stdout)
    except (subprocess.SubprocessError, ValueError, OSError):
        return {"error": "提取超时或资源不足，可重试、重传精简文件或人工摘录。"}


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
    result = (
        {"text": manual, "error": "" if manual else "未填写简历文字。"}
        if manual is not None
        else {}
    )
    if manual is None:
        result = extract_resume_text(file_path(doc), doc.file_type)
    return ResumeParse.objects.create(
        document=doc,
        version=(doc.parses.aggregate(n=Max("version"))["n"] or 0) + 1,
        parser_version="人工摘录" if manual is not None else "pypdf6.19 / DOCX段落 / TXT v1",
        status="succeeded" if result.get("text") else "failed",
        text=result.get("text", ""),
        error=result.get("error", ""),
        actor=m,
        request_key=key,
    )


def enter_application(
    m,
    candidate,
    job,
    source,
    key,
    stage="pending_review",
    expected_start_date=None,
):
    # 人→职位→应聘的固定加锁次序；数据库条件唯一保证同岗仅一条进行中记录。
    candidate = Candidate.objects.select_for_update().get(pk=candidate.pk)
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
    if candidate.deleted_at:
        raise Conflict("该候选人已从候选人库删除，不能再加入新应聘。")
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
            stage=stage,
            expected_start_date=expected_start_date,
            closed_at=timezone.now() if stage == "closed" else None,
            close_reason="人工录入时标记为已淘汰" if stage == "closed" else "",
            attempt_no=(
                Application.objects.filter(candidate=candidate, job=job).aggregate(
                    n=Max("attempt_no")
                )["n"]
                or 0
            )
            + 1,
        )
        StageEvent.objects.create(application=a, actor=m, to_stage=a.stage, request_key=key)
        if stage == "pending_review":
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
                # ponytail: 精确身份匹配须完整可选；匹配集合变大后再加入分页。
                "results": [candidate_data(c, member(request)) for c in matches],
            }
        )

    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/confirm")
    @transaction.atomic
    def confirm(self, request, pk=None, item_id=None):
        m = member(request)
        data = validated(IdentityInput, request.data)
        if not data["candidate"]:
            lock_candidate_creation(m)
        batch = self.locked()
        item = get_object_or_404(batch.items, pk=item_id)
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
            person = get_object_or_404(
                candidates(m, include_deleted="application" in data), pk=data["candidate"]
            )
            if not data["identity_note"]:
                raise ValidationError("选用已有主档时，请记录核对依据。")
        else:
            if possible_matches(m, data).exists() and not data["identity_note"]:
                raise Conflict("找到疑似重复，请核对已有主档；若为不同的人，请填写区分依据。")
            person = Candidate.objects.create(
                organization=m.organization,
                created_by=m,
                creation_payload={"resume_document": item.document_id, "job": job.id},
                **{key: data[key] for key in ["display_name", "phone", "email", "contact_note"]},
                **{key: data[key] for key in PROFILE_FIELDS if key in data},
            )
        if "application" in data:
            Candidate.objects.select_for_update().get(pk=person.pk)
            Job.objects.select_for_update().get(pk=job.pk)
            job = open_job(m, job.pk)
            a = get_object_or_404(
                Application.objects.select_for_update(),
                pk=data["application"],
                organization=m.organization,
                job=job,
                candidate=person,
            )
            if a.closed_at is not None:
                raise Conflict("本次应聘已结束，不能继续补充材料。请返回查看当前应聘状态。")
        else:
            a = enter_application(
                m, person, job, data.get("source", batch.source), item.request_key
            )
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
        m = member(self.request)
        qs = (
            candidates(m)
            .filter(
                Q(display_name__icontains=search)
                | Q(phone__icontains=search)
                | Q(email__icontains=search)
            )
            .order_by("-id")
        )
        if self.request.query_params.get("education_level"):
            qs = qs.filter(education_level=self.request.query_params["education_level"][:20])
        app_filters = {}
        if self.request.query_params.get("job"):
            try:
                app_filters["job_id"] = int(self.request.query_params["job"])
            except ValueError:
                raise ValidationError("职位筛选无效。") from None
        stage = self.request.query_params.get("stage")
        if stage:
            app_filters["stage"] = stage
        if app_filters:
            matching = Application.objects.filter(job__in=hr_jobs(m), **app_filters)
            allowed = Q(applications__in=matching)
            if stage == "pending_review" and not app_filters.get("job_id"):
                allowed |= Q(applications__isnull=True)
            qs = qs.filter(allowed)
        source = self.request.query_params.get("source", "")[:200]
        if source:
            qs = qs.filter(
                Q(source=source)
                | Q(
                    source="",
                    applications__in=Application.objects.filter(job__in=hr_jobs(m), source=source),
                )
            )
        return qs.distinct()

    def list(self, request):
        return self.get_paginated_response(
            [
                candidate_data(c, member(request))
                for c in self.paginate_queryset(self.get_queryset())
            ]
        )

    def retrieve(self, request, pk=None):
        return Response(candidate_data(self.get_object(), member(request), detail=True))

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def edit(self, request, pk=None):
        data = validated(CandidateEditInput, request.data)
        m = member(request)
        require_hr(m)
        lock_candidate_creation(m)
        original = get_object_or_404(candidates(m), pk=pk)
        person = Candidate.objects.select_for_update().get(pk=original.pk)
        m = member(request)
        require_hr(m)
        get_object_or_404(candidates(m), pk=person.pk)
        detail = candidate_data(person, m, detail=True)
        if not detail["can_edit_profile"]:
            raise PermissionDenied("当前没有候选人原始资料的编辑授权。")
        digest = hashlib.sha256(
            json.dumps(data, cls=DjangoJSONEncoder, sort_keys=True).encode()
        ).hexdigest()
        old = CandidateEditRequest.objects.filter(
            candidate=person, actor=m, request_key=data["request_key"]
        ).first()
        if old:
            if old.input_digest != digest:
                raise Conflict("该编辑请求已用于其他内容，请刷新后重新核对。")
            return Response(detail)
        if person.updated_at != data["updated_at"]:
            raise Conflict("候选人资料已更新，请刷新后核对再保存。")

        fields = {field: getattr(person, field) for field in CANDIDATE_FIELDS}
        fields["source"] = person.source
        if data["fields"]:
            form = CandidateEditFields(
                data={**fields, **data["fields"]}, context={"original_source": person.source}
            )
            form.is_valid(raise_exception=True)
            fields = form.validated_data
        if any(getattr(person, key) != fields[key] for key in ["display_name", "phone", "email"]):
            if possible_matches(m, fields).exclude(pk=person.pk).exists():
                raise Conflict("发现姓名或联系方式相似的其他候选人，请先核对，不能自动合并。")

        app_input = data.get("application", {})
        selected = None
        if app_input.get("id"):
            selected = get_object_or_404(
                person.applications.filter(job__in=hr_jobs(m)), pk=app_input["id"]
            )
        job_ids = {value for value in [data["job"], selected.job_id if selected else None] if value}
        for job_id in sorted(job_ids):
            Job.objects.select_for_update().get(pk=get_object_or_404(hr_jobs(m), pk=job_id).pk)
        if selected:
            selected = Application.objects.select_for_update().get(pk=selected.pk)
            get_object_or_404(hr_jobs(m), pk=selected.job_id)
            if selected.version != app_input["version"]:
                raise Conflict("本次应聘已更新，请刷新后核对再保存。")

        target = selected
        new_application = bool(data["job"] and (not selected or data["job"] != selected.job_id))
        stage = app_input.get(
            "stage", selected.stage if selected and not new_application else "pending_review"
        )
        expected_date = app_input.get(
            "expected_start_date",
            selected.expected_start_date if selected and not new_application else None,
        )
        if new_application:
            job = open_job(m, data["job"])
            if person.applications.filter(job=job, closed_at__isnull=True).exists():
                raise Conflict("该职位已有进行中的应聘，请选择并核对该条应聘后保存。")
            if stage in ["needs_information", "interviewing"]:
                raise ValidationError("请通过补充材料或安排面试操作进入此阶段。")
            target = enter_application(
                m, person, job, fields["source"], data["request_key"], stage, expected_date
            )
            if stage == "ready_to_schedule":
                Task.objects.create(application=target, kind="schedule", assignee=target.owner)
        elif target:
            changed_stage = stage != target.stage
            if changed_stage:
                if target.closed_at:
                    raise Conflict("已结束的应聘不能重新开启，请为需要继续的职位新增应聘。")
                if target.job.status != "open":
                    raise Conflict("职位当前未招聘，不能修改应聘阶段。")
                if stage in ["needs_information", "interviewing"]:
                    raise ValidationError("请通过补充材料或安排面试操作进入此阶段。")
                if target.interviews.exclude(status__in=["completed", "cancelled"]).exists():
                    raise Conflict("本次应聘仍有未结束面试，请先处理面试安排再修改阶段。")
                previous = target.stage
                target.stage = stage
                target.closed_at = timezone.now() if stage == "closed" else None
                target.close_reason = "HR 在候选人编辑中标记为已淘汰" if stage == "closed" else ""
                StageEvent.objects.create(
                    application=target,
                    actor=m,
                    from_stage=previous,
                    to_stage=stage,
                    request_key=data["request_key"],
                )
                Task.objects.filter(application=target, status="pending").update(
                    status="done", completed_at=timezone.now()
                )
                task_kind = {"pending_review": "app_review", "ready_to_schedule": "schedule"}.get(
                    stage
                )
                if task_kind:
                    Task.objects.create(application=target, kind=task_kind, assignee=target.owner)
            if changed_stage or expected_date != target.expected_start_date:
                target.expected_start_date = expected_date
                target.version += 1
                target.save()

        doc = parse = None
        if data.get("resume_document"):
            if not target and person.applications.exists():
                raise ValidationError("请明确选择本次应聘，再关联新简历。")
            doc = get_object_or_404(
                ResumeDocument.objects.select_for_update(),
                pk=data["resume_document"],
                organization=m.organization,
                uploaded_by=m,
                candidate__isnull=True,
                request_key__isnull=False,
                access_state="active",
            )
            parse = doc.parses.first()
            if not parse or parse.id != data["resume_parse"]:
                raise Conflict("简历文字版本已改变，请重新核对附件。")
            doc.candidate = person
            doc.save(update_fields=["candidate", "updated_at"])
        else:
            current = next((row for row in detail["resume_documents"] if row["is_current"]), None)
            if current and current["parse"]:
                doc = get_object_or_404(
                    ResumeDocument.objects.select_for_update(),
                    pk=current["document"],
                    organization=m.organization,
                    candidate=person,
                    access_state="active",
                )
                locked_detail = candidate_data(person, m, detail=True)
                if not locked_detail["can_edit_profile"]:
                    raise PermissionDenied("当前没有候选人原始资料的编辑授权。")
                parse = doc.parses.get(pk=current["parse"]["id"])
                if (
                    "resume_text" in data["fields"]
                    and fields["resume_text"] != parse.text
                    and not target
                    and person.applications.exists()
                ):
                    raise ValidationError("请明确选择本次应聘，再修改简历文字。")
        if parse:
            text_changed = "resume_text" in data["fields"] and fields["resume_text"] != parse.text
            if text_changed:
                if doc.parses.first().id != parse.id:
                    raise Conflict("简历文字版本已更新，请刷新后核对再保存。")
                parse = create_parse(doc, m, uuid.uuid4(), manual=fields["resume_text"])
            elif data.get("resume_document"):
                fields["resume_text"] = parse.text
            if target and (new_application or data.get("resume_document") or text_changed):
                ApplicationResume.objects.get_or_create(
                    application=target, parse=parse, defaults={"assigned_by": m}
                )
            person.profile_resume_parse = parse

        if data["fields"].get("source") == "":
            fields["source"] = "未标注"
        changed = [field for field, value in fields.items() if getattr(person, field) != value]
        for field, value in fields.items():
            setattr(person, field, value)
        person.save(update_fields=[*fields, "profile_resume_parse", "updated_at"])
        CandidateEditRequest.objects.create(
            candidate=person, actor=m, request_key=data["request_key"], input_digest=digest
        )
        audited = (
            target or person.applications.filter(job__in=hr_jobs(m)).select_related("job").first()
        )
        if audited:
            audit(
                m,
                audited.job,
                "编辑候选人资料",
                audited,
                note=f"字段：{', '.join(changed)}；附件：{doc.id if doc else '不变'}",
            )
        return Response(candidate_data(person, m, detail=True))

    @transaction.atomic
    def destroy(self, request, pk=None):
        class DeleteInput(serializers.Serializer):
            updated_at = serializers.DateTimeField()

        m = member(request)
        require_hr(m)
        original = get_object_or_404(candidates(m, include_deleted=True), pk=pk)
        person = Candidate.objects.select_for_update().get(pk=original.pk)
        m = member(request)
        require_hr(m)
        get_object_or_404(candidates(m, include_deleted=True), pk=person.pk)
        if not candidate_data(person, m)["can_delete"]:
            raise PermissionDenied("当前没有该候选人及全部关联职位的删除权限。")
        data = validated(DeleteInput, request.data)
        if person.deleted_at:
            return Response({"deleted": True})
        if person.updated_at != data["updated_at"]:
            raise Conflict("候选人资料已更新，请刷新后确认再删除。")
        if person.applications.filter(closed_at__isnull=True).exists():
            raise Conflict("仍有进行中的应聘，请先处理这些应聘再删除候选人。")
        person.deleted_at = timezone.now()
        person.deleted_by = m
        person.save(update_fields=["deleted_at", "deleted_by", "updated_at"])
        for application in person.applications.select_related("job"):
            audit(m, application.job, "从候选人库删除", application, note="保留已有应聘及面试记录")
        return Response({"deleted": True})

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def restore(self, request, pk=None):
        class RestoreInput(serializers.Serializer):
            updated_at = serializers.DateTimeField()

        m = member(request)
        require_hr(m)
        lock_candidate_creation(m)
        original = get_object_or_404(candidates(m, include_deleted=True), pk=pk)
        person = Candidate.objects.select_for_update().get(pk=original.pk)
        m = member(request)
        require_hr(m)
        get_object_or_404(candidates(m, include_deleted=True), pk=person.pk)
        if not candidate_data(person, m)["can_delete"]:
            raise PermissionDenied("当前没有该候选人及全部关联职位的恢复权限。")
        data = validated(RestoreInput, request.data)
        if not person.deleted_at:
            return Response({"restored": True})
        if person.updated_at != data["updated_at"]:
            raise Conflict("候选人资料已更新，请刷新后确认再恢复。")
        if possible_matches(
            m, {field: getattr(person, field) for field in ["display_name", "phone", "email"]}
        ).exists():
            raise Conflict("候选人库已有姓名或联系方式相似的档案，请先核对后再恢复。")
        person.deleted_at = None
        person.deleted_by = None
        person.save(update_fields=["deleted_at", "deleted_by", "updated_at"])
        for application in person.applications.select_related("job"):
            audit(
                m, application.job, "恢复到候选人库", application, note="保留原主档及本次应聘阶段"
            )
        return Response({"restored": True})

    @action(detail=True, methods=["post"], url_path="supplement-profile")
    @transaction.atomic
    def supplement_profile(self, request, pk=None):
        class SupplementInput(serializers.Serializer):
            updated_at = serializers.DateTimeField()
            parse = serializers.IntegerField(min_value=1, required=False, allow_null=True)
            fields = CandidateProfileInput()

        m = member(request)
        require_hr(m)
        original = self.get_object()
        person = Candidate.objects.select_for_update().get(pk=original.pk)
        get_object_or_404(candidates(m), pk=person.pk)
        detail = candidate_data(person, m, detail=True)
        if not detail["can_edit_profile"]:
            raise PermissionDenied("当前没有候选人原始资料的编辑授权。")
        data = validated(SupplementInput, request.data)
        if data["updated_at"] != person.updated_at:
            raise Conflict("候选人资料已更新，请刷新后核对再保存。")
        if data.get("parse"):
            visible = detail["resume_documents"]
            source = next(
                (
                    doc
                    for doc in visible
                    if doc["parse"]
                    and doc["parse"]["id"] == data["parse"]
                    and doc["parse"]["status"] == "succeeded"
                ),
                None,
            )
            if not source:
                raise ValidationError({"parse": "请选择当前可查看的简历文字版本。"})
            document = get_object_or_404(
                ResumeDocument.objects.select_for_update(),
                pk=source["document"],
                candidate=person,
                access_state="active",
            )
            locked_detail = candidate_data(person, m, detail=True)
            if not locked_detail["can_edit_profile"]:
                raise PermissionDenied("当前没有候选人原始资料的编辑授权。")
            if document.parses.first().id != data["parse"] or not any(
                doc["document"] == source["document"]
                and doc["parse"]
                and doc["parse"]["id"] == data["parse"]
                and doc["parse"]["status"] == "succeeded"
                for doc in locked_detail["resume_documents"]
            ):
                raise Conflict("简历文字版本已更新，请刷新后核对再保存。")
        if data["fields"].get("source") == "":
            # 区分主动清空和旧档案未录入，不改写应聘渠道历史。
            data["fields"]["source"] = "未标注"
        changed = [
            field for field, value in data["fields"].items() if getattr(person, field) != value
        ]
        if changed:
            for field in changed:
                setattr(person, field, data["fields"][field])
            person.save(update_fields=[*changed, "updated_at"])
            application = (
                person.applications.filter(job__in=hr_jobs(m)).select_related("job").first()
            )
            if application:
                audit(
                    m,
                    application.job,
                    "核对并补全候选人资料",
                    application,
                    note=f"字段：{', '.join(changed)}；材料版本：{data.get('parse') or '人工填写'}",
                )
        return Response(candidate_data(person, m, detail=True))

    @action(detail=False, methods=["post"], url_path="preview-resume")
    def preview_resume(self, request):
        m = member(request)
        require_hr(m)
        key = validated(ParseInput, request.data)["request_key"]
        upload = request.FILES.get("file")
        if not upload or not upload.size or upload.size > 10 * 1024 * 1024:
            raise ValidationError("请选择 10MB 以内的非空简历附件。")
        raw = upload.read()
        kind = Path(upload.name).suffix.lower().lstrip(".")
        signatures = {
            "pdf": (b"%PDF-",),
            "docx": (b"PK\x03\x04",),
            "doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
            "jpg": (b"\xff\xd8\xff",),
            "jpeg": (b"\xff\xd8\xff",),
            "png": (b"\x89PNG\r\n\x1a\n",),
        }
        if kind != "txt" and (kind not in signatures or not raw.startswith(signatures[kind])):
            raise ValidationError("文件内容与格式不符，请上传 PDF、DOCX、TXT、DOC、JPG 或 PNG。")
        digest = hashlib.sha256(raw).hexdigest()
        saved_path = None
        try:
            with transaction.atomic():
                Membership.objects.select_for_update().get(pk=m.pk)
                doc = ResumeDocument.objects.filter(uploaded_by=m, request_key=key).first()
                if doc:
                    if doc.sha256 != digest or doc.file_type != kind:
                        raise Conflict("这个上传请求已用于其他附件，请重新选择文件。")
                    if doc.access_state != "active":
                        raise PermissionDenied("该附件已停止访问。")
                    if doc.candidate_id:
                        get_object_or_404(candidates(m), pk=doc.candidate_id)
                else:
                    doc = ResumeDocument.objects.create(
                        organization=m.organization,
                        uploaded_by=m,
                        request_key=key,
                        original_name=Path(upload.name).name[:255],
                        file_type=kind,
                        size=len(raw),
                        sha256=digest,
                    )
                    settings.PRIVATE_RESUME_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
                    saved_path = file_path(doc)
                    with saved_path.open("xb") as stream:
                        saved_path.chmod(0o600)
                        stream.write(raw)
                    create_parse(doc, m, key)
                result = {
                    "document": doc.id,
                    "name": doc.original_name,
                    "parse": parse_data(doc.parses.first()),
                }
            return Response(result, status=201 if saved_path else 200)
        except Exception:
            if saved_path:
                saved_path.unlink(missing_ok=True)
            raise

    @transaction.atomic
    def create(self, request):
        m = member(request)
        require_hr(m)
        data = validated(CandidateCreateInput, request.data)
        lock_candidate_creation(m)
        Membership.objects.select_for_update().get(pk=m.pk)
        payload = {
            "fingerprint": hashlib.sha256(
                json.dumps(data, cls=DjangoJSONEncoder, sort_keys=True).encode("utf-8")
            ).hexdigest(),
            "resume_document": data["resume_document"],
            "job": data["job"],
        }
        old = Candidate.objects.filter(
            organization=m.organization, request_key=data["request_key"]
        ).first()
        if old:
            if old.created_by_id != m.id or old.creation_payload != payload:
                raise Conflict("该保存请求已用于其他内容，请刷新后再试。")
            get_object_or_404(candidates(m), pk=old.pk)
            entry = ApplicationEntry.objects.filter(
                organization=m.organization, actor=m, request_key=data["request_key"]
            ).first()
            if entry:
                get_object_or_404(hr_jobs(m), pk=entry.application.job_id)
            return Response(
                {"candidate": old.id, "application": entry.application_id if entry else None}
            )
        existing = (
            ApplicationEntry.objects.select_related("application__candidate")
            .filter(organization=m.organization, request_key=data["request_key"])
            .first()
        )
        if existing:
            person = existing.application.candidate
            get_object_or_404(hr_jobs(m), pk=existing.application.job_id)
            if (
                existing.actor_id != m.id
                or existing.application.job_id != data["job"]
                or existing.source != data["source"]
                or existing.application.stage != data["stage"]
                or existing.application.expected_start_date != data["expected_start_date"]
                or any(getattr(person, field) != data[field] for field in CANDIDATE_FIELDS)
                or data["resume_document"] is not None
            ):
                raise Conflict("该保存请求已用于另一位候选人，请刷新后再试。")
            return Response({"candidate": person.id, "application": existing.application_id})

        job = open_job(m, data["job"]) if data["job"] else None
        doc = parse = None
        if data["resume_document"]:
            doc = get_object_or_404(
                ResumeDocument.objects.select_for_update(),
                pk=data["resume_document"],
                organization=m.organization,
                uploaded_by=m,
                candidate__isnull=True,
                request_key__isnull=False,
                access_state="active",
            )
            parse = doc.parses.first()
            if not parse or parse.id != data["resume_parse"]:
                raise Conflict("简历文字版本已改变，请重新核对附件。")
        if possible_matches(m, data).exists():
            raise Conflict("发现疑似重复候选人，请先从已有档案核对后加入本次应聘。")
        try:
            with transaction.atomic():
                person = Candidate.objects.create(
                    organization=m.organization,
                    created_by=m,
                    source=data["source"],
                    request_key=data["request_key"],
                    creation_payload=payload,
                    **{field: data[field] for field in CANDIDATE_FIELDS},
                )
        except IntegrityError:
            raise Conflict("这个保存请求已被使用，请重新核对后提交。") from None
        if doc:
            doc.candidate = person
            doc.save(update_fields=["candidate", "updated_at"])
            if data["resume_text"].strip() and data["resume_text"].strip() != parse.text:
                parse = create_parse(doc, m, uuid.uuid4(), manual=data["resume_text"])
            person.profile_resume_parse = parse
            person.save(update_fields=["profile_resume_parse"])
        application = None
        if job:
            application = enter_application(
                m,
                person,
                job,
                data["source"],
                data["request_key"],
                data["stage"],
                data["expected_start_date"],
            )
            if parse:
                ApplicationResume.objects.create(
                    application=application, parse=parse, assigned_by=m
                )
            audit(m, job, "人工新增候选人并建立应聘", application, note=f"候选人 {person.id}")
        return Response(
            {"candidate": person.id, "application": application.id if application else None},
            status=201,
        )

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
        Candidate.objects.select_for_update().get(pk=person.pk)
        standalone = person.created_by_id == m.id and not person.applications.exists()
        a = enter_application(m, person, job, data["source"], data["request_key"])
        if standalone:
            for doc in ResumeDocument.objects.filter(
                candidate=person, uploaded_by=m, request_key__isnull=False, access_state="active"
            ):
                parse = doc.parses.first()
                if parse:
                    ApplicationResume.objects.get_or_create(
                        application=a, parse=parse, defaults={"assigned_by": m}
                    )
        return Response({"application": a.id})


def app_data(a, m, detail=False):
    owner = member_profile(a.owner)
    result = {
        "id": a.id,
        "candidate": a.candidate_id,
        "candidate_deleted_at": a.candidate.deleted_at,
        "candidate_updated_at": a.candidate.updated_at,
        "can_restore_candidate": bool(
            a.candidate.deleted_at and candidate_data(a.candidate, m)["can_delete"]
        ),
        "name": a.candidate.display_name,
        "current_city": a.candidate.current_city,
        "education_level": a.candidate.education_level,
        "work_years": a.candidate.work_years,
        "expected_salary": a.candidate.expected_salary,
        "job": a.job_id,
        "job_title": a.job.title,
        "attempt_no": a.attempt_no,
        "stage": a.stage,
        "version": a.version,
        "profile": a.job.active_profile_id,
        "source": a.source,
        "owner_name": owner["name"],
        "owner_avatar_url": owner["avatar_url"],
        "owner_chat_url": owner["chat_url"],
        "closed_at": a.closed_at,
        "close_reason": a.close_reason,
        "ai_status": "not_connected",
    }
    if detail:
        # AI 初面复用本模块的授权查询，详情运行时引入以避免模块循环导入。
        from .ai_screening import latest_application_analysis

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
            requirements=[
                requirement_data(item) for item in a.job.active_profile.requirements.all()
            ]
            if a.job.active_profile_id
            else [],
            job_status=a.job.status,
            profile_analysis=latest_application_analysis(m, a),
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
        return (
            Application.objects.filter(
                organization=member(self.request).organization,
                job__in=hr_jobs(member(self.request)),
            )
            .select_related("candidate", "job__active_profile", "owner__user")
            .prefetch_related(
                Prefetch(
                    "owner__user__feishuidentity_set",
                    queryset=member_profiles(),
                    to_attr="recruitment_profiles",
                )
            )
        )

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
        if self.request.query_params.get("education_level"):
            qs = qs.filter(
                candidate__education_level=self.request.query_params["education_level"][:20]
            )
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
                    qs.values("job_id", "job__title").distinct().order_by("job__title", "job_id")
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
        own_standalone = (
            doc.candidate_id
            and doc.uploaded_by_id == m.id
            and standalone_download_allowed(doc.candidate, m)
        )
        if not job and not own_standalone:
            raise PermissionDenied("当前没有该简历原件的下载授权。")
        try:
            stream = file_path(doc).open("rb")
        except FileNotFoundError:
            raise ValidationError("原件暂时不可用，请联系维护人员恢复文件。") from None
        if job:
            audit(m, job, "下载简历原件", note=f"文件 {doc.id}")
        inline_types = {
            "pdf": "application/pdf",
            "txt": "text/plain; charset=utf-8",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
        }
        inline = request.query_params.get("inline") == "1" and doc.file_type in inline_types
        response = FileResponse(
            stream,
            as_attachment=not inline,
            filename=doc.original_name,
            content_type=inline_types[doc.file_type] if inline else "application/octet-stream",
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
