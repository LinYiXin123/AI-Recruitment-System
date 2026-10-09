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
    feishu_app_id = models.CharField(max_length=128, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["feishu_app_id"],
                condition=~Q(feishu_app_id=""),
                name="one_organization_per_feishu_app",
            )
        ]


class Department(Timestamped):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    feishu_open_department_id = models.CharField(max_length=128, blank=True, default="")
    parent = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="children"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"],
                condition=Q(feishu_open_department_id=""),
                name="department_name",
            ),
            models.UniqueConstraint(
                fields=["organization", "feishu_open_department_id"],
                condition=~Q(feishu_open_department_id=""),
                name="one_feishu_department_per_org",
            ),
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
        INTERVIEWER = "interviewer", "面试官"
        SUPERVISOR = "supervisor", "招聘主管"
        RESUME_DOWNLOAD = "resume_download", "简历原件下载"

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
    company_name = models.CharField(max_length=200, blank=True, default="")
    enterprise = models.ForeignKey(
        "Enterprise", on_delete=models.PROTECT, null=True, blank=True, related_name="jobs"
    )
    job_level = models.CharField(max_length=100, blank=True, default="")
    salary_range = models.CharField(max_length=200, blank=True, default="")
    recruitment_sites = models.JSONField(default=list, blank=True)
    base_salary = models.CharField(max_length=100, blank=True, default="")
    performance_salary = models.CharField(max_length=100, blank=True, default="")
    commission_salary = models.CharField(max_length=100, blank=True, default="")
    total_monthly_salary = models.CharField(max_length=200, blank=True, default="")
    planned_publish_date = models.DateField(null=True, blank=True)
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
    business_goal = models.TextField(blank=True)
    generation = models.ForeignKey(
        "ProfileGeneration", on_delete=models.PROTECT, null=True, blank=True
    )
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="+")
    confirmed_by = models.ForeignKey(
        Membership, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    activated_by_hr = models.BooleanField(default=False)
    created_with_job = models.BooleanField(default=False)
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
    generation = models.ForeignKey(
        "ProfileGeneration", on_delete=models.PROTECT, null=True, blank=True
    )
    generation_index = models.PositiveSmallIntegerField(null=True, blank=True)
    source_kind = models.CharField(max_length=24, default="manual")
    source_quote = models.TextField(blank=True)
    source_reference = models.CharField(max_length=80, blank=True)
    source_edited = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(kind="exclusion") | ~Q(rationale=""), name="exclusion_has_reason"
            )
        ]


class ProfileGeneration(Timestamped):
    job = models.ForeignKey(
        Job, on_delete=models.PROTECT, related_name="profile_generations", null=True, blank=True
    )
    creator = models.ForeignKey(Membership, on_delete=models.PROTECT)
    request_key = models.UUIDField()
    job_version = models.PositiveIntegerField(null=True, blank=True)
    purpose = models.CharField(max_length=32, default="job_profile_draft")
    model = models.CharField(max_length=200)
    prompt_version = models.CharField(max_length=40)
    input_snapshot = models.JSONField()
    status = models.CharField(max_length=16, default="running")
    result = models.JSONField(default=list)
    error = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["job", "creator", "request_key"], name="one_profile_generation_request"
            ),
            models.UniqueConstraint(
                fields=["creator", "request_key"],
                condition=Q(purpose="job_profile_preview"),
                name="one_profile_preview_request",
            ),
            models.CheckConstraint(
                condition=Q(
                    job__isnull=True, job_version__isnull=True, purpose="job_profile_preview"
                )
                | Q(job__isnull=False, job_version__isnull=False, job_version__gte=1),
                name="profile_generation_job_version",
            ),
            models.CheckConstraint(
                condition=Q(status__in=["running", "succeeded", "failed", "stale"]),
                name="profile_generation_status",
            ),
        ]


