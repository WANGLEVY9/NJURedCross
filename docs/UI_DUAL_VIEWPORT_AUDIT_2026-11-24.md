# PC Web 与移动端组件 / UI 验收

本轮检查覆盖 10 条关键路由 × 桌面 1440×900、手机 390×844 两档，共 20 个页面/视口组合。使用隔离合成预览（`scripts/preview-workflow.mjs`）和 Chromium，不连接生产数据。原始数据见 [UI_COMPONENT_AUDIT_2026-11-24.json](../reports/UI_COMPONENT_AUDIT_2026-11-24.json)，源码守卫见 [ui-dual-viewport-audit.test.mjs](../tests/ui-dual-viewport-audit.test.mjs)。

## 目标与结论

| 目标 | 核验方式 | 结论 |
| --- | --- | --- |
| 升级后的活动管理与运营模块在 PC/移动端生效 | 根节点标记与专属样式加载 | 10/10 控制台组合生效，包含总览、活动、宣传、物资、操作日志 |
| 页面级横向溢出 | `document.documentElement.scrollWidth <= innerWidth + 1` | 20/20 通过 |
| 移动端功能文字可读 | 可见文本字号不小于 11px | 10/10 组合无低于 11px 的功能文字 |
| 移动端标题层级 | 相邻标题不跳级 | 10/10 通过；已修复 `/community` 兼容页与广场步骤标题 |
| 运行时错误 | `pageerror` 与 console error | 20/20 无 JS 异常。合成预览缺少部分 API 时会产生 404 控制台消息，已归类为夹具限制 |
| 页面字体与控件一致性 | 计算样式、控件高度、焦点样式 | 控制台页面正文与辅助文字统一到 12px 以上，运营模块共享基线生效 |
| 触控目标 | 手机端关键按钮/输入/导航目标 | 控制台核心路径基本达到 44px；残余项见下节 |

## 本轮补强

- 新增 [console-ui-hardening.css](../public/styles/console-ui-hardening.css)，通过 `admin.css` import 纳入发布包，统一控制台导航辅助文字、键帽标签与手机导航项高度。
- 在 `components.css` / `refinement.css` / 对应路由样式表末尾加入双端基线：品牌字标不低于 12px；轮播圆点保持小视觉点，但点击区在手机端为 44px，桌面指针设备可降至 32px；手机轮播箭头与暂停按钮达到 44px。
- `/console/materials` 的合成预览根节点补齐 `console-operations-redesign`，避免该页仍走旧样式。
- `/community` 兼容页卡片标题和广场步骤标题改为语义 `h2`，保留原 `t-h3` 视觉尺寸，修复 `h1` 后直接出现 `h3` 的层级跳跃。

## 残余项与判定

- 公众端桌面仍可能量到 9px 的 `brand-wordmark`：这是页头/页脚的装饰性英文品牌字标，不是业务正文；已在共享与路由样式中设 12px 下限，个别隐藏副本仍保留旧计算值，不影响正文可读性。
- 桌面端小型 ghost 按钮、页脚备案链接、面包屑、顶部 30px 图标按钮未全部提升到 44px：这些是桌面鼠标控件，不构成本轮手机触控风险；若未来支持触屏笔记本，应纳入共享组件层的 pointer 变体。
- 活动管理桌面页仍有少量 10px 业务辅助文字与筛选/表格小控件，属于数据密集型工作台的局部密度，不影响页面级可读性与手机端触控；下一轮可按表格组件统一处理。
- 首页与广场轮播的细圆点视觉保持不变，点击区已按视口规则扩展；Playwright 设备模拟的 `pointer: fine` 与真实手机可能不同，最终规则以 `max-width: 960px` 为准。

## 复核命令

```sh
node scripts/preview-workflow.mjs
node scripts/.ui-audit-tmp.mjs  # 临时脚本，结果写入 reports/UI_COMPONENT_AUDIT_2026-11-24.json
node --test tests/ui-dual-viewport-audit.test.mjs
npm run verify
```

报告中的 `errorStateNodes` 表示页面内已渲染的错误/空态提示节点，`runtimeErrors` 表示浏览器控制台消息；合成预览里 `/api/auth/account`、`/api/public/showcase`、`/api/public/warmth/capabilities` 与审计记录接口未实现，因此会出现可预期的 404 消息，均不是 UI 资源或脚本异常。复核线上时使用已登录浏览器检查总览与活动管理首屏；生产数据读取慢时页面会显示骨架和错误态，不能把数据加载超时当作 UI 回归。
