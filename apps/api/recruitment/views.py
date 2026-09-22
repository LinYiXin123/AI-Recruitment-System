from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from .access import can_confirm, can_edit, department_ids, member, visible_jobs
from .errors import Conflict
from .models import AuditEvent, Department, Job, JobMember, Membership, ProfileVersion, Task
from .serializers import (
    AuditSerializer,
    JobSerializer,
    NewJobSerializer,
    ProfileSerializer,
    ReviewSerializer,
    SaveProfileSerializer,
    StatusSerializer,
    TaskSerializer,
    VersionSerializer,
    display_name,
)


@api_view(["GET"])
def me(request):
    m = member(request)
    departments = Department.objects.filter(pk__in=department_ids(m, ["hr"]))
    options = []
    for d in departments:
        people = Membership.objects.filter(
            organization=m.organization, active=True, user__is_active=True
        )
        managers = (
            people.filter(roles__department=d, roles__role="manager").exclude(pk=m.pk).distinct()
        )
        collaborators = (
            people.filter(roles__department=d, roles__role="hr").exclude(pk=m.pk).distinct()
        )
        options.append(
            {
                "id": d.id,
                "name": d.name,
                "approvers": [{"id": p.id, "name": display_name(p)} for p in managers],
                "collaborators": [{"id": p.id, "name": display_name(p)} for p in collaborators],
            }
        )
    return Response(
        {
            "name": display_name(m),
            "organization": m.organization.name,
            "roles": list(m.roles.values_list("role", flat=True).distinct()),
            "departments": options,
        }
    )