class ProfileClarification(Timestamped):
    class Status(models.TextChoices):
        PENDING = "pending", "待回答"
        ANSWERED = "answered", "已回答"
        WITHDRAWN = "withdrawn", "已撤回"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    profile = models.ForeignKey(
        ProfileVersion, on_delete=models.PROTECT, related_name="clarifications"
    )
    requirement = models.ForeignKey(ProfileRequirement, on_delete=models.PROTECT)
    requester = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="+")
    assignee = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="+")
    question = models.CharField(max_length=1000)
    request_key = models.UUIDField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    answer = models.CharField(max_length=2000, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "request_key"], name="one_clarification_request"
            ),
            models.CheckConstraint(
                condition=(Q(status="answered", answered_at__isnull=False) & ~Q(answer=""))
                | (Q(status__in=["pending", "withdrawn"], answered_at__isnull=True, answer="")),
                name="clarification_answer_complete",
            ),
        ]


class Task(Timestamped):
    class Status(models.TextChoices):
        PENDING = "pending", "待处理"
        DONE = "done", "已处理"
        CANCELLED = "cancelled", "已撤回"

    class Kind(models.TextChoices):
        APPLICANT_REVIEW = "app_review", "复核应聘材料"
        NEED_INFO = "need_info", "补充应聘材料"
        SCHEDULE = "schedule", "安排面试"
        REVIEW = "review", "确认招人要求"
        REVISE = "revise", "补充招人要求"
        START = "start", "确认后开始招聘"
        CLARIFY = "clarify", "回答招人要求问题"
        CLARIFICATION_FOLLOWUP = "clarify_followup", "整理澄清答复"

    application = models.ForeignKey("Application", on_delete=models.PROTECT, null=True)
    due_at = models.DateTimeField(null=True)
    profile = models.ForeignKey(ProfileVersion, on_delete=models.PROTECT, null=True)
    clarification = models.ForeignKey(
        ProfileClarification, on_delete=models.PROTECT, null=True, blank=True
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.REVIEW)
    assignee = models.ForeignKey(Membership, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["assignee", "status", "due_at"], name="task_work_queue")]
        constraints = [
            models.CheckConstraint(
                condition=~Q(kind="need_info") | Q(due_at__isnull=False),
                name="followup_has_deadline",
            ),
            models.CheckConstraint(
                condition=Q(status="pending", completed_at__isnull=True)
                | (~Q(status="pending") & Q(completed_at__isnull=False)),
                name="task_completion_time",
            ),
            models.UniqueConstraint(
                fields=["profile", "kind"],
                condition=Q(clarification__isnull=True),
                name="one_profile_task_kind",
            ),
            models.UniqueConstraint(
                fields=["clarification", "kind"],
                condition=Q(clarification__isnull=False),
                name="one_clarification_task_kind",
            ),
            models.CheckConstraint(
                condition=(
                    Q(profile__isnull=False, application__isnull=True)
                    & (
                        Q(kind__in=["clarify", "clarify_followup"], clarification__isnull=False)
                        | Q(kind__in=["review", "revise", "start"], clarification__isnull=True)
                    )
                )
                | Q(
                    profile__isnull=True,
                    application__isnull=False,
                    clarification__isnull=True,
                    kind__in=["app_review", "need_info", "schedule"],
                ),
                name="task_has_expected_source",
            ),
            models.UniqueConstraint(
                fields=["application", "kind"],
                condition=Q(status="pending", application__isnull=False),
                name="one_pending_application_task",
            ),
        ]


class AuditEvent(models.Model):
    application = models.ForeignKey("Application", on_delete=models.PROTECT, null=True)
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


class Candidate(Timestamped):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    display_name = models.CharField(max_length=100, db_index=True)
    phone = models.CharField(max_length=32, blank=True, db_index=True)
    email = models.EmailField(blank=True, db_index=True)
    contact_note = models.CharField(max_length=500, blank=True)
    gender = models.CharField(max_length=2, blank=True)
    current_city = models.CharField(max_length=120, blank=True)
    identity_number = models.CharField(max_length=18, blank=True)
    birthday = models.CharField(max_length=10, blank=True)
    intended_role = models.CharField(max_length=200, blank=True)
    education_level = models.CharField(max_length=20, blank=True)
    school = models.CharField(max_length=200, blank=True)
    work_years = models.CharField(max_length=100, blank=True)
    current_salary = models.CharField(max_length=100, blank=True)
    expected_salary = models.CharField(max_length=100, blank=True)
    work_experience = models.TextField(blank=True)
    education_experience = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    resume_text = models.TextField(blank=True)
    source = models.CharField(max_length=200, blank=True)
    request_key = models.UUIDField(null=True, blank=True)
    creation_payload = models.JSONField(default=dict, blank=True)
    profile_resume_parse = models.ForeignKey(
        "ResumeParse", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    created_by = models.ForeignKey(Membership, on_delete=models.PROTECT)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        Membership,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="deleted_candidates",
    )

    class Meta:
        indexes = [models.Index(fields=["organization", "display_name"], name="candidate_org_name")]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "request_key"], name="candidate_creation_request"
            )
        ]


