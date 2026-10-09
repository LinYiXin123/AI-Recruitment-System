"""只同步飞书部门目录，不修改成员、权限或职位归属。"""

import http.client

import lark_oapi as lark
from django.conf import settings
from django.db import IntegrityError, transaction
from lark_oapi.api.contact.v3 import (
    ChildrenDepartmentRequest,
    GetDepartmentRequest,
    ListScopeRequest,
)
from lark_oapi.core.exception import (
    NoAuthorizationException,
    ObtainAccessTokenException,
    UnmarshalException,
)

from .models import Department, Organization


class DepartmentSyncError(ValueError):
    pass


def _request(method, request):
    try:
        response = method(request)
    except (
        OSError,
        ValueError,
        TypeError,
        http.client.HTTPException,
        NoAuthorizationException,
        ObtainAccessTokenException,
        UnmarshalException,
    ) as exc:
        raise DepartmentSyncError("飞书部门读取失败，未保存；请稍后重试。") from exc
    if not response.success():
        # 不回显第三方错误正文，避免凭据、人员或其他非目录信息进入日志。
        raise DepartmentSyncError(f"飞书部门读取失败（错误码 {response.code}），未保存。")
    if response.data is None:
        raise DepartmentSyncError("飞书返回的部门数据不完整，未保存。")
    return response.data


def _pages(method, builder_factory):
    tokens = set()
    token = None
    while True:
        # SDK add_query 会追加而非替换；每页必须使用新请求，避免重复 page_token。
        builder = builder_factory()
        if token is not None:
            builder.page_token(token)
        data = _request(method, builder.build())
        if not isinstance(data.has_more, bool):
            raise DepartmentSyncError("飞书分页状态缺失，未保存。")
        yield data
        if not data.has_more:
            return
        token = data.page_token
        if not isinstance(token, str) or not token or token in tokens:
            raise DepartmentSyncError("飞书分页标记缺失或重复，未保存。")
        tokens.add(token)


