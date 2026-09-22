# 内部系统开发约定

- 先读取并遵循项目根目录 `../../AGENTS.md`，使用简体中文说明与提交。
- 本目录的默认前端技术栈遵循根目录约定：shadcn/ui、Tailwind CSS 和 Semi Design。现有 Ant Design Pro 工程为此前安装的模板，不作为后续技术选型要求；实际启动、测试方式与当前限制见 `README.md`。
- `src/services/ant-design-pro/` 是模板生成的接口示例，后续使用 `npm run openapi` 按正式接口规格更新；页面专用请求可放在对应页面的 `service.ts` 中。
- `src/.umi*` 与 `node_modules` 为生成内容，不纳入版本管理；开发监听补丁由 `npm run dev` 自动应用，不手工提交依赖文件。
- 当前登录、列表与 AI 回复均为演示，不能作为正式鉴权、数据权限或模型接入使用。