class CandidateEditRequest(models.Model):
    candidate = models.ForeignKey(Candidate, on_delete=models.PROTECT)
    actor = models.ForeignKey(Membership, on_delete=models.PROTECT)
    request_key = models.UUIDField()
    input_digest = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["candidate", "actor", "request_key"], name="one_candidate_edit_request"
            )
        ]


class Application(Timestamped):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    candidate = models.ForeignKey(Candidate, on_delete=models.PROTECT, related_name="applications")
    job = models.ForeignKey(Job, on_delete=models.PROTECT)
    owner = models.ForeignKey(Membership, on_delete=models.PROTECT)
    attempt_no = models.PositiveIntegerField()
    source = models.CharField(max_length=200)
    stage = models.CharField(max_length=24, default="pending_review")
    expected_start_date = models.DateField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    closed_at = models.DateTimeField(null=True)
    close_reason = models.CharField(max_length=2000, blank=True)

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["organization", "stage", "job"], name="application_work_queue")
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["candidate", "job", "attempt_no"], name="application_attempt"
            ),
            models.UniqueConstraint(
                fields=["candidate", "job"],
                condition=Q(closed_at__isnull=True),
                name="one_active_application",
            ),
            models.CheckConstraint(condition=Q(attempt_no__gte=1), name="positive_attempt"),
            models.CheckConstraint(
                condition=(Q(stage="closed", closed_at__isnull=False) & ~Q(close_reason=""))
                | Q(
                    stage__in=[
                        "pending_review",
                        "needs_information",
                        "ready_to_schedule",
                        "interviewing",
                        "first_interview_passed",
                        "second_interview",
                        "second_interview_passed",
                        "offer_sent",
                        "hired",
                        "talent_pool",
                    ],
                    closed_at__isnull=True,
                    close_reason="",
                ),
                name="application_closure",
            ),
        ]


class Interview(Timestamped):
    class Status(models.TextChoices):
        UNSCHEDULED = "unscheduled", "未排期"
        PENDING_CONFIRMATION = "pending_confirmation", "待确认"
        CONFIRMED = "confirmed", "已确认"
        COMPLETED = "completed", "已完成"
        CANCELLED = "cancelled", "已取消"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    application = models.ForeignKey(
        Application, on_delete=models.PROTECT, related_name="interviews"
    )
    round_no = models.PositiveSmallIntegerField()
    purpose = models.CharField(max_length=200)
    request_key = models.UUIDField()
    current_revision = models.ForeignKey(
        "InterviewRevision", on_delete=models.PROTECT, null=True, related_name="+"
    )
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.UNSCHEDULED)
    organizer = models.ForeignKey(
        Membership, on_delete=models.PROTECT, related_name="organized_interviews"
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.CharField(max_length=1000, blank=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["organization", "status"], name="interview_org_status")]
        constraints = [
            models.CheckConstraint(condition=Q(round_no__gte=1), name="positive_interview_round"),
            models.UniqueConstraint(
                fields=["organization", "request_key"], name="one_interview_schedule_request"
            ),
        ]


