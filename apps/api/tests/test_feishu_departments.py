import json
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from lark_oapi.core.exception import (
    NoAuthorizationException,
    ObtainAccessTokenException,
    UnmarshalException,
)

from recruitment.access import can_edit, department_ids
from recruitment.feishu_departments import DepartmentSyncError, department_paths, sync_departments
from recruitment.models import Department, DepartmentRole, Job, Membership, Organization

pytestmark = pytest.mark.django_db


def reply(*, items=None, roots=None, more=False, token="", code=0, department=None):
    return SimpleNamespace(
        success=lambda: code == 0,
        code=code,
        data=SimpleNamespace(
            items=items if items is not None else [],
            department_ids=roots if roots is not None else [],
            has_more=more,
            page_token=token,
            department=department,
        ),
    )


def node(key, name="研发部", parent="0"):
    return SimpleNamespace(
        open_department_id=key,
        name=name,
        parent_department_id=parent,
        leader_user_id="not-for-export",
        member_count=10,
    )


@pytest.fixture
def remote(settings, monkeypatch):
    settings.FEISHU_APP_ID = "test-directory-app"
    settings.FEISHU_APP_SECRET = "test-directory-secret"
    api = SimpleNamespace(
        scope=SimpleNamespace(list=Mock(return_value=reply(roots=["0"]))),
        department=SimpleNamespace(
            children=Mock(return_value=reply(items=[node("od-a")])),
            get=Mock(),
        ),
    )
    builder = Mock()
    for method in ("app_id", "app_secret", "timeout", "log_level"):
        getattr(builder, method).return_value = builder
    builder.build.return_value = SimpleNamespace(contact=SimpleNamespace(v3=api))
    monkeypatch.setattr("recruitment.feishu_departments.lark.Client.builder", lambda: builder)
    return api


@pytest.fixture
def org():
    return Organization.objects.create(name="虚构测试组织")


def existing_job(org):
    local = Department.objects.create(organization=org, name="旧部门")
    member = Membership.objects.create(
        organization=org, user=get_user_model().objects.create(username="directory-hr")
    )
    DepartmentRole.objects.create(membership=member, department=local, role="hr")
    job = Job.objects.create(
        organization=org,
        department=local,
        owner=member,
        approver=member,
        title="虚构职位",
        location="深圳",
        headcount=1,
    )
    return local, member, job


def test_preview_command_exports_only_directory_and_does_not_write(org, remote):
    output = StringIO()
    call_command("sync_feishu_departments", organization=org.id, stdout=output)
    result = json.loads(output.getvalue())
    assert result == {
        "applied": False,
        "organization": org.id,
        "bind_local": None,
        "department_count": 1,
        "departments": [{"open_department_id": "od-a", "name": "研发部", "parent_id": "0"}],
    }
    assert not Department.objects.exists()
    org.refresh_from_db()
    assert org.feishu_app_id == ""


@pytest.mark.parametrize(
    "error",
    [
        ObtainAccessTokenException("upstream detail", 999, "private-upstream-value"),
        UnmarshalException("expected", "private-upstream-value", "field"),
        NoAuthorizationException("private-upstream-value"),
    ],
)
def test_sdk_failures_become_safe_command_errors_without_saving(org, remote, error):
    remote.scope.list.side_effect = error
    with pytest.raises(CommandError, match="飞书部门读取失败，未保存") as caught:
        call_command("sync_feishu_departments", organization=org.id, apply=True)
    assert "private-upstream-value" not in str(caught.value)
    assert not Department.objects.exists()
    org.refresh_from_db()
    assert org.feishu_app_id == ""


def test_apply_duplicate_names_and_repeat_keeps_ids_roles_and_legacy_jobs(org, remote):
    local, member, job = existing_job(org)
    remote.department.children.return_value = reply(
        items=[
            node("od-a", "甲公司"),
            node("od-b", "乙公司"),
            node("od-a1", "研发部", "od-a"),
            node("od-b1", "研发部", "od-b"),
        ]
    )
    sync_departments(org.id, apply=True)
    imported = {d.feishu_open_department_id: d for d in Department.objects.exclude(pk=local.pk)}
    assert imported["od-a1"].parent_id == imported["od-a"].id
    assert imported["od-b1"].parent_id == imported["od-b"].id
    ids_before = {key: row.id for key, row in imported.items()}
    sync_departments(org.id, apply=True)
    assert (
        dict(Department.objects.exclude(pk=local.pk).values_list("feishu_open_department_id", "id"))
        == ids_before
    )
    assert set(department_ids(member, ["hr"])) == {local.id}
    assert DepartmentRole.objects.count() == 1
    job.refresh_from_db()
    assert job.department_id == local.id and can_edit(member, job)
    org.refresh_from_db()
    assert org.feishu_app_id == "test-directory-app"


