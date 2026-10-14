# 报名成功邮件工作区重构

日期：2026-10-14。审计基线：`ce80b2b`。仅修改成功邮件编辑体验，不修改报名公告、收件人、SMTP、审批、名单发布或持久去重逻辑。

## 现状与选择

最新 main 与提供的截图一致。旧 `successMailEditor()` 使用 1040px Drawer 和共享 `.notification-workspace`，默认/冻结模式仍展示禁用字段；预览与普通灰色面板相同。抽屉主体自身滚动，底栏固定，但主体缺乏信息分区。保存请求和后续刷新共用 catch，独立使用组件时刷新抛错可能误报保存失败；当前活动页的刷新包装器会返回 false，也需要明确处理。

比较了两种布局：

- **编辑器＋阅读器**：自定义模式 60:40，默认/冻结模式 40:60，适合桌面同时核对内容与变量。采用此方案。
- 编辑器＋折叠预览：适合极窄空间，但会隐藏发送内容的核对依据。不作为桌面默认；窄屏改为顺序单栏。

采用已有 NJU Sans、主题 accent、surface、bg-sunken、border 令牌，不新增字体、调色板或运行时依赖。标题 26px、分区 19px、预览主题 21px、输入与正文 16px。邮件阅读区使用“预览外框—邮件纸面—主题—合成收件人—纯文本正文”的结构，不添加实际邮件不支持的图片、按钮或发件地址。样例姓名始终为合成“志愿者”。

## 状态与业务边界

| 状态 | 呈现与可用操作 |
| --- | --- |
| Default | 平台默认模式、说明与真实默认邮件；隐藏输入区；未修改时不能重复保存 |
| Custom / Clean | 主题、正文、五个变量、字数、实时预览；保存禁用 |
| Dirty | 底栏说明保存后生效；切换模式保留草稿；关闭需确认 |
| Invalid | 字段原位提示、aria-invalid；不提交；主题换行粘贴被拒绝并解释 |
| Saving | 禁用编辑与关闭，保留站内及浏览器离开保护 |
| Saved | 显示已保存且未发送，转为只读阅读；不复用旧 token 再提交；关闭后重新读取页面当前配置 |
| Error | 固定底栏解释失败，保留输入，允许重试 |
| Conflict | 保留可选择复制的只读草稿，禁止覆盖；关闭后刷新核对 |
| Frozen | `confirmedAt` 优先，即使 phase 重回 draft 也只读；无模式切换或保存动作 |
| Saved / Refresh failed | 明确保存已完成；仅提供重新加载名单，不提示重复保存；重新打开旧页面数据时先要求刷新，不展示过时邮件预览 |

保留 PATCH `/api/volunteer/workflow/events/:id/success-mail` 与 `{template,token}`。默认模式提交 `template:null`；预览调用 `renderSuccessMail(null,event)`，不把 `successMailDefaults` 建议模板当作默认发送内容。自定义预览使用同一个渲染函数；校验使用原验证函数，主题 120、正文 5000，五个变量不扩展。

服务端仍要求活动管理权限、会话、CSRF/来源校验、活动报名中且批准有效、非直确认/源表自动班次、名单 token 一致、draft 且从未最终确认。界面状态不是权限授权。保存不发信，最终确认不代表收件箱送达。

变量工具栏对当前主题或正文选区执行纯文本 setRangeText。跨引擎验证发现 WebKit 原生 insertText 会将变量和上一次输入合并撤销，因此两个字段使用上限 100 条的本地文本撤销/重做记录；连续输入与输入法组合按编辑过程合并，变量插入独立为一步，同时处理键盘和 beforeinput 的历史操作。输入法合成期间不插入或重绘。恢复建议模板有独立确认。保存后的名单重绘可能替换原触发按钮，因此关闭会恢复到新按钮，而非已脱离 DOM 的旧节点。

## 工程所有权

- `public/app/console/pages/success-mail-composer.js`：独立原生组件、模式、阅读预览、字段校验、选区插入与保存状态。
- `public/app/console/pages/activity-management.js`：移除旧内嵌编辑器，名单入口调用新组件。
- `public/styles/admin.css`：仅新增 `success-mail-*` 命名空间，不覆盖共享报名通知布局。
- `tests/browser/success-mail-composer.spec.mjs`：合成数据交互、状态与截图矩阵。
- `tests/browser/notification-workspace.spec.mjs`：升级原邮件测试到新模式和明确保存结果。
- `playwright.cross.config.mjs`：将新组件功能用例加入 Firefox/WebKit 回归。
- `eslint.config.js`：排除跨浏览器测试生成的 HTML 报告脚本，避免把 Playwright 产物误作项目源码检查。

## 验证记录

使用真实应用和本地 `preview-workflow` 合成服务，没有真实报名写入或真实发信。截图位于本地忽略目录 `.workflow-evidence/success-mail/`，不提交个人信息或测试运行产物。

改造前使用基线版本的真实模块并在同一合成环境打开编辑器。改造后覆盖 1440×900、1920×1080、1280×800 的 Default、Custom、Dirty、Invalid、Saving、Saved、Error、Frozen，以及已保存自定义模板重开。Frozen 截图用合成 DTO 注入真实组件；服务端冻结和发送幂等由原 Node 测试验证，不以截图替代。

管理端五主题为 porcelain / blueprint / botanic / atelier / archive；dawn 等是公众端主题，不混用。另覆盖手机、长 URL、减少动态偏好、选区替换和撤销、模式往返、恢复取消、关闭保护、焦点恢复、409、写入成功但刷新 503、默认模式 null 保存。

最终验证：

- `npm run verify`：402 个 JavaScript 模块、109 个 Markdown 文档检查通过；lint 零警告；Node 682/682 通过。
- Chromium 桌面/手机：`success-mail-composer.spec.mjs`、`notification-workspace.spec.mjs`、`activity-management-integration.spec.mjs` 共 30 通过、2 跳过。
- Firefox/WebKit：成功邮件与报名通知工作区共 20 通过、4 跳过。
- 跳过项仅为重复的桌面截图生成用例；三尺寸状态截图在 desktop-chromium 执行，功能用例未跳过。
- 中文输入法组合事件采用合成事件序列验证，不声称完成真实操作系统输入法人工验收。
- `git diff --check` 通过。上述为相关回归，不代表运行了全仓所有浏览器测试。

本轮使用项目 frontend-design skill 指导模式选择、编辑/阅读区域层级和独立样式组织，保留原生组件与现有令牌。本轮依据附件不触发生产部署；本地截图和合成测试不等于线上验收或真实收件箱送达。
