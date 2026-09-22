# 招聘业务后端

已实现第一段建岗确认流程，数据使用 PostgreSQL 持久化。认证使用 Django 会话与 CSRF，权限在后端按组织成员、部门职责及职位协作关系校验。浏览器不保存业务状态副本。

## 环境和启动

Python 3.13、Django 5.2 LTS、DRF 3.16，具体补丁版本以 `uv.lock` 为准。先安装 uv，然后在本目录执行：

```sh
uv sync --locked
uv run python scripts/local_database.py
uv run --env-file .env python manage.py migrate
uv run --env-file .env python manage.py seed_local
uv run --env-file .env python manage.py runserver 127.0.0.1:8100
```

`local_database.py` 复用当前 PostgreSQL 安装，仅为本项目建立独立实例：数据目录在工作副本 `.local/postgres`，只监听 `127.0.0.1:55432`。首次运行生成随机数据库密码、Django 密钥和本地体验密码，写入权限受限且不入库的 `.env` 与 `.local/体验账号.txt`。再次执行不覆盖已有配置。需要 PostgreSQL 可执行文件；macOS 可识别 Homebrew 的 `postgresql@18`。

本轮实测使用 PostgreSQL **18.4** 独立实例。系统已有 5432 数据库未被修改。本机 Docker 客户端存在，但 Compose 和 Docker 服务不可用，因此没有把 Docker 方案说成已启动。

有可用 Docker Compose 的环境，可以复制 `.env.example` 为 `.env`、替换随机密码和密钥后，在仓库根目录运行：

```sh
docker compose --env-file apps/api/.env up -d postgres
```

本地原生实例和 Compose 方案选择一种，二者使用同一个 55432 端口。Compose 文件已提供，但本轮未运行容器验证。停止原生实例使用 `pg_ctl -D ../../.local/postgres stop`，应在本目录执行且保持对应 PostgreSQL bin 在 PATH。

## 数据与权限

`Organization → Department / Membership → DepartmentRole` 定义组织和部门职责；`Job` 明确 HR 负责人及要求确认人，`JobMember` 保存 HR 协作者。`ProfileVersion → ProfileRequirement` 保留 JD 快照、来源和逐项要求；`Task` 关联明确画像版本，分别表示确认、补充或确认后启动招聘；`AuditEvent` 保存操作者和动作。

- HR 可在已授权部门建岗，只能查看本人负责或协作的职位。
- 用人负责人和主管可查看获授权部门职位；只有该职位指定且仍有有效职责的负责人可确认要求。
- 管理员或无招聘职责账号没有自动查看全部职位的权力。当前未开放 Django 管理站。
- 职位关联的部门、负责人和协作者必须属于同一组织；前端传入的组织编号不能改变归属。
- 首版按登录账号的第一个有效组织成员身份进入，尚未提供多组织切换界面。

## 接口约定

前缀 `/api/v1/`。列表采用每页 20 条，返回 `{count, next, previous, results}`，使用 `page` 参数。时间为带时区 ISO 8601，前端统一显示北京时间。

| 路径 | 方法 | 行为 |
|---|---|---|
| `auth/csrf/` | GET | 获取安全凭证及本地环境标记 |
| `auth/login/`、`auth/logout/` | POST | 登录／退出，校验 CSRF；登录按来源及账号限制尝试次数 |
| `me/` | GET | 当前组织、姓名、职责及建岗可选部门／成员 |
| `jobs/` | GET／POST | 按授权范围分页搜索；创建职位 |
| `jobs/{id}/` | GET | 职位详情、最新画像及当前可操作权限 |
| `jobs/{id}/profiles/` | GET／POST | 读取历史；追加 JD 快照和要求版本 |
| `jobs/{id}/clarifications/` | GET／POST | 分页读取历史问答；针对当前草稿的具体要求提问，创建负责人待办 |
| `jobs/{id}/clarifications/{question_id}/answer/` | POST | 指定负责人回答，完成原待办并创建 HR 整理答复待办；不会批准画像 |
| `jobs/{id}/submit-profile/` | POST | 将最新草稿送负责人确认，创建真实待办 |
| `jobs/{id}/review-profile/` | POST | `outcome=confirm` 或 `changes_requested`，补充时 note 必填 |
| `jobs/{id}/change-status/` | POST | 开始、暂停、关闭或重新开启；暂停／关闭／重开需 reason |
| `jobs/{id}/history/` | GET | 分页读取操作记录 |
| `tasks/` | GET | 当前本人待办；`scope=waiting` 查看我负责或协作职位的等待事项 |

