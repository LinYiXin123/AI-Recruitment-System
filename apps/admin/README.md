# 知遇 AI 招聘工作台

当前已能完成：HR 登录、创建职位、保存招人要求、提交负责人确认、要求补充、开始招聘、暂停／关闭／重新开启，以及查看版本和操作记录。首页待办与后端操作同步更新，刷新不会丢失已保存的数据。

原 Ant Design Pro 模板和模拟接口已经移除。当前使用 React 19、TypeScript、Vite、Tailwind CSS、shadcn/ui 与 Semi Design；锁定版本见 `package.json` 和 `package-lock.json`。保留原模板 MIT 许可证用于历史溯源。

## 本地启动

先按 [后端说明](../api/README.md) 启动独立 PostgreSQL 和 Django，再在本目录使用 Node **24.21.0**：

```sh
npm ci
npm run dev
```

工作台地址：`http://localhost:5174/`。开发服务只监听本机。默认通过同源 `/api` 转发到 `127.0.0.1:8100`，需要其他后端地址时使用 `API_TARGET` 环境变量。用户的外部首页端口和文件不受影响。

本机体验账号由后端 `seed_local` 创建，账号为 `local_hr`、`local_manager`、`local_other_hr`；密码读取工作副本 `.local/体验账号.txt`，不提交到 Git。数据标明虚构；这三个账号通过真实密码与后端会话登录，不能切换前端角色绕过权限。

## 验证

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

首次使用 Playwright 时，安装对应 Chromium：`npx playwright install chromium`。默认从 `~/.local/bin/uv` 启动后端，也可设置 `UV_BIN`。`npm test` 读取 `apps/api/.env` 中本机数据库连接，仅重建 **recruitment_e2e**，不修改本地工作库 `recruitment`；要求连接角色能创建数据库。验收使用 5175 和 8101，不占用预览端口。

已保存的浏览器验收涵盖建岗到确认、刷新持久化与旧版本、真实筛选、请求失败保留输入并重试、窄屏详情、权限隔离、退出登录。后端另验组织关联、状态前置条件、版本冲突、并发和登录安全。

## 当前边界

只交付实施顺序的第一步，不代表整个 P0 完成。简历／应聘、面试与候选人确认、真实 AI、飞书、渠道发布和回传仍待后续实现。当前没有成员授权配置页面，实际团队账号与角色需由维护人员配置。

`npm run preview` 仅提供构建后的静态页面；正式部署需要将网页和 `/api/` 配到同一 HTTPS 站点，不能用静态预览代替完整后端。开发服务器不是生产部署方案。
