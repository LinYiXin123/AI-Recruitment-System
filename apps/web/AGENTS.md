# 外部产品页开发约定

- 先读取项目根目录 `../../AGENTS.md`，本目录使用 shadcn/ui（Base UI）与 Tailwind CSS。
- 先用项目固定的 shadcn CLI 查询 `info --json` 和组件 `docs`，不要混用 Radix 的 `asChild` 与 Base UI 的 `render`。
- 页面内容和使用说明使用简体中文；“知遇 AI”为暂定产品名。候选人与分析示例必须标注为虚构，不能把预设结果描述为真实 AI 分析。
- 验证方式见 `README.md`；修改交互后检查对应的浏览器测试，修改布局后检查桌面与手机显示。