建岗必填 `request_id`（浏览器为一次表单生成并保留 UUID）、`title`、`department`、`location`、`headcount`、`approver`；`jd` 和 `collaborators` 可选。相同 HR、相同 request_id 的原样重试返回已创建职位；修改过内容的重试返回 409，避免重复建岗。

所有已有职位的修改动作必须传当前 `version`。保存要求另传 `jd`、`source`、`requirements` 数组，每项包含 `kind=must/preferred/exclusion`、`text`、可选 `rationale`、`needs_verification`；排除信号必须说明 rationale。一次最多 50 项。必须满足的要求仍有待核实项时，不能提交确认；其他待核实要求保留标记，不能自动用于淘汰。默认禁止确认自己编写、提交或负责的需求。

成功动作返回最新职位。错误为 `{errors: ...}`，403 表示登录或权限问题，404 表示不存在或不可见，409 表示已变化／已处理，400 表示表单或业务前置条件不满足。没有任意修改 status 的通用 PATCH，也没有删除历史的入口。

F06 澄清提问传 `version`、`profile`、`requirement`、`question`（1–1000 字）、`request_key`（UUID）。负责人沿用职位指定确认人，前端不能指定其他人扩大权限。答复传 `version`、`answer`（1–2000 字）；重复同内容返回当前结果，不同答案不覆盖已保存历史。ProfileClarification 的 requirement 对应规格 criterion；创建、答复、Task 和 AuditEvent 同事务。当前草稿仍有待回答问题时不能送审。替换草稿或关闭职位会撤回未回答问题，旧版已回答记录保留。回答不自动清除 needs_verification，HR 核对并保存新版要求后再送审。

启动或恢复招聘时重新校验 HR 负责人及要求确认人的成员状态和部门职责；先前确认不绕过当前授权。澄清相关 Task 使用 clarification 外键及 kind=clarify/clarify_followup，同一问题同类任务唯一；保存新版或提交已答清的草稿时结束整理待办。

负责人确认后，Job.active_profile 切到该版本；新草稿不替换原生效依据。确认后不自动开始招聘；HR 从首页待办决定开始。调整要求会生成新草稿并撤回过时待办；负责人要求补充时，HR 获得补充任务。关闭职位撤回全部未完成的要求相关任务。业务状态与待办在同一事务中改变。

## 验证与部署边界

```sh
uv run ruff check .
uv run ruff format --check .
uv run --env-file .env python manage.py check
uv run --env-file .env python manage.py makemigrations --check --dry-run
uv run --env-file .env pytest -q
```

pytest 使用独立 `test_recruitment`，要求本机数据库角色有建库权限；Playwright 使用独立 `recruitment_e2e`。禁止把这些开发角色和权限直接用于生产。

本轮只做本地可运行交付，未执行生产发布。生产环境至少需要独立凭据、非 DEBUG 配置、实际允许域名、HTTPS 同源反向代理、合适的应用服务、数据库备份和访问控制；开发体验账号不能用于真实资料。AI、简历文件、渠道、飞书和 Flutter 尚未接入，本工程没有模拟其成功状态。

实现依据：[Django 会话](https://docs.djangoproject.com/en/5.2/topics/http/sessions/)、[数据库约束](https://docs.djangoproject.com/en/5.2/ref/models/constraints/)、[DRF 权限](https://www.django-rest-framework.org/api-guide/permissions/)。完整产品关系以 `docs/产品设计/04–07` 详细规格为基线，已实现映射与验收边界见 [08 交付记录](../../docs/产品设计/08_第一步实施交付记录.md)。
