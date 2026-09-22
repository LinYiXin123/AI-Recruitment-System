from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from .models import DepartmentRole, Job, Membership


def member(request):
    membership = Membership.objects.filter(
        user=request.user, active=True, pk=request.session.get("membership_id")
    ).first()
    if not membership:
        raise PermissionDenied("当前账号没有有效的组织成员身份，请重新登录或联系管理员。")
    return membership


def department_ids(membership, roles):
    return DepartmentRole.objects.filter(
        membership=membership, role__in=roles, department__organization=membership.organization
    ).values_list("department_id", flat=True)


def visible_jobs(membership):
    return (
        Job.objects.filter(organization=membership.organization)
        .filter(
            (
                Q(department_id__in=department_ids(membership, ["hr"]))
                & (Q(owner=membership) | Q(collaborators__membership=membership))
            )
            | Q(department_id__in=department_ids(membership, ["manager", "supervisor"]))
        )
        .distinct()
    )


def can_edit(membership, job):
    return (
        job.owner_id == membership.id or job.collaborators.filter(membership=membership).exists()
    ) and (job.department_id in department_ids(membership, ["hr"]))


def can_confirm(membership, job):
    return (
        job.approver_id == membership.id
        and job.owner_id != membership.id
        and (job.department_id in department_ids(membership, ["manager"]))
    )
