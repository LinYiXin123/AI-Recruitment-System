# 招聘业务后端

已实现 D01 建岗确认、D02 受控进人与人工复核，以及 D03 的系统内面试排期核心。数据使用 PostgreSQL 持久化。认证使用 Django 会话与 CSRF，权限在后端按组织成员、部门职责及职位协作关系校验。浏览器不保存业务状态副本。

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

## 飞书网页登录与退出

公共首页统一发起 `GET /api/v1/auth/login/` 飞书授权，成功后进入 `FEISHU_LOGIN_SUCCESS_URL`。应用凭据只放在服务端 `.env`。`PUBLIC_HOME_URL` 控制未登录访问工作台及退出后的首页地址，本地默认 `http://localhost:5173/`；部署时必须设置为正式公共首页，不能指向工作台本身。

每次成功飞书登录更新已绑定身份的姓名和 HTTPS 头像地址，`me/` 只返回本次登录身份的展示信息，不返回飞书标识、邮箱或令牌。招聘角色仍取自已有组织成员授权；头像缺失不阻断登录。本地密码测试会话不冒用飞书身份，旧会话重新飞书登录后可显示头像。

退出仍使用带 CSRF 校验的 POST，服务端清除会话后返回固定配置的 `redirect_url`，不接受客户端传入跳转地址。账号密码网页已移除；原 POST 登录接口保留用于受控开发测试。

## 飞书机器人本地联调