class InterviewRevision(Timestamped):
    class Status(models.TextChoices):
        CURRENT = "current", "当前"
        SUPERSEDED = "superseded", "已替代"
        CANCELLED = "cancelled", "已取消"

    class Mode(models.TextChoices):
        ONSITE = "onsite", "现场"
        VIDEO = "video", "视频"
        PHONE = "phone", "电话"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    interview = models.ForeignKey(Interview, on_delete=models.PROTECT, related_name="revisions")
    version = models.PositiveSmallIntegerField()
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    timezone = models.CharField(max_length=64)
    mode = models.CharField(max_length=16, choices=Mode.choices)
    location = models.TextField(blank=True)
    meeting_url = models.URLField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.CURRENT)
    change_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-version"]
        indexes = [
            models.Index(
                fields=["organization", "starts_at", "ends_at"], name="interview_slot_index"
            )
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["interview", "version"], name="interview_revision_version"
            ),
            models.UniqueConstraint(
                fields=["interview"],
                condition=Q(status="current"),
                name="one_current_interview_revision",
            ),
            models.CheckConstraint(
                condition=Q(starts_at__lt=models.F("ends_at")), name="interview_time_order"
            ),
            models.CheckConstraint(
                condition=(
                    Q(mode="onsite") & ~Q(location="")
                    | Q(mode="video") & ~Q(meeting_url="")
                    | Q(mode="phone")
                ),
                name="interview_mode_details",
            ),
        ]


class InterviewParticipant(models.Model):
    revision = models.ForeignKey(
        InterviewRevision, on_delete=models.PROTECT, related_name="participants"
    )
    membership = models.ForeignKey(Membership, on_delete=models.PROTECT)
    required = models.BooleanField(default=True)
    duty = models.CharField(max_length=32, default="interviewer")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["revision", "membership"], name="one_interview_participant"
            )
        ]


class ApplicationEntry(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    request_key = models.UUIDField()
    actor = models.ForeignKey(Membership, on_delete=models.PROTECT)
    application = models.ForeignKey(Application, on_delete=models.PROTECT)
    source = models.CharField(max_length=200)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "request_key"], name="one_entry_request"
            )
        ]


class ImportBatch(Timestamped):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    job = models.ForeignKey(Job, on_delete=models.PROTECT)
    actor = models.ForeignKey(Membership, on_delete=models.PROTECT)
    source = models.CharField(max_length=200)
    request_key = models.UUIDField()
    total = models.PositiveSmallIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "request_key"], name="one_import_request"
            ),
            models.CheckConstraint(condition=Q(total__gte=1, total__lte=20), name="batch_size"),
        ]


class ResumeDocument(Timestamped):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    candidate = models.ForeignKey(Candidate, on_delete=models.PROTECT, null=True)
    file_key = models.UUIDField(default=uuid.uuid4, unique=True)
    original_name = models.CharField(max_length=255)
    file_type = models.CharField(max_length=10)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    uploaded_by = models.ForeignKey(Membership, on_delete=models.PROTECT)
    request_key = models.UUIDField(null=True, blank=True)
    access_state = models.CharField(max_length=20, default="active")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["uploaded_by", "request_key"], name="resume_preview_request"
            ),
            models.CheckConstraint(
                condition=Q(size__gt=0, size__lte=20 * 1024 * 1024), name="resume_file_size"
            ),
            models.CheckConstraint(
                condition=Q(
                    file_type__in=["pdf", "docx", "txt", "doc", "jpg", "jpeg", "png"],
                    access_state__in=["active", "quarantine", "deleted"],
                ),
                name="resume_file_state",
            ),
        ]


class ResumeParse(Timestamped):
    document = models.ForeignKey(ResumeDocument, on_delete=models.PROTECT, related_name="parses")
    version = models.PositiveIntegerField()
    parser_version = models.CharField(max_length=100)
    status = models.CharField(max_length=20)
    text = models.TextField(blank=True)
    error = models.CharField(max_length=500, blank=True)
    actor = models.ForeignKey(Membership, on_delete=models.PROTECT)
    request_key = models.UUIDField()

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.CheckConstraint(condition=Q(version__gte=1), name="positive_parse_version"),
            models.CheckConstraint(
                condition=(Q(status="succeeded", error="") & ~Q(text=""))
                | (Q(status="failed", text="") & ~Q(error="")),
                name="parse_has_result",
            ),
            models.UniqueConstraint(fields=["document", "version"], name="parse_version"),
            models.UniqueConstraint(fields=["document", "request_key"], name="parse_request"),
        ]


