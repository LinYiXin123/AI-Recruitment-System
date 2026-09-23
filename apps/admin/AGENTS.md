# 内部工作台开发约定

- 先读取项目根目录 `../../AGENTS.md`，所有用户说明与提交使用简体中文。
- 当前工程是 React、TypeScript、Vite、Tailwind CSS、shadcn/ui 与 Semi Design。旧 Ant Design Pro 演示模板已替换，不能恢复模板模拟登录或固定业务结果。
- 使用 Node 24.21.0、npm 和本目录锁文件。启动、检查、验收见 `README.md`。
- 所有业务请求走同源 `/api/v1/`，开发代理必须保留请求 Host，不能关闭 CSRF 来解决登录问题。会话和权限由 Django 校验，不在浏览器存储身份令牌。
- shadcn 组件通过官方 CLI 添加；入口须保留 `shadcn/tailwind.css`、Semi React 19 adapter 和 CSS layer 顺序。Semi 的组件自带样式由 Vite 中的小插件放入 `semi` 层。
- 主流程验收使用 Playwright；独立 `recruitment_e2e` 数据库在每轮验收前重建，禁止把验收脚本指向业务数据库。截图、账号、测试输出均只保存在忽略提交的目录。
- 当前开放已可操作的“今天”“职位”“候选人”；候选人包含导入、身份核对、独立应聘和人工复核；面试随后续完整流程开放，不添加无效菜单或假按钮。
- `apps/web` 由外部首页任务维护，本任务不顺手修改。