def test_rename_move_preserves_stable_id_and_unreturned_departments(org, remote):
    remote.department.children.return_value = reply(
        items=[node("od-a", "甲"), node("od-b", "乙"), node("od-c", "研发", "od-a")]
    )
    sync_departments(org.id, apply=True)
    child = Department.objects.get(feishu_open_department_id="od-c")
    remote.department.children.return_value = reply(
        items=[node("od-b", "乙"), node("od-c", "研发中心", "od-b")]
    )
    sync_departments(org.id, apply=True)
    child.refresh_from_db()
    assert child.name == "研发中心"
    assert child.parent.feishu_open_department_id == "od-b"
    assert Department.objects.filter(feishu_open_department_id="od-a").exists()


def test_scope_and_children_pagination_collect_every_page(org, remote):
    scope_tokens, children_tokens = [], []

    def query_token(request):
        tokens = [value for key, value in request.queries if key == "page_token"]
        assert len(tokens) <= 1
        return tokens[0] if tokens else None

    def scope_page(request):
        token = query_token(request)
        scope_tokens.append(token)
        # 飞书范围页可能先返回人员，此时没有部门也必须继续。
        return {
            None: reply(roots=[], more=True, token="scope-2"),
            "scope-2": reply(roots=[], more=True, token="scope-3"),
            "scope-3": reply(roots=["0"]),
        }[token]

    def children_page(request):
        token = query_token(request)
        children_tokens.append(token)
        assert request.department_id_type == "open_department_id"
        assert request.fetch_child is True and request.page_size == 50
        return {
            None: reply(items=[node("od-a")], more=True, token="child-2"),
            "child-2": reply(items=[node("od-b", parent="od-a")], more=True, token="child-3"),
            "child-3": reply(items=[node("od-c", parent="od-b")]),
        }[token]

    remote.scope.list.side_effect = scope_page
    remote.department.children.side_effect = children_page
    sync_departments(org.id, apply=True)
    assert scope_tokens == [None, "scope-2", "scope-3"]
    assert children_tokens == [None, "child-2", "child-3"]
    assert Department.objects.count() == 3


def test_partial_scope_gets_roots_without_reading_missing_ancestor(org, remote):
    root = node("od-root", "独立授权公司", "od-hidden")
    child = node("od-child", "研发部", "od-root")
    remote.scope.list.return_value = reply(roots=["od-root", "od-child"])
    remote.department.get.side_effect = lambda request: reply(
        department={"od-root": root, "od-child": child}[request.department_id]
    )
    remote.department.children.side_effect = lambda request: reply(
        items=[child] if request.department_id == "od-root" else []
    )
    sync_departments(org.id, apply=True)
    parent = Department.objects.get(feishu_open_department_id="od-root")
    assert parent.parent_id is None
    assert Department.objects.get(feishu_open_department_id="od-child").parent_id == parent.id
    assert not Department.objects.filter(feishu_open_department_id="od-hidden").exists()
    assert {call.args[0].department_id for call in remote.department.get.call_args_list} == {
        "od-root",
        "od-child",
    }


@pytest.mark.parametrize(
    "kind",
    [
        "api_error",
        "network",
        "missing_token",
        "repeat_token",
        "missing_flag",
        "empty_page",
        "missing_items",
    ],
)
def test_incomplete_or_failed_pages_never_write_a_partial_tree(org, remote, kind):
    first = reply(items=[node("od-a")], more=True, token="next")
    if kind == "api_error":
        following = reply(code=40004)
    elif kind == "network":
        following = OSError("do not print transport details")
    elif kind == "missing_token":
        following = reply(items=[node("od-b")], more=True)
    elif kind == "repeat_token":
        following = reply(items=[node("od-b")], more=True, token="next")
    elif kind == "missing_flag":
        following = reply(items=[node("od-b")], more=None)
    elif kind == "empty_page":
        following = reply(more=True, token="third")
    else:
        following = reply()
        following.data.items = None
    remote.department.children.side_effect = [first, following]
    with pytest.raises(DepartmentSyncError):
        sync_departments(org.id, apply=True)
    assert not Department.objects.exists()
    org.refresh_from_db()
    assert org.feishu_app_id == ""


@pytest.mark.parametrize(
    "items",
    [
        [node("od-a", parent="od-b"), node("od-b", parent="od-a")],
        [node("od-a"), node("od-a", "冲突名称")],
        [node("od-a", parent="od-missing")],
        [node("od-a", name="")],
        [node("od-a", parent=None)],
    ],
)
def test_invalid_tree_is_rejected_before_database_changes(org, remote, items):
    remote.department.children.return_value = reply(items=items)
    with pytest.raises(DepartmentSyncError):
        sync_departments(org.id, apply=True)
    assert not Department.objects.exists()


