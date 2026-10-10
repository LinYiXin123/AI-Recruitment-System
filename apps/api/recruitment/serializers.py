from urllib.parse import urlencode

from django.conf import settings
from django.db.models import F
from rest_framework import serializers

from identity.models import FeishuIdentity

from .access import can_confirm, can_edit
from .auth import safe_avatar_url
from .feishu_departments import department_paths
from .models import AuditEvent, Job, ProfileClarification, ProfileRequirement, ProfileVersion, Task

RECRUITMENT_SITES = ("BOSS直聘", "猎聘", "智联招聘", "前程无忧", "拉勾招聘", "其他")


def unique_recruitment_sites(value):
    if len(value) != len(set(value)):
        raise serializers.ValidationError("招聘网站不能重复选择。")


def display_name(membership):
    return membership.user.get_full_name() or membership.user.username


def member_profiles():
    if not settings.FEISHU_APP_ID:
        return FeishuIdentity.objects.none()
    return (
        FeishuIdentity.objects.filter(app_id=settings.FEISHU_APP_ID)
        .only("user_id", "display_name", "avatar_url", "open_id")
        .order_by(F("last_authenticated_at").desc(nulls_last=True), "-updated_at", "-id")
    )


def member_profile(membership):
    user = membership.user
    if not hasattr(user, "recruitment_profiles"):
        user.recruitment_profiles = list(member_profiles().filter(user_id=user.id)[:1])
    identity = next(iter(user.recruitment_profiles), None)
    open_id = identity.open_id.strip() if identity else ""
    return {
        "name": (identity.display_name.strip() if identity else "") or display_name(membership),
        "avatar_url": safe_avatar_url(identity.avatar_url) if identity else "",
        "chat_url": f"https://applink.feishu.cn/client/chat/open?{urlencode({'openId': open_id})}"
        if open_id
        else "",
    }


class RequirementSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False, min_value=1)

    class Meta:
        model = ProfileRequirement
        fields = [
            "id",
            "category",
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
    department_path = serializers.SerializerMethodField()
    active_profile_number = serializers.IntegerField(source="active_profile.number", default=None)
    active_profile_detail = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    owner_avatar_url = serializers.SerializerMethodField()
    owner_chat_url = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    latest_profile = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    def get_department_path(self, obj):
        paths = self.context.setdefault("department_paths", {})
        if obj.organization_id not in paths:
            paths[obj.organization_id] = department_paths(obj.organization_id)
        return paths[obj.organization_id].get(obj.department_id, obj.department.name)

    def get_enterprise_deleted(self, obj):
        return bool(obj.enterprise_id and obj.enterprise.deleted_at)

    def get_owner_name(self, obj):
        return member_profile(obj.owner)["name"]

    def get_owner_avatar_url(self, obj):
        return member_profile(obj.owner)["avatar_url"]

    def get_owner_chat_url(self, obj):
        return member_profile(obj.owner)["chat_url"]

    def get_approver_name(self, obj):
        return display_name(obj.approver)

    def get_latest_profile(self, obj):
        profile = obj.profiles.first()
        return ProfileSerializer(profile).data if profile else None

    def get_active_profile_detail(self, obj):
        return ProfileSerializer(obj.active_profile).data if obj.active_profile else None

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
            "department_path",
            "company_name",
            "enterprise_id",
            "enterprise_name",
            "enterprise_enabled",
            "enterprise_deleted",
            "job_level",
            "salary_range",
            "recruitment_sites",
            "base_salary",
            "performance_salary",
            "commission_salary",
            "total_monthly_salary",
            "planned_publish_date",
            "location",
            "headcount",
            "owner_name",
            "owner_avatar_url",
            "owner_chat_url",
            "approver_name",
            "status",
            "jd",
            "version",
            "updated_at",
            "latest_profile",
            "active_profile",
            "active_profile_number",
            "active_profile_detail",
            "permissions",
        ]


class ProfileContentSerializer(serializers.Serializer):
    source = serializers.CharField(max_length=500)
    business_goal = serializers.CharField(max_length=5000, allow_blank=True, required=False)
    generation_id = serializers.IntegerField(min_value=1, allow_null=True, default=None)
    activate = serializers.BooleanField(default=False)
    requirements = RequirementSerializer(many=True, allow_empty=False)

    def validate_requirements(self, value):
        if len(value) > 50:
            raise serializers.ValidationError("每个版本最多保存 50 项要求。")
        return value


class NewJobProfileSerializer(ProfileContentSerializer):
    business_goal = serializers.CharField(max_length=5000, allow_blank=True, default="")
    activate = serializers.BooleanField(default=True)

    def validate(self, attrs):
        if any(item.get("id") for item in attrs["requirements"]):
            raise serializers.ValidationError("新岗位不能引用其他岗位的要求编号。")
        return attrs


class NewJobSerializer(serializers.Serializer):
    request_id = serializers.UUIDField()
    title = serializers.CharField(max_length=100)
    department = serializers.IntegerField(min_value=1)
    company_name = serializers.CharField(max_length=200, allow_blank=True, default="")
    job_level = serializers.CharField(max_length=100, allow_blank=True, default="")
    salary_range = serializers.CharField(max_length=200, allow_blank=True, default="")
    recruitment_sites = serializers.ListField(
        child=serializers.ChoiceField(choices=RECRUITMENT_SITES),
        max_length=6,
        validators=[unique_recruitment_sites],
        default=list,
    )
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
    profile = NewJobProfileSerializer(required=False)

    def validate(self, attrs):
        if "profile" in attrs and not attrs["jd"]:
            raise serializers.ValidationError({"jd": "请保留用于 AI 起草的岗位需求。"})
        return attrs


class VersionSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class RecruitmentSitesSerializer(VersionSerializer):
    recruitment_sites = serializers.ListField(
        child=serializers.ChoiceField(choices=RECRUITMENT_SITES),
        max_length=6,
        validators=[unique_recruitment_sites],
    )


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


class SaveProfileSerializer(ProfileContentSerializer, VersionSerializer):
    jd = serializers.CharField(max_length=30000)
    location = serializers.CharField(max_length=100, required=False)
    salary_range = serializers.CharField(max_length=200, allow_blank=True, required=False)


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