def validate_input(serializer_type, data):
    serializer = serializer_type(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def record(job, actor, action_name, note=""):
    job.version += 1
    job.save()
    AuditEvent.objects.create(
        job=job, actor=actor, action=action_name, job_version=job.version, note=note
    )


class JobViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    serializer_class = JobSerializer

    def get_queryset(self):
        qs = visible_jobs(member(self.request)).select_related(
            "department", "owner__user", "approver__user"
        )
        if self.action == "list":
            if search := self.request.query_params.get("search", "").strip():
                qs = qs.filter(Q(title__icontains=search) | Q(location__icontains=search))
            if status := self.request.query_params.get("status"):
                qs = qs.filter(status=status)
        return qs.prefetch_related("profiles__requirements", "collaborators")

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "member": member(self.request)}

    def locked_job(self, data):
        # 权限范围先过滤，再按主键加锁；避免 DISTINCT 与 FOR UPDATE 不兼容。
        visible = self.get_object()
        job = Job.objects.select_for_update().get(pk=visible.pk)
        if job.version != data["version"]:
            raise Conflict()
        return job

    def editable(self, job):
        m = member(self.request)
        if not can_edit(m, job):
            raise PermissionDenied("仅当前职位的 HR 负责人或获授权协作者可修改。")
        if job.status == Job.Status.CLOSED:
            raise ValidationError("职位已关闭，请先重新开启后再调整要求。")
        return m

    @transaction.atomic
    def create(self, request):
        m = member(request)
        data = validate_input(NewJobSerializer, request.data)
        Membership.objects.select_for_update().get(pk=m.pk)
        existing = Job.objects.filter(owner=m, request_id=data["request_id"]).first()
        if existing:
            if not can_edit(m, existing):
                raise PermissionDenied("当前已无权查看或重试这个职位。")
            same = all(
                getattr(existing, key) == data[key]
                for key in ["title", "location", "headcount", "jd"]
            )
            same = (
                same
                and existing.department_id == data["department"]
                and existing.approver_id == data["approver"]
            )
            same = same and set(
                existing.collaborators.values_list("membership_id", flat=True)
            ) == set(data["collaborators"])
            if not same:
                raise Conflict("此前提交的职位已保存，请关闭表单并从职位列表查看，不要重复创建。")
            return Response(self.get_serializer(existing).data)
        d = get_object_or_404(
            Department,
            pk=data["department"],
            pk__in=department_ids(m, ["hr"]),
            organization=m.organization,
        )
        approver = Membership.objects.filter(
            pk=data["approver"],
            organization=m.organization,
            active=True,
            user__is_active=True,
            roles__department=d,
            roles__role="manager",
        ).first()
        if not approver or approver.pk == m.pk:
            raise ValidationError({"approver": "请选择本部门已获授权的用人负责人。"})
        collaborators = Membership.objects.filter(
            pk__in=data["collaborators"],
            organization=m.organization,
            active=True,
            user__is_active=True,
            roles__department=d,
            roles__role="hr",
        ).distinct()
        if collaborators.count() != len(set(data["collaborators"])):
            raise ValidationError({"collaborators": "协作者必须是本部门已获授权的 HR。"})
        job = Job.objects.create(
            organization=m.organization,
            department=d,
            owner=m,
            approver=approver,
            request_id=data["request_id"],
            **{k: data[k] for k in ["title", "location", "headcount", "jd"]},
        )
        JobMember.objects.bulk_create([JobMember(job=job, membership=p) for p in collaborators])
        AuditEvent.objects.create(job=job, actor=m, action="创建职位", job_version=job.version)
        return Response(self.get_serializer(job).data, status=201)

    @action(detail=True, methods=["get", "post"])
    def profiles(self, request, pk=None):
        if request.method == "GET":
            qs = self.get_object().profiles.all()
            page = self.paginate_queryset(qs)
            return self.get_paginated_response(ProfileSerializer(page, many=True).data)
        data = validate_input(SaveProfileSerializer, request.data)
        with transaction.atomic():
            job = self.locked_job(data)
            m = self.editable(job)
            last = job.profiles.first()
            if last and last.status == ProfileVersion.Status.PENDING:
                last.status = ProfileVersion.Status.WITHDRAWN
                last.save()
            if last:
                Task.objects.filter(profile=last, status="pending", kind="revise").update(
                    status="done", completed_at=timezone.now()
                )
                Task.objects.filter(profile=last, status="pending").update(
                    status="cancelled", completed_at=timezone.now()
                )
            profile = ProfileVersion.objects.create(
                job=job,
                number=last.number + 1 if last else 1,
                jd_snapshot=data["jd"],
                source=data["source"],
                created_by=m,
            )
            for position, requirement in enumerate(data["requirements"]):
                profile.requirements.create(position=position, **requirement)
            job.jd = data["jd"]
            record(job, m, f"保存招人要求 v{profile.number}")
            return Response(self.get_serializer(job).data, status=201)

    @action(detail=True, methods=["post"], url_path="submit-profile")
    @transaction.atomic
    def submit_profile(self, request, pk=None):
        job = self.locked_job(validate_input(VersionSerializer, request.data))
        m = self.editable(job)
        profile = job.profiles.first()
        if not profile or profile.status != ProfileVersion.Status.DRAFT:
            raise Conflict("请先保存新的招人要求草稿，再提交确认。")
        if (
            not job.approver.active
            or not job.approver.user.is_active
            or not can_confirm(job.approver, job)
        ):
            raise ValidationError("用人负责人授权已失效，请联系管理员调整后再提交。")
        if profile.requirements.filter(kind="must", needs_verification=True).exists():
            raise ValidationError("必须满足的要求仍有待核实项，请先明确后再提交确认。")
        if job.approver_id in [m.pk, profile.created_by_id]:
            raise ValidationError("需求经办人不能确认自己编写或提交的要求，请由其他负责人确认。")
        profile.status = ProfileVersion.Status.PENDING
        profile.submitted_by = m
        profile.submitted_at = timezone.now()
        profile.save()
        Task.objects.create(profile=profile, assignee=job.approver)
        record(job, m, f"提交招人要求 v{profile.number} 确认")
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"], url_path="review-profile")
    @transaction.atomic
    def review_profile(self, request, pk=None):
        data = validate_input(ReviewSerializer, request.data)
        job = self.locked_job(data)
        m = member(request)
        if not can_confirm(m, job):
            raise PermissionDenied("只有当前职位指定的用人负责人可以确认。")
        profile = job.profiles.first()
        if not profile or profile.status != ProfileVersion.Status.PENDING or job.status == "closed":
            raise Conflict("这份要求已被处理或撤回，请查看最新版本。")
        if m.pk in [job.owner_id, profile.created_by_id, profile.submitted_by_id]:
            raise PermissionDenied("不能确认自己经办的招人要求。")
        if data["outcome"] == "confirm":
            if profile.requirements.filter(kind="must", needs_verification=True).exists():
                raise ValidationError("必须满足的要求尚未明确，不能确认。")
            job.active_profile = profile
            profile.status = ProfileVersion.Status.CONFIRMED
            profile.confirmed_by = m
            profile.confirmed_at = timezone.now()
        else:
            profile.status = ProfileVersion.Status.CHANGES
        profile.review_note = data["note"]
        profile.save()
        Task.objects.filter(profile=profile, status="pending").update(
            status="done", completed_at=timezone.now()
        )
        if data["outcome"] == "changes_requested":
            Task.objects.create(profile=profile, assignee=job.owner, kind="revise")
        elif job.status in ["draft", "paused"]:
            Task.objects.create(profile=profile, assignee=job.owner, kind="start")
        record(job, m, f"{profile.get_status_display()}招人要求 v{profile.number}", data["note"])
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"], url_path="change-status")
    @transaction.atomic
    def change_status(self, request, pk=None):
        data = validate_input(StatusSerializer, request.data)
        job = self.locked_job(data)
        m = member(request)
        if not can_edit(m, job):
            raise PermissionDenied("仅当前职位的 HR 负责人或获授权协作者可调整招聘状态。")
        transitions = {
            "draft": ["open", "closed"],
            "open": ["paused", "closed"],
            "paused": ["open", "closed"],
            "closed": ["draft"],
        }
        if data["status"] not in transitions[job.status]:
            raise Conflict("职位状态已变化，请查看最新记录。")
        latest = job.profiles.first()
        if data["status"] == "open" and (not latest or latest.status != "confirmed"):
            raise ValidationError("最新招人要求经负责人确认后，才能开始或恢复招聘。")
        if (data["status"] in ["paused", "closed"] or job.status == "closed") and not data[
            "reason"
        ]:
            raise ValidationError("请填写调整原因，方便团队了解后续安排。")
        job.status = data["status"]
        if job.status == "closed":
            if latest and latest.status == "pending":
                latest.status = ProfileVersion.Status.WITHDRAWN
                latest.save()
            Task.objects.filter(profile__job=job, status="pending").update(
                status="cancelled", completed_at=timezone.now()
            )
        if job.status == "open":
            Task.objects.filter(profile__job=job, status="pending", kind="start").update(
                status="done", completed_at=timezone.now()
            )
        record(job, m, f"职位调整为{job.get_status_display()}", data["reason"])
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        page = self.paginate_queryset(self.get_object().events.select_related("actor__user"))
        return self.get_paginated_response(AuditSerializer(page, many=True).data)


class TaskViewSet(ListModelMixin, GenericViewSet):
    serializer_class = TaskSerializer

    def get_queryset(self):
        m = member(self.request)
        qs = (
            Task.objects.filter(status="pending", profile__job__in=visible_jobs(m))
            .filter(
                Q(kind="review", profile__status="pending")
                | Q(kind="revise", profile__status="changes_requested")
                | Q(
                    kind="start",
                    profile__status="confirmed",
                    profile__job__status__in=["draft", "paused"],
                )
            )
            .select_related("profile__job", "assignee__user")
        )
        if self.request.query_params.get("scope") == "waiting":
            return (
                qs.exclude(assignee=m)
                .filter(Q(profile__job__owner=m) | Q(profile__job__collaborators__membership=m))
                .distinct()
            )
        # 角色被撤销后，旧任务不可继续成为操作入口。
        return qs.filter(assignee=m).filter(
            Q(kind="review", profile__job__department_id__in=department_ids(m, ["manager"]))
            | Q(
                kind__in=["revise", "start"],
                profile__job__department_id__in=department_ids(m, ["hr"]),
            )
        )