@pytest.mark.parametrize("conflict", ["other_app", "other_org"])
def test_app_and_organization_binding_rejects_cross_tenant_import_before_api(org, remote, conflict):
    if conflict == "other_app":
        org.feishu_app_id = "another-app"
        org.save()
    else:
        Organization.objects.create(name="另一个组织", feishu_app_id="test-directory-app")
    with pytest.raises(DepartmentSyncError):
        sync_departments(org.id, apply=True)
    remote.scope.list.assert_not_called()
    assert not Department.objects.exists()


def test_local_name_uniqueness_remains_but_feishu_same_names_do_not_merge(org):
    Department.objects.create(organization=org, name="研发部")
    with pytest.raises(IntegrityError), transaction.atomic():
        Department.objects.create(organization=org, name="研发部")
    Department.objects.create(organization=org, name="研发部", feishu_open_department_id="od-a")
    Department.objects.create(organization=org, name="研发部", feishu_open_department_id="od-b")
    with pytest.raises(IntegrityError), transaction.atomic():
        Department.objects.create(organization=org, name="另名", feishu_open_department_id="od-a")


def test_explicit_binding_updates_existing_department_preserving_job_and_role(org, remote):
    local, member, job = existing_job(org)
    output = StringIO()
    call_command(
        "sync_feishu_departments", organization=org.id, bind_local=f"{local.id}=od-a", stdout=output
    )
    local.refresh_from_db()
    assert local.name == "旧部门" and local.feishu_open_department_id == ""
    for _ in range(2):
        call_command(
            "sync_feishu_departments",
            organization=org.id,
            apply=True,
            bind_local=f"{local.id}=od-a",
            stdout=StringIO(),
        )
    local.refresh_from_db()
    job.refresh_from_db()
    assert local.name == "研发部" and local.feishu_open_department_id == "od-a"
    assert Department.objects.count() == 1
    assert job.department_id == local.id and can_edit(member, job)
    assert set(department_ids(member, ["hr"])) == {local.id}


@pytest.mark.parametrize("conflict", ["foreign_org", "different_id", "target_exists", "absent"])
def test_explicit_binding_conflicts_leave_existing_data_untouched(org, remote, conflict):
    local = Department.objects.create(organization=org, name="旧部门")
    external_id = "od-a"
    if conflict == "foreign_org":
        local.organization = Organization.objects.create(name="其他组织")
        local.save()
    elif conflict == "different_id":
        local.feishu_open_department_id = "od-other"
        local.save()
    elif conflict == "target_exists":
        Department.objects.create(organization=org, name="已有", feishu_open_department_id="od-a")
    else:
        external_id = "od-not-returned"
    before = list(Department.objects.values())
    with pytest.raises(CommandError):
        call_command(
            "sync_feishu_departments",
            organization=org.id,
            apply=True,
            bind_local=f"{local.id}={external_id}",
            stdout=StringIO(),
        )
    assert list(Department.objects.values()) == before
    org.refresh_from_db()
    assert org.feishu_app_id == ""


def test_database_failure_rolls_back_binding_and_new_departments(org, remote, monkeypatch):
    local = Department.objects.create(organization=org, name="旧部门")
    remote.department.children.return_value = reply(items=[node("od-a"), node("od-b")])
    original_save = Department.save

    def fail_on_second_department(self, *args, **kwargs):
        if self.feishu_open_department_id == "od-b":
            raise IntegrityError("simulated database conflict")
        return original_save(self, *args, **kwargs)

    monkeypatch.setattr(Department, "save", fail_on_second_department)
    with pytest.raises(DepartmentSyncError):
        sync_departments(org.id, apply=True, bind_local=(local.id, "od-a"))
    local.refresh_from_db()
    assert local.feishu_open_department_id == "" and local.name == "旧部门"
    assert Department.objects.count() == 1


def test_paths_use_one_query_and_do_not_follow_foreign_organization(org, django_assert_num_queries):
    parent = Department.objects.create(organization=org, name="公司")
    child = Department.objects.create(organization=org, name="部门", parent=parent)
    other = Department.objects.create(
        organization=Organization.objects.create(name="其他组织"), name="不可见公司"
    )
    orphan = Department.objects.create(organization=org, name="独立根", parent=other)
    with django_assert_num_queries(1):
        assert department_paths(org.id) == {
            parent.id: "公司",
            child.id: "公司 / 部门",
            orphan.id: "独立根",
        }