在飞书开放平台的“事件配置”启用“长连接接收事件”并订阅 `im.message.receive_v1`；再切到“回调配置”，同样使用长连接并添加“卡片回传交互” `card.action.trigger`。开通 `im:message` 和 `im:message:send_as_bot` 权限后，创建并发布新版本。本机 `.env` 还需要配置不入库的 `LLM_API_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。保持数据库服务可用，再另开一个终端运行：

```sh
uv run --env-file .env python manage.py run_feishu_bot
```

该命令只处理用户发来的私聊文字：先显示“正在思考并生成答案”的卡片，再原地更新为模型回答；卡片支持点赞、点踩与重新生成。模型可自然使用少量 Emoji。反馈和可重新生成的提问仅暂存在当前本地进程，重启后旧卡片会提示重新提问；不读取候选人、简历或招聘待办。模型暂时不能执行招聘操作，也不会因飞书消息直接获得业务数据权限；正式招聘问答接入后仍须按成员权限查询后端数据。

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
| `auth/csrf/` | GET | 获取安全凭证、本地环境标记及公共首页地址 |
| `auth/login/` | GET | 发起飞书登录并处理授权回调 |
| `auth/login/`、`auth/logout/` | POST | 登录／退出，校验 CSRF；登录按来源及账号限制尝试次数 |
| `me/` | GET | 当前组织、姓名、头像、登录来源、职责及建岗可选部门／成员 |
| `dashboard/` | GET | 按当前账号授权范围返回招聘总览、近 14 天简历、阶段分布和今日面试；未接通的 Offer／入职指标返回 `null` 及能力标记 |
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
| `interviews/` | GET／POST | 读取本人可见的场次；为“待安排面试”的应聘保存首个排期 |

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

本轮只做本地可运行交付，未执行生产发布。生产环境至少需要独立凭据、非 DEBUG 配置、实际允许域名、HTTPS 同源反向代理、合适的应用服务、数据库备份和访问控制；开发体验账号不能用于真实资料。飞书私聊模型问答已完成本地联调；渠道、Flutter 与招聘业务数据问答尚未接入。受控简历文件与本地文字提取已在 D02 增量实现，本工程没有模拟其成功状态。

实现依据：[Django 会话](https://docs.djangoproject.com/en/5.2/topics/http/sessions/)、[数据库约束](https://docs.djangoproject.com/en/5.2/ref/models/constraints/)、[DRF 权限](https://www.django-rest-framework.org/api-guide/permissions/)。完整产品关系以 `docs/产品设计/04–07` 详细规格为基线，已实现映射与验收边界见 [08 交付记录](../../docs/产品设计/08_第一步实施交付记录.md)。

## D02 受控导入与人工处理

业务契约见 [09](../../docs/产品设计/09_D02进人与复核实施契约.md)，已验证范围见 [08 最新 D02 记录](../../docs/产品设计/08_第一步实施交付记录.md)。当前调用者须有目标职位 HR 操作权；用人负责人、配置管理员不因原有角色获得候选人材料权限。

| 路径（同上前缀） | 方法与输入 | 结果 |
|---|---|---|
| `imports/` | GET 分页；POST `request_key,job,source,total(1–20)` | 目标职位必须招聘中且有正式画像；请求原样重试返回同批次 |
| `imports/{id}/` | GET | 实际接收／核对数量及逐份状态、当前文字版本 |
| `imports/{id}/upload/` | POST multipart `request_key,file`，单份不超过 20MB | 文件魔数、后缀及大小验证；成功接收与文字提取成功分开。重复请求比较 SHA256，不重存文件 |
| `imports/{id}/items/{item}/parse/` | POST `request_key`；人工摘录另传 `text`（1–100000 字） | 追加不可覆盖的解析版本。已关联应聘后须另行导入补充材料 |
| `imports/{id}/items/{item}/matches/` | POST `display_name,phone?,email?,contact_note?` | 在 HR 当前可读范围返回前 20 条疑似主档和总数。同名、同联系方式不自动合并 |
| `imports/{id}/items/{item}/confirm/` | POST 同上，另必传当前 `parse` ID，可传 `candidate` 选用既有主档、`identity_note` 解释核对；联系方式缺失须说明 | 建／选主档，复用进行中应聘或新建次数，固定本次材料版本；同一导入项只能确认一次 |
| `candidates/`、`candidates/{id}/` | GET，列表 `search,page`；POST `request_key,display_name,phone?,email?,contact_note?,job,source` | 列表仅含已获授权职位关联的人；新增会同时建立候选人主档与本次应聘。发现同名或同联系方式时要求先核对既有档案，不自动合并 |
| `candidates/{id}/apply/` | POST `request_key,job,source` | 返回已有进行中应聘或新次数；原请求重试始终指向原应聘。不会自动共享其他职位简历 |
| `applications/`、`applications/{id}/` | GET，列表 `search,stage,job,source,owner,page` | 本次阶段、版本；详情含材料、要求、人工历史和有效接手 HR |
| `applications/filter-options/` | GET | 仅返回当前 HR 已获授权应聘记录中可用的职位、来源与接手 HR 筛选项 |
| `applications/{id}/review/` | POST `version,profile,request_key,action,reason` | `profile` 为读取时的正式画像 ID，与应聘版本共同检查冲突 |
| `documents/{id}/download/` | GET | 对象 HR 权限 + 本部门独立 `resume_download` 能力；active 文件才可附件下载；保存下载审计 |

人工 `action=advance/need_info/reject/supplement/withdraw` 分别表示通过／补充／不通过／补齐交回复核／撤回或招聘取消。`need_info` 必填本岗有效 `followup_owner` 和未来带时区 `due_at`，其他动作不能夹带它们。理由必填；通过仅生成待安排任务。`supplement` 只接受待补充阶段，`withdraw` 可结束当前三个未终结阶段，暂停时亦可处理撤回；其余处理需职位招聘中。没有任意勾掉来源任务或修改阶段的接口。

私有原件默认位于项目 `.local/resumes`，可用 `PRIVATE_RESUME_ROOT` 指定持久私有目录；不配置静态媒体路由、不把路径返回前端。文件使用随机键和 0600 权限，目录 0700；数据库与文件必须一起备份。存储和事务不能跨系统原子提交：普通异常会删除未提交文件，进程突然终止可能留下未关联文件，需维护时核对清理，不能对已关联资料擅自删除。原件下载权限由维护者配置 DepartmentRole，迁移不会向所有 HR 默认发放。

解析只提取实际文字：[pypdf 官方说明](https://pypdf.readthedocs.io/en/6.18.1/user/extract-text.html) 明确区分文字提取与扫描图片识别，并说明复杂 PDF 可能大量消耗内存。因此以隔离子进程运行，CPU／时间／页数／文字量限额，Linux 有地址空间限额；macOS 本地环境没有同等内存强限额。生产文件安全扫描、解析容器隔离、队列吞吐及资料保留策略仍需单独验收；当前同步处理每份最多等待 15 秒，不声称后台任务队列已接通。

## D03 系统内排期核心

这是 F15 的首个可用切片，而不是 F15–F20 的完整交付。获授权 HR 在应聘详情填写轮次、目标、带时区的起止时间、方式、地点或视频链接，并至少选择一名本部门当前有效的面试官。`POST interviews/` 传 `application, version, request_key, round_no, purpose, starts_at, ends_at, timezone, mode, location, meeting_url, participants`；原样重试返回原场次，改动过内容的同一请求键返回 409。

服务端在同一事务中锁定应聘、职位、候选人和按编号排序的面试官，使用 `[start,end)` 检查候选人与任一参与人的系统内重叠场次；跨职位同一候选人同样拦截。成功后创建 `Interview`、首个 `InterviewRevision` 和参与人，完成原“待安排”任务，将应聘推进为“面试中”，并保存阶段记录和审计。列表仅返回 HR 负责安排或本人参与的场次。

当前只核验系统内日程，页面明确显示“邀请尚未发送”。尚未实现可用时段维护、外部日历、邀请送达、候选人或面试官确认、改期／取消、面试提纲、面评、提醒和业务决定；这些必须在后续版本化流程中分别接入，不能把本排期状态当作已确认或已通知。
