from rest_framework import serializers

from .access import can_confirm, can_edit
from .models import AuditEvent, Job, ProfileClarification, ProfileRequirement, ProfileVersion, Task


def display_name(membership):
    return membership.user.get_full_name() or membership.user.username


class RequirementSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False, min_value=1)

    class Meta:
        model = ProfileRequirement
        fields = [
            "id",
            "kind",
            "text",
            "rationale",
            "needs_verification",
            "generation_index",
            "source_kind",
            "source_quote",
            "source_reference",
            "source_edited",
        ]
        read_only_fields = ["source_kind", "source_quote", "source_reference", "source_edited"]

    def validate(self, attrs):
        if attrs["kind"] == "exclusion" and not attrs.get("rationale", "").strip():
            raise serializers.ValidationError("排除信号必须说明与岗位的关系和依据。")
        return attrs


class ProfileSerializer(serializers.ModelSerializer):
    requirements = RequirementSerializer(many=True)
    created_by_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()

    def get_submitted_by_name(self, obj):
        return display_name(obj.submitted_by) if obj.submitted_by else None

    confirmed_by_name = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        return display_name(obj.created_by)

    def get_confirmed_by_name(self, obj):
        return display_name(obj.confirmed_by) if obj.confirmed_by else None

    class Meta:
        model = ProfileVersion
        fields = [
            "id",
            "number",
            "jd_snapshot",
            "source",
            "business_goal",
            "generation",
            "status",
            "requirements",
            "created_at",
            "created_by_name",
            "submitted_by_name",
            "submitted_at",
            "confirmed_by_name",
            "confirmed_at",
            "activated_by_hr",
            "review_note",
        ]


class JobSerializer(serializers.ModelSerializer):
    enterprise_id = serializers.IntegerField(read_only=True, allow_null=True)
    enterprise_name = serializers.CharField(source="enterprise.name", default="")
    enterprise_enabled = serializers.BooleanField(source="enterprise.enabled", default=None)
    enterprise_deleted = serializers.SerializerMethodField()
    department_name = serializers.CharField(source="department.name")
    active_profile_number = serializers.IntegerField(source="active_profile.number", default=None)
    owner_name = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    latest_profile = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    def get_enterprise_deleted(self, obj):
        return bool(obj.enterprise_id and obj.enterprise.deleted_at)

    def get_owner_name(self, obj):
        return display_name(obj.owner)

    def get_approver_name(self, obj):
        return display_name(obj.approver)

    def get_latest_profile(self, obj):
        profile = obj.profiles.first()
        return ProfileSerializer(profile).data if profile else None

    def get_permissions(self, obj):
        membership = self.context["member"]
        return {"edit": can_edit(membership, obj), "confirm": can_confirm(membership, obj)}

    class Meta:
        model = Job
        fields = [
            "id",
            "title",
            "department",
            "department_name",
            "company_name",
            "enterprise_id",
            "enterprise_name",
            "enterprise_enabled",
            "enterprise_deleted",
            "job_level",
            "salary_range",
            "base_salary",
            "performance_salary",
            "commission_salary",
            "total_monthly_salary",
            "planned_publish_date",
            "location",
            "headcount",
            "owner_name",
            "approver_name",
            "status",
            "jd",
            "version",
            "updated_at",
            "latest_profile",
            "active_profile",
            "active_profile_number",
            "permissions",
        ]


class NewJobSerializer(serializers.Serializer):
    request_id = serializers.UUIDField()
    title = serializers.CharField(max_length=100)
    department = serializers.IntegerField(min_value=1)
    company_name = serializers.CharField(max_length=200, allow_blank=True, default="")
    job_level = serializers.CharField(max_length=100, allow_blank=True, default="")
    salary_range = serializers.CharField(max_length=200, allow_blank=True, default="")
    base_salary = serializers.CharField(max_length=100, allow_blank=True, default="")
    performance_salary = serializers.CharField(max_length=100, allow_blank=True, default="")
    commission_salary = serializers.CharField(max_length=100, allow_blank=True, default="")
    total_monthly_salary = serializers.CharField(max_length=200, allow_blank=True, default="")
    planned_publish_date = serializers.DateField(required=False, allow_null=True, default=None)
    location = serializers.CharField(max_length=100)
    headcount = serializers.IntegerField(min_value=1, max_value=32767)
    approver = serializers.IntegerField(min_value=1)
    status = serializers.ChoiceField(choices=Job.Status.choices, default=Job.Status.DRAFT)
    jd = serializers.CharField(max_length=30000, allow_blank=True, default="")
    collaborators = serializers.ListField(
        child=serializers.IntegerField(min_value=1), max_length=30, default=list
    )


class VersionSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class ClarificationRequestSerializer(VersionSerializer):
    profile = serializers.IntegerField(min_value=1)
    requirement = serializers.IntegerField(min_value=1)
    question = serializers.CharField(max_length=1000)
    request_key = serializers.UUIDField()


class ClarificationAnswerSerializer(VersionSerializer):
    answer = serializers.CharField(max_length=2000)


class ClarificationSerializer(serializers.ModelSerializer):
    profile_number = serializers.IntegerField(source="profile.number")
    requirement_text = serializers.CharField(source="requirement.text")
    assignee_name = serializers.SerializerMethodField()
    requester_name = serializers.SerializerMethodField()
    can_answer = serializers.SerializerMethodField()

    def get_assignee_name(self, obj):
        return display_name(obj.assignee)

    def get_requester_name(self, obj):
        return display_name(obj.requester)

    def get_can_answer(self, obj):
        m = self.context["member"]
        return (
            obj.status == "pending" and obj.assignee_id == m.pk and can_confirm(m, obj.profile.job)
        )

    class Meta:
        model = ProfileClarification
        fields = [
            "id",
            "profile",
            "profile_number",
            "requirement",
            "requirement_text",
            "question",
            "status",
            "answer",
            "answered_at",
            "created_at",
            "assignee_name",
            "requester_name",
            "can_answer",
        ]


class SaveProfileSerializer(VersionSerializer):
    jd = serializers.CharField(max_length=30000)
    source = serializers.CharField(max_length=500)
    business_goal = serializers.CharField(max_length=5000, allow_blank=True, required=False)
    generation_id = serializers.IntegerField(min_value=1, allow_null=True, default=None)
    activate = serializers.BooleanField(default=False)
    requirements = RequirementSerializer(many=True, allow_empty=False)

    def validate_requirements(self, value):
        if len(value) > 50:
            raise serializers.ValidationError("每个版本最多保存 50 项要求。")
        return value


class ReviewSerializer(VersionSerializer):
    outcome = serializers.ChoiceField(choices=["confirm", "changes_requested"])
    note = serializers.CharField(max_length=1000, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["outcome"] == "changes_requested" and not attrs["note"]:
            raise serializers.ValidationError("请说明需要补充的内容。")
        return attrs


class StatusSerializer(VersionSerializer):
    status = serializers.ChoiceField(choices=Job.Status.choices)
    reason = serializers.CharField(max_length=1000, allow_blank=True, default="")


class TaskSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display")
    job_id = serializers.SerializerMethodField()
    job_title = serializers.SerializerMethodField()
    profile_number = serializers.IntegerField(
        source="profile.number", allow_null=True, default=None
    )
    candidate_name = serializers.CharField(
        source="application.candidate.display_name", allow_null=True, default=None
    )
    assignee_name = serializers.SerializerMethodField()

    def get_job_id(self, obj):
        return obj.application.job_id if obj.application_id else obj.profile.job_id

    def get_job_title(self, obj):
        return obj.application.job.title if obj.application_id else obj.profile.job.title

    def get_assignee_name(self, obj):
        return display_name(obj.assignee)

    class Meta:
        model = Task
        fields = [
            "id",
            "job_id",
            "job_title",
            "kind",
            "kind_label",
            "profile_number",
            "application",
            "candidate_name",
            "due_at",
            "assignee_name",
            "created_at",
            "status",
        ]


class AuditSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    def get_actor_name(self, obj):
        return display_name(obj.actor)

    class Meta:
        model = AuditEvent
        fields = ["id", "action", "actor_name", "job_version", "note", "created_at"]
