# 后端开发约定

- 遵循根目录 `../../AGENTS.md` 和开发交接文档。后端使用 Django／DRF、PostgreSQL；Python 由 uv 独立管理。
- 使用 `uv sync --locked`，锁文件 `uv.lock` 纳入版本管理。运行命令时使用 `uv run --env-file .env`，凭据不写入源码或输出日志。
- 查询范围统一从当前有效 Membership 出发；HR 的部门授权只允许在该部门建岗，不代表读取该部门其他 HR 的全部职位。
- 关键动作在事务内锁定 Job，再检查 version；业务变化、画像状态、任务完成及新任务、操作记录同事务完成。
- 画像内容按版本追加，确认历史不可覆盖。来源、待核实项、排除信号理由必须保留。
- Candidate 和 Application 已在 D02 分别建模；不要给人直接设置全局招聘状态，也不提前创建没有业务入口的空模块。应聘处理按 Candidate → Job → Application 的顺序加锁，复核同时检查应聘 version 和正式画像 profile；Task、StageEvent、ReviewDecision、AuditEvent 同事务。简历原件不允许静态公开，下载必须额外检查本部门 resume_download 能力。
- 迁移和业务测试均用 PostgreSQL，不能以 SQLite 测试代替并发验证。
- 正式环境禁止 `seed_local`。`scripts/prepare_e2e.py` 只能重建本机 `recruitment_e2e` 专用测试库。