class ImportItem(Timestamped):
    batch = models.ForeignKey(ImportBatch, on_delete=models.PROTECT, related_name="items")
    request_key = models.UUIDField()
    document = models.OneToOneField(ResumeDocument, on_delete=models.PROTECT)
    application = models.ForeignKey(Application, on_delete=models.PROTECT, null=True)
    identity_note = models.CharField(max_length=1000, blank=True)
    identity_payload = models.JSONField(default=dict)
    confirmed_by = models.ForeignKey(Membership, on_delete=models.PROTECT, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["batch", "request_key"], name="one_import_item")
        ]


class ApplicationResume(models.Model):
    application = models.ForeignKey(Application, on_delete=models.PROTECT, related_name="resumes")
    parse = models.ForeignKey(ResumeParse, on_delete=models.PROTECT)
    assigned_by = models.ForeignKey(Membership, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["application", "parse"], name="application_resume_input"
            )
        ]


class ReviewDecision(models.Model):
    application = models.ForeignKey(Application, on_delete=models.PROTECT, related_name="reviews")
    reviewer = models.ForeignKey(Membership, on_delete=models.PROTECT)
    request_key = models.UUIDField()
    action = models.CharField(max_length=20)
    reason = models.CharField(max_length=2000)
    followup_owner = models.ForeignKey(
        Membership, on_delete=models.PROTECT, null=True, related_name="+"
    )
    due_at = models.DateTimeField(null=True)
    previous_stage = models.CharField(max_length=24)
    result_stage = models.CharField(max_length=24)
    profile = models.ForeignKey(ProfileVersion, on_delete=models.PROTECT, null=True)
    input_parses = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(action="need_info", followup_owner__isnull=False, due_at__isnull=False)
                | Q(
                    action__in=["advance", "reject", "supplement", "withdraw"],
                    followup_owner__isnull=True,
                    due_at__isnull=True,
                ),
                name="review_followup_complete",
            ),
            models.UniqueConstraint(
                fields=["application", "request_key"], name="one_review_request"
            ),
        ]


class StageEvent(models.Model):
    application = models.ForeignKey(
        Application, on_delete=models.PROTECT, related_name="stage_events"
    )
    actor = models.ForeignKey(Membership, on_delete=models.PROTECT)
    from_stage = models.CharField(max_length=24, blank=True)
    to_stage = models.CharField(max_length=24)
    request_key = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["application", "request_key"], name="one_stage_event")
        ]


class Enterprise(Timestamped):
    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name="enterprises"
    )
    name = models.CharField(max_length=100)
    industry = models.CharField(max_length=100, blank=True)
    introduction = models.TextField(blank=True)
    remark = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["sort_order", "name", "id"]


class EnterpriseEndorsement(Timestamped):
    class Category(models.TextChoices):
        COMPANY_INTRODUCTION = "company_introduction", "公司简介"
        CULTURE = "culture", "企业文化"
        BENEFITS = "benefits", "福利待遇"
        TEAM = "team", "团队介绍"
        OFFICE = "office", "办公环境"
        HISTORY = "history", "发展历程"
        RECRUITING = "recruiting", "招聘宣传"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    enterprise = models.ForeignKey(
        Enterprise, on_delete=models.PROTECT, null=True, blank=True, related_name="endorsements"
    )
    category = models.CharField(max_length=32, choices=Category.choices)
    title = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["sort_order", "id"]


class EnterpriseIssue(Timestamped):
    class Status(models.TextChoices):
        PENDING = "pending", "待核实"
        ANSWERED = "answered", "待反馈"
        CLOSED = "closed", "已完成"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    enterprise = models.ForeignKey(Enterprise, on_delete=models.PROTECT, related_name="issues")
    requester = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="+")
    assignee = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="+")
    request_key = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    category = models.CharField(max_length=32, choices=EnterpriseEndorsement.Category.choices)
    question = models.TextField(max_length=2000)
    source_reference = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    answer = models.TextField(max_length=4000, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    follow_up_note = models.TextField(max_length=2000, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    endorsement = models.ForeignKey(
        EnterpriseEndorsement, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    endorsement_snapshot = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "requester", "request_key"],
                name="one_enterprise_issue_request",
            ),
            models.CheckConstraint(condition=Q(version__gte=1), name="positive_issue_version"),
            models.CheckConstraint(
                condition=Q(status__in=["pending", "answered", "closed"]),
                name="valid_enterprise_issue_status",
            ),
        ]


