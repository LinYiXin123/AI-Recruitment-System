from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from .access import can_edit, department_ids, member, visible_jobs
from .errors import Conflict
from .models import (
    Application,
    AuditEvent,
    Candidate,
    Interview,
    InterviewParticipant,
    InterviewRevision,
    Job,
    Membership,
    StageEvent,
    Task,
)
from .serializers import display_name

INTERVIEWER_ROLES = ["manager", "supervisor", "interviewer"]


def editable_jobs(m):
    return (
        visible_jobs(m)
        .filter(department_id__in=department_ids(m, ["hr"]))
        .filter(Q(owner=m) | Q(collaborators__membership=m))
        .distinct()
    )


def visible_interviews(m):
    return (
        Interview.objects.filter(organization=m.organization)
        .filter(
            Q(application__job__in=editable_jobs(m))
            | Q(current_revision__participants__membership=m)
        )
        .select_related(
            "application__candidate",
            "application__job",
            "organizer__user",
            "current_revision",
        )
        .prefetch_related("current_revision__participants__membership__user")
        .distinct()
    )


def interview_data(interview):
    revision = interview.current_revision
    return {
        "id": interview.id,
        "application": interview.application_id,
        "candidate_name": interview.application.candidate.display_name,
        "job_title": interview.application.job.title,
        "round_no": interview.round_no,
        "purpose": interview.purpose,
        "status": interview.status,
        "organizer_name": display_name(interview.organizer),
        "invitation_status": "not_sent",
        "revision": (
            {
                "id": revision.id,
                "version": revision.version,
                "starts_at": revision.starts_at,
                "ends_at": revision.ends_at,
                "timezone": revision.timezone,
                "mode": revision.mode,
                "location": revision.location,
                "meeting_url": revision.meeting_url,
                "status": revision.status,
                "participants": [
                    {
                        "id": participant.membership_id,
                        "name": display_name(participant.membership),
                        "required": participant.required,
                        "duty": participant.duty,
                    }
                    for participant in revision.participants.all()
                ],
            }
            if revision
            else None
        ),
    }


class ScheduleInput(serializers.Serializer):
    application = serializers.IntegerField(min_value=1)
    version = serializers.IntegerField(min_value=1)
    request_key = serializers.UUIDField()
    round_no = serializers.IntegerField(min_value=1, max_value=99)
    purpose = serializers.CharField(max_length=200)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    timezone = serializers.CharField(max_length=64)
    mode = serializers.ChoiceField(choices=InterviewRevision.Mode.choices)
    location = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    meeting_url = serializers.URLField(
        max_length=2000, required=False, allow_blank=True, default=""
    )
    participants = serializers.ListField(
        child=serializers.IntegerField(min_value=1), min_length=1, max_length=20
    )

    def validate(self, data):
        if data["starts_at"] >= data["ends_at"]:
            raise ValidationError("结束时间需要晚于开始时间。")
        try:
            ZoneInfo(data["timezone"])
        except ZoneInfoNotFoundError:
            raise ValidationError({"timezone": "请选择有效时区。"}) from None
        if data["mode"] == InterviewRevision.Mode.ONSITE and not data["location"].strip():
            raise ValidationError({"location": "现场面试请填写地点。"})
        if data["mode"] == InterviewRevision.Mode.VIDEO and not data["meeting_url"].strip():
            raise ValidationError({"meeting_url": "视频面试请填写有效会议链接。"})
        if len(set(data["participants"])) != len(data["participants"]):
            raise ValidationError({"participants": "同一位面试官只需选择一次。"})
        return data


def same_schedule(interview, data, member_ids, organizer):
    revision = interview.current_revision
    if not revision:
        return False
    return (
        interview.organizer_id == organizer.id
        and interview.application_id == data["application"]
        and interview.round_no == data["round_no"]
        and interview.purpose == data["purpose"]
        and revision.starts_at == data["starts_at"]
        and revision.ends_at == data["ends_at"]
        and revision.timezone == data["timezone"]
        and revision.mode == data["mode"]
        and revision.location == data["location"]
        and revision.meeting_url == data["meeting_url"]
        and set(revision.participants.values_list("membership_id", flat=True)) == set(member_ids)
    )


def time_label(value, zone_name):
    return timezone.localtime(value, ZoneInfo(zone_name)).strftime("%m月%d日 %H:%M")


class InterviewViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    def get_queryset(self):
        qs = visible_interviews(member(self.request))
        if search := self.request.query_params.get("search", "").strip():
            qs = qs.filter(
                Q(application__candidate__display_name__icontains=search)
                | Q(application__job__title__icontains=search)
            )
        if status := self.request.query_params.get("status"):
            qs = qs.filter(status=status)
        if round_no := self.request.query_params.get("round"):
            try:
                qs = qs.filter(round_no=int(round_no))
            except ValueError:
                return qs.none()
        if mode := self.request.query_params.get("mode"):
            if mode not in InterviewRevision.Mode.values:
                return qs.none()
            qs = qs.filter(current_revision__mode=mode)
        if application := self.request.query_params.get("application"):
            qs = qs.filter(application_id=application)
        return qs

    def list(self, request):
        return self.get_paginated_response(
            [interview_data(row) for row in self.paginate_queryset(self.get_queryset())]
        )

    def retrieve(self, request, pk=None):
        return Response(interview_data(self.get_object()))

    @transaction.atomic
    def create(self, request):
        data = ScheduleInput(data=request.data)
        data.is_valid(raise_exception=True)
        data = data.validated_data
        m = member(request)
        original = get_object_or_404(
            Application.objects.select_related("job", "candidate"),
            pk=data["application"],
            organization=m.organization,
        )
        if not can_edit(m, original.job):
            raise PermissionDenied("仅当前职位的 HR 负责人或获授权协作者可以安排面试。")
        a = (
            Application.objects.select_for_update()
            .select_related("job", "candidate")
            .get(pk=original.pk)
        )
        Job.objects.select_for_update().get(pk=a.job_id)
        old = (
            Interview.objects.select_related("current_revision")
            .prefetch_related("current_revision__participants")
            .filter(organization=m.organization, request_key=data["request_key"])
            .first()
        )
        if old:
            if not same_schedule(old, data, data["participants"], m):
                raise Conflict("这个排期请求已用于其他内容，请刷新后重新安排。")
            return Response(interview_data(visible_interviews(m).get(pk=old.pk)))
        if a.version != data["version"]:
            raise Conflict()
        if a.stage != "ready_to_schedule" or a.job.status != Job.Status.OPEN:
            raise Conflict("当前应聘已不在待安排状态，请重新读取后处理。")
        if not a.job.active_profile_id:
            raise Conflict("职位缺少正式招人要求，暂不能安排面试。")

        Candidate.objects.select_for_update().get(pk=a.candidate_id)
        eligible = list(
            Membership.objects.filter(
                pk__in=data["participants"],
                organization=m.organization,
                active=True,
                user__is_active=True,
                roles__department=a.job.department,
                roles__role__in=INTERVIEWER_ROLES,
            )
            .select_related("user")
            .distinct()
        )
        if {person.id for person in eligible} != set(data["participants"]):
            raise ValidationError("面试官须为本部门当前有面试职责的有效成员。")
        participants = list(
            Membership.objects.select_for_update()
            .filter(pk__in=data["participants"], active=True, user__is_active=True)
            .select_related("user")
            .order_by("pk")
        )
        if {person.id for person in participants} != set(data["participants"]):
            raise ValidationError("有面试官已停用，请刷新后重新选择。")

        slot = Q(starts_at__lt=data["ends_at"], ends_at__gt=data["starts_at"])
        active_revisions = InterviewRevision.objects.filter(
            organization=m.organization,
            status=InterviewRevision.Status.CURRENT,
        ).exclude(interview__status=Interview.Status.CANCELLED)
        candidate_conflict = (
            active_revisions.filter(interview__application__candidate_id=a.candidate_id)
            .filter(slot)
            .first()
        )
        when = time_label(data["starts_at"], data["timezone"])
        if candidate_conflict:
            raise Conflict(
                f"候选人{a.candidate.display_name}在{when}已有系统内面试安排，请选择其他时间。"
            )
        busy_participant_ids = set(
            InterviewParticipant.objects.filter(
                revision__in=active_revisions.filter(slot),
                membership_id__in=[person.id for person in participants],
            ).values_list("membership_id", flat=True)
        )
        if busy_participant_ids:
            busy_names = "、".join(
                display_name(person) for person in participants if person.id in busy_participant_ids
            )
            raise Conflict(
                f"系统内日程冲突：{busy_names}在{when}已有面试安排，请更换时间或面试官。"
            )

        try:
            with transaction.atomic():
                interview = Interview.objects.create(
                    organization=m.organization,
                    application=a,
                    organizer=m,
                    request_key=data["request_key"],
                    round_no=data["round_no"],
                    purpose=data["purpose"],
                    status=Interview.Status.PENDING_CONFIRMATION,
                )
        except IntegrityError:
            retry = (
                Interview.objects.select_related("current_revision")
                .prefetch_related("current_revision__participants")
                .filter(organization=m.organization, request_key=data["request_key"])
                .first()
            )
            if retry and same_schedule(retry, data, data["participants"], m):
                return Response(interview_data(visible_interviews(m).get(pk=retry.pk)))
            raise
        revision = InterviewRevision.objects.create(
            organization=m.organization,
            interview=interview,
            version=1,
            starts_at=data["starts_at"],
            ends_at=data["ends_at"],
            timezone=data["timezone"],
            mode=data["mode"],
            location=data["location"],
            meeting_url=data["meeting_url"],
        )
        InterviewParticipant.objects.bulk_create(
            [InterviewParticipant(revision=revision, membership=person) for person in participants]
        )
        interview.current_revision = revision
        interview.save(update_fields=["current_revision", "updated_at"])
        previous = a.stage
        a.stage = "interviewing"
        a.version += 1
        a.save(update_fields=["stage", "version", "updated_at"])
        StageEvent.objects.create(
            application=a,
            actor=m,
            from_stage=previous,
            to_stage=a.stage,
            request_key=data["request_key"],
        )
        Task.objects.filter(application=a, kind="schedule", status="pending").update(
            status="done", completed_at=timezone.now()
        )
        AuditEvent.objects.create(
            job=a.job,
            application=a,
            actor=m,
            action="安排面试",
            job_version=a.job.version,
            note=f"第 {interview.round_no} 轮，{when}，排期版本 v1",
        )
        return Response(interview_data(visible_interviews(m).get(pk=interview.pk)), status=201)
