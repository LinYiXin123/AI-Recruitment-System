# 知遇 AI 产品首页

使用 React、TypeScript、Vite、Tailwind CSS 4 和官方 shadcn/ui（Base UI）实现的外部产品首页。产品名“知遇 AI”为可替换的暂定名称。

## 本地运行

建议使用 Node.js 24 LTS。在本目录执行：

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173/ 。服务仅监听本机，端口占用时会报错，不会悄悄切换地址。

## 页面能力

- 响应式产品首页，包含产品介绍、简历分析演示、能力说明、工作流程和常见问题。
- 两组虚构岗位示例，可切换产品经理与前端工程师，查看对应的简历依据和面试建议。
- 支持手机导航、键盘切换标签、弹窗焦点管理、减少动态效果偏好及跳转主要内容。
- 所有“体验”入口进入同一示例区，不要求注册、不接收真实简历。

当前分析内容为预设数据，没有接入模型、文件解析、登录或业务后台。页面明确标注演示边界；不使用虚构客户数量、准确率或效率承诺。

## 验证与构建

```bash
npm run lint
npm run build
npx playwright install chromium --only-shell
npm test
```

测试覆盖桌面和手机视口的入口、岗位切换、依据与面试弹窗、键盘操作、常见问题、导航及横向溢出。截图保存在本地 `test-results/`，不纳入版本管理。

浏览器测试使用 Playwright 专用无界面浏览器和独立临时上下文，不读取日常浏览资料。

构建产物位于 `dist/`，可部署到静态网站服务。`npm run preview` 可在本机检查构建结果；它使用同一端口，需先停止开发服务。

## 修改入口

- `src/LandingPage.tsx`：页面结构、导航、营销文案和常见问题。
- `src/ResumeDemo.tsx`：虚构材料和交互演示。
- `src/index.css`：品牌色、字体及 Tailwind 主题。
- `src/landing.css`：页面布局与响应式样式。
- `src/components/ui/`：由官方 CLI 添加的 shadcn 组件，按钮尺寸与弹窗中文文案已适配本页。

遵循项目根目录 `../../AGENTS.md`。组件开发使用根目录的官方 shadcn Skill，按实际安装版本查询文档；已有内部系统模板不影响本目录技术栈。