def _identifier(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise DepartmentSyncError("飞书部门标识缺失或无效，未保存。")
    return value


def _check_cycles(parents):
    checked = set()
    for node in parents:
        path = set()
        while node in parents and node not in checked:
            if node in path:
                raise DepartmentSyncError("部门父子关系形成循环，未保存。")
            path.add(node)
            node = parents[node]
        checked.update(path)


def collect_departments(client):
    """完整收集可访问目录，仅保留名称和部门标识；不读取用户详情。"""
    scope = client.contact.v3.scope
    departments = client.contact.v3.department
    roots = set()
    for page in _pages(
        scope.list,
        lambda: ListScopeRequest.builder().department_id_type("open_department_id").page_size(100),
    ):
        for department_id in page.department_ids or []:
            roots.add(_identifier(department_id))
    if "0" in roots:
        roots = {"0"}

    records = {}

    def add(item):
        if item is None:
            raise DepartmentSyncError("飞书部门信息缺失，未保存。")
        department_id = _identifier(item.open_department_id)
        parent_id = _identifier(item.parent_department_id)
        if department_id == "0":
            raise DepartmentSyncError("飞书返回了无效的根部门记录，未保存。")
        if not isinstance(item.name, str) or not item.name.strip() or len(item.name) > 100:
            raise DepartmentSyncError("飞书部门名称缺失或过长，未保存。")
        record = {"name": item.name, "parent_id": parent_id}
        if department_id in records and records[department_id] != record:
            raise DepartmentSyncError("飞书分页内部门信息发生冲突，请重新预览后再保存。")
        records[department_id] = record
        return department_id

    for root in sorted(roots):
        if root != "0":
            data = _request(
                departments.get,
                GetDepartmentRequest.builder()
                .department_id(root)
                .department_id_type("open_department_id")
                .build(),
            )
            if add(data.department) != root:
                raise DepartmentSyncError("飞书返回的授权根部门不匹配，未保存。")
        for page in _pages(
            departments.children,
            lambda: ChildrenDepartmentRequest.builder()
            .department_id(root)
            .department_id_type("open_department_id")
            .fetch_child(True)
            .page_size(50),
        ):
            if not isinstance(page.items, list):
                raise DepartmentSyncError("飞书部门分页内容缺失，未保存。")
            if page.has_more and not page.items:
                raise DepartmentSyncError("飞书返回了不完整的空分页，未保存。")
            for item in page.items:
                add(item)

    for department_id, record in records.items():
        parent_id = record["parent_id"]
        # 授权子树的根可保留为独立根；其他缺失父节点意味着树不完整。
        if parent_id != "0" and parent_id not in records and department_id not in roots:
            raise DepartmentSyncError("飞书部门树缺少父部门，未保存。")
    _check_cycles({key: value["parent_id"] for key, value in records.items()})
    return records


def _check_binding(organization, app_id):
    if organization.feishu_app_id and organization.feishu_app_id != app_id:
        raise DepartmentSyncError("该组织已绑定其他飞书应用，拒绝混合导入。")
    if Organization.objects.exclude(pk=organization.pk).filter(feishu_app_id=app_id).exists():
        raise DepartmentSyncError("当前飞书应用已绑定其他组织，拒绝跨组织导入。")


def _local_binding(rows, records, bind_local):
    if bind_local is None:
        return None
    local_id, external_id = bind_local
    if external_id not in records:
        raise DepartmentSyncError("指定飞书部门不在本次完整目录中，不能绑定。")
    row = next((row for row in rows if row.pk == local_id), None)
    if row is None:
        raise DepartmentSyncError("指定本地部门不属于当前组织，不能绑定。")
    if row.feishu_open_department_id and row.feishu_open_department_id != external_id:
        raise DepartmentSyncError("指定本地部门已绑定不同飞书部门，不能覆盖。")
    if any(other.pk != row.pk and other.feishu_open_department_id == external_id for other in rows):
        raise DepartmentSyncError("目标飞书部门已有另一条本地记录，不能自动合并。")
    return row


def sync_departments(organization_id, *, apply=False, bind_local=None):
    app_id = settings.FEISHU_APP_ID
    if not app_id or not settings.FEISHU_APP_SECRET:
        raise DepartmentSyncError("请先在服务端配置当前飞书自建应用。")
    try:
        organization = Organization.objects.get(pk=organization_id)
    except Organization.DoesNotExist as exc:
        raise DepartmentSyncError("指定组织不存在。") from exc
    _check_binding(organization, app_id)
    client = (
        lark.Client.builder()
        .app_id(app_id)
        .app_secret(settings.FEISHU_APP_SECRET)
        .timeout(15)
        .log_level(lark.LogLevel.ERROR)
        .build()
    )
    records = collect_departments(client)
    _local_binding(list(Department.objects.filter(organization=organization)), records, bind_local)
    if apply:
        try:
            with transaction.atomic():
                organization = Organization.objects.select_for_update().get(pk=organization_id)
                _check_binding(organization, app_id)
                rows = list(Department.objects.filter(organization=organization))
                bound = _local_binding(rows, records, bind_local)
                if bound is not None and not bound.feishu_open_department_id:
                    bound.feishu_open_department_id = bind_local[1]
                    bound.save(update_fields=["feishu_open_department_id", "updated_at"])
                by_external_id = {
                    row.feishu_open_department_id: row
                    for row in rows
                    if row.feishu_open_department_id
                }
                for external_id, record in records.items():
                    if external_id not in by_external_id:
                        by_external_id[external_id] = Department.objects.create(
                            organization=organization,
                            feishu_open_department_id=external_id,
                            name=record["name"],
                        )
                parents = {row.id: row.parent_id for row in rows}
                changed = []
                for external_id, record in records.items():
                    row = by_external_id[external_id]
                    parent = by_external_id.get(record["parent_id"])
                    parent_id = parent.id if record["parent_id"] in records else None
                    parents[row.id] = parent_id
                    if row.name != record["name"] or row.parent_id != parent_id:
                        row.name, row.parent_id = record["name"], parent_id
                        changed.append(row)
                _check_cycles(parents)
                for row in changed:
                    row.save(update_fields=["name", "parent", "updated_at"])
                if not organization.feishu_app_id:
                    organization.feishu_app_id = app_id
                    organization.save(update_fields=["feishu_app_id", "updated_at"])
        except IntegrityError as exc:
            raise DepartmentSyncError("目录绑定或数据存在并发冲突，未保存；请重新预览。") from exc
    return records


def department_paths(organization_id):
    """一次读取本组织目录，批量构建路径；调用方在列表序列化前复用结果。"""
    rows = {
        row["id"]: row
        for row in Department.objects.filter(organization_id=organization_id).values(
            "id", "name", "parent_id"
        )
    }
    paths = {}
    for department_id in rows:
        pending, seen = [], set()
        node = department_id
        while node in rows and node not in paths and node not in seen:
            seen.add(node)
            pending.append(node)
            node = rows[node]["parent_id"]
        prefix = paths.get(node, "")
        for node in reversed(pending):
            prefix = f"{prefix} / {rows[node]['name']}" if prefix else rows[node]["name"]
            paths[node] = prefix
    return paths