class QuestionTemplate(Timestamped):
    class Dimension(models.TextChoices):
        PROFESSIONAL = "专业能力", "专业能力"
        COMMUNICATION = "沟通表达", "沟通表达"
        LOGIC = "逻辑思维", "逻辑思维"
        TEAMWORK = "团队协作", "团队协作"
        PRESSURE = "抗压能力", "抗压能力"
        STABILITY = "稳定性", "稳定性"
        JOB_FIT = "岗位匹配度", "岗位匹配度"
        LEARNING = "学习能力", "学习能力"

    class Difficulty(models.TextChoices):
        EASY = "简单", "简单"
        MEDIUM = "中等", "中等"
        HARD = "困难", "困难"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    request_key = models.UUIDField()
    content = models.TextField(max_length=10000)
    job_title = models.CharField(max_length=120, blank=True)
    dimension = models.CharField(max_length=20, choices=Dimension.choices, blank=True)
    difficulty = models.CharField(
        max_length=10, choices=Difficulty.choices, default=Difficulty.MEDIUM
    )
    reference_answer = models.TextField(max_length=10000, blank=True)
    version = models.PositiveIntegerField(default=1)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [models.Index(fields=["organization", "deleted_at"], name="question_org_active")]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "request_key"], name="one_question_creation_request"
            ),
            models.CheckConstraint(condition=Q(version__gte=1), name="positive_question_version"),
        ]


class QuestionTemplateEvent(models.Model):
    question = models.ForeignKey(QuestionTemplate, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(Membership, on_delete=models.PROTECT)
    action = models.CharField(max_length=20)
    version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class AIScreening(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    creator = models.ForeignKey(Membership, on_delete=models.PROTECT)
    application = models.ForeignKey(Application, on_delete=models.PROTECT, null=True, blank=True)
    job = models.ForeignKey(Job, on_delete=models.PROTECT, null=True, blank=True)
    enterprise = models.ForeignKey(Enterprise, on_delete=models.PROTECT, null=True, blank=True)
    candidate_name = models.CharField(max_length=120, blank=True)
    job_title = models.CharField(max_length=120, blank=True)
    enterprise_name = models.CharField(max_length=100, blank=True)
    enterprise_snapshot = models.JSONField(null=True, blank=True)
    request_key = models.UUIDField()
    input_digest = models.CharField(max_length=64)
    source_context = models.JSONField(null=True, blank=True)
    profile = models.ForeignKey(ProfileVersion, on_delete=models.PROTECT, null=True, blank=True)
    resume_parse = models.ForeignKey(ResumeParse, on_delete=models.PROTECT, null=True, blank=True)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(
                fields=["organization", "creator", "deleted_at"], name="ai_screening_owner"
            )
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "creator", "request_key"], name="one_ai_screening_request"
            )
        ]


class AIScreeningVerification(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "待核实"
        SUPPORTED = "supported", "有证据支持"
        CONTRADICTED = "contradicted", "存在矛盾"
        UNRESOLVED = "unresolved", "仍待补充"
        WITHDRAWN = "withdrawn", "已撤回采用"

    screening = models.ForeignKey(
        AIScreening, on_delete=models.PROTECT, related_name="verifications"
    )
    question_index = models.PositiveSmallIntegerField()
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices)
    answer = models.TextField(max_length=5000, blank=True)
    evidence = models.TextField(max_length=3000, blank=True)
    next_step = models.CharField(max_length=1000, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    due_on = models.DateField(null=True, blank=True)
    recorder = models.ForeignKey(Membership, on_delete=models.PROTECT)
    recorder_name = models.CharField(max_length=120)
    request_key = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["question_index", "-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["screening", "question_index", "version"],
                name="screening_question_revision",
            ),
            models.UniqueConstraint(
                fields=["screening", "request_key"], name="screening_verification_request"
            ),
            models.CheckConstraint(
                condition=Q(version__gte=1, question_index__lt=5),
                name="screening_verification_index",
            ),
            models.CheckConstraint(
                condition=Q(
                    status__in=["pending", "supported", "contradicted", "unresolved", "withdrawn"]
                ),
                name="screening_verification_status",
            ),
        ]
