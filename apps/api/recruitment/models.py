import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class Timestamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Organization(Timestamped):
    name = models.CharField(max_length=100)


class Department(Timestamped):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    name = models.CharField(max_length=100)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="department_name")
        ]


class Membership(Timestamped):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "user"], name="one_membership")
        ]


class DepartmentRole(Timestamped):
    class Role(models.TextChoices):
        HR = "hr", "HR"
        MANAGER = "manager", "用人负责人"
        SUPERVISOR = "supervisor", "招聘主管"

    membership = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="roles")
    department = models.ForeignKey(Department, on_delete=models.PROTECT)
    role = models.CharField(max_length=20, choices=Role.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["membership", "department", "role"], name="one_department_role"
            )
        ]


class Job(Timestamped):
    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        OPEN = "open", "招聘中"
        PAUSED = "paused", "暂停"
        CLOSED = "closed", "关闭"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    department = models.ForeignKey(Department, on_delete=models.PROTECT)
    request_id = models.UUIDField(default=uuid.uuid4)
    title = models.CharField(max_length=100)
    location = models.CharField(max_length=100)
    headcount = models.PositiveSmallIntegerField()
    owner = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="owned_jobs")
    approver = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="approval_jobs")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    jd = models.TextField(blank=True)
    active_profile = models.ForeignKey(
        "ProfileVersion", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=Q(headcount__gte=1), name="positive_headcount"),
            models.UniqueConstraint(
                fields=["owner", "request_id"], name="one_job_creation_request"
            ),
        ]


class JobMember(Timestamped):
    job = models.ForeignKey(Job, on_delete=models.PROTECT, related_name="collaborators")
    membership = models.ForeignKey(Membership, on_delete=models.PROTECT)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["job", "membership"], name="one_collaborator")
        ]


class ProfileVersion(Timestamped):
    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        PENDING = "pending", "待确认"
        CONFIRMED = "confirmed", "已确认"
        CHANGES = "changes_requested", "需补充"
        WITHDRAWN = "withdrawn", "已被新版替代"

    job = models.ForeignKey(Job, on_delete=models.PROTECT, related_name="profiles")
    number = models.PositiveIntegerField()
    jd_snapshot = models.TextField()
    source = models.CharField(max_length=500)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="+")
    confirmed_by = models.ForeignKey(
        Membership, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    submitted_by = models.ForeignKey(
        Membership, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-number"]
        constraints = [
            models.UniqueConstraint(fields=["job", "number"], name="profile_number"),
            models.CheckConstraint(
                condition=(
                    Q(status="confirmed", confirmed_by__isnull=False, confirmed_at__isnull=False)
                    | (
                        ~Q(status="confirmed")
                        & Q(confirmed_by__isnull=True, confirmed_at__isnull=True)
                    )
                ),
                name="profile_confirmation_complete",
            ),
        ]


class ProfileRequirement(models.Model):
    class Kind(models.TextChoices):
        MUST = "must", "必须满足"
        PREFERRED = "preferred", "优先考虑"
        EXCLUSION = "exclusion", "排除信号"

    profile = models.ForeignKey(
        ProfileVersion, on_delete=models.PROTECT, related_name="requirements"
    )
    kind = models.CharField(max_length=20, choices=Kind.choices)
    text = models.CharField(max_length=1000)
    rationale = models.CharField(max_length=1000, blank=True)
    needs_verification = models.BooleanField(default=False)
    position = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(kind="exclusion") | ~Q(rationale=""), name="exclusion_has_reason"
            )
        ]


class Task(Timestamped):
    class Status(models.TextChoices):
        PENDING = "pending", "待处理"
        DONE = "done", "已处理"
        CANCELLED = "cancelled", "已撤回"

    class Kind(models.TextChoices):
        REVIEW = "review", "确认招人要求"
        REVISE = "revise", "补充招人要求"
        START = "start", "确认后开始招聘"

    profile = models.ForeignKey(ProfileVersion, on_delete=models.PROTECT)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.REVIEW)
    assignee = models.ForeignKey(Membership, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(status="pending", completed_at__isnull=True)
                | (~Q(status="pending") & Q(completed_at__isnull=False)),
                name="task_completion_time",
            ),
            models.UniqueConstraint(fields=["profile", "kind"], name="one_profile_task_kind"),
        ]


class AuditEvent(models.Model):
    job = models.ForeignKey(Job, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(Membership, on_delete=models.PROTECT)
    action = models.CharField(max_length=80)
    job_version = models.PositiveIntegerField()
    note = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class LoginRate(models.Model):
    # 使用数据库锁约束多进程登录尝试；不保存账号或 IP 明文。
    key = models.CharField(max_length=64, primary_key=True)
    started_at = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)
