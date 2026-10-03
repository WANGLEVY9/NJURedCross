# 前端代码

静态原生 ES Module 应用，由 `index.html` 引导 `app/main.js`。本地 `npm run preview` 可检查页面，不启用业务 API；完整体验需按运行指南启动真实测试服务。

| 目录 | 组织 |
| --- | --- |
| `app/core` | API、DOM、路由、状态、格式、快捷键、密码策略与动效 |
| `app/ui` | 表格、图表、面板、命令面板和基础组件 |
| `app/portal` | 公众外壳、认证流程与页面 |
| `app/console` | 管理外壳、领域共享工具与页面 |
| `styles` | tokens、base、components、portal 与 admin 分层样式 |
| `assets` | 品牌与纹理资源 |

新增页面在对应 `pages/` 下创建，在 `main.js` 中接入路由，API 调用集中到 `core/api.js`。不把 SeaTable Token 或原始身份字段传入浏览器；使用服务端投影。

遵循 CSP、设计令牌、键盘与焦点交互、减少动画，以及 loading/empty/error 状态。前端静态 lint 与语法检查不能代替浏览器的响应式和交互 QA，记录实际 viewport 和验收结果。

详细视觉和交互约定见 [前端设计系统](../docs/FRONTEND_DESIGN.md)，主要接口见 [API 索引](../docs/API.md)。
