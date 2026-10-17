# 活动管理整合验收（2026-10-17）

## 交付范围和代码基准

- 用户本轮要求：继续队友成果，完成开发和验收，**先不创建 PR、不合并、不部署**。
- main 基准：`95cb7cf1b38b5a78af4d705133859f57f098eabc`。开始时工作区干净，原分支 `codex/xinyue-attendance-mobile` 已保留。
- 交付分支：`codex/activity-workflow-integration`。
- 最终功能代码提交：`1a4122409062507bb012f3d83dd75a47820dc691`；本报告及截图随后单独提交，文档提交可用 `git log -1 --format=%H -- reports/ACTIVITY_INTEGRATION_2026-10-17.md` 核对。
- 通过本地 merge 保留各 PR 的真实作者和提交历史，没有修改远端原分支或 main。

| 来源 | 核对的提交 | 调查结果及整合内容 |
| --- | --- | --- |
| [#15](https://github.com/WANGLEVY9/NJURedCross/pull/15) · xinyue-L01 | `ff62e6948511effac973056d932c62058b9f0540` | OPEN；原 CI Quality gate 成功；保留手机紧凑卡片、共享列表分页、详情抽屉及 Excel 预览 |
| [#20](https://github.com/WANGLEVY9/NJURedCross/pull/20) · Nport-hut | `3cd3a64ceaac4311a0f73cc0ff9baf288873df9c` | OPEN；原 CI 两组手机回归失败；整合统一操作菜单、活动变更预览/审批、版本与 SQLite 恢复 |
| [#21](https://github.com/WANGLEVY9/NJURedCross/pull/21) · Daily-6 | `37d3ea316da19a2e72c2b00026c89125459af7d0` | OPEN；原 CI Quality gate 成功；整合三步创建、默认服务岗、指定审核人及整表提交/退回/结束门禁 |

附件 A 类 patch 和需求清单仅作为参考。main 已有六环节、岗位稳定编号、普通/献血项目表格和筛选等后续实现，未重复套用过时补丁。新增 Excel 通知、流程投递提醒、右侧独立流程图继续暂缓。

## 本轮新增修复

1. 把 #20 共用菜单的“提交时长表”接到 #21 的真实服务端提交接口；提交使用整表 revision，完整性不满足时跳转签到处理，成功后真实锁定负责人编辑。
2. 合并三方共同修改的 `activity-service.js`、`hours-workspace.js`、`activity-center.js`、CSS、后端工厂和 API。手机与桌面使用相同的整表锁定、缺席及权限数据；原筛选、稳定岗位编号保留。
3. 修复整表退回后“待批准”明细被默认筛选隐藏的问题；仅未通过明细可再次录入，已批准/已入账仍不可编辑。
4. 已批准请假的历史“已确认”记录不计默认待处理名单；已登记缺席不再混入未处理列表，计数使用整表完整性规则。
5. 修复共享搜索控件整合后清除筛选仍引用旧 `search.control` 的问题。
6. 去掉岗位项目重复的结束操作；保留“审核完成后单独结束”，导出不结束、不显示成已发送。
7. 手机签到保存的提示区分“保存本人时长”和“提交整份时长表”，不提前宣称已提交审核。
8. 修复 #20 原 CI 失败的异步等待：审批成功后先等待页面显示“待发布”，再打开重绘后的操作菜单；同步 #15 旧 tab 名和选中计数断言。没有删除断言或放宽质量门槛。
9. 新增真实合成 API 的桌面/手机交接测试，以及“变更审批 → 签到证据 → 整表 → Excel → 结束”后端跨功能回归。

主要入口：`lib/events/workflow.js`、`workflow-api.js`、`activity-change-*`、`hours-submission*`，以及 `public/app/console/pages/` 下的创建向导、活动中心、签到和时长工作区。未新增依赖；十列 Excel 保留院系列。

## 实际运行与状态验收

使用 Node.js `v24.13.1` / Windows；合成服务不读取 `.env`、不连接 SeaTable 或 SMTP。启动：

```powershell
npm ci --ignore-scripts
npm run preview:workflow
# 默认 http://127.0.0.1:3121/console/events
# 端口占用可设置 $env:PORT='3123'
```

本轮另在 3123 运行独立人工预览，避免与浏览器测试的单会话 fixture 相互影响。人工打开签到卡片与证据抽屉、修改并实际保存服务时长及工作内容，确认列表待处理人数减少、控制台无 JS 错误。完整多身份交接由真实 API 浏览器用例执行，未用静态截图替代交互。

| 流程 | 实际结果 |
| --- | --- |
| 创建/复制/退出/恢复 | 统一报名和分岗位向导都运行；返回复用草稿 ID；通知保存不提交审批；审批冲突和不确定写入保留输入 |
| 岗位 | 单岗、多岗、四校区、复制/重复校验、时间范围、容量、默认服务岗与原岗位编号回归 |
| 审批/发布 | 指定审核、非指定拒绝、超级管理员、退回重提、立即/定时、无岗位阻止发布；未来定时不自动批准 |
| 名单 | 普通/献血路径、岗位与班次分组、搜索/排序/筛选、报名资料抽屉、批量及请假回归 |
| 签到/整表 | 空名单/1/20/200 人；真实到场录入；缺席原因；待处理阻止提交；提交后负责人写入失败 |
| 退回/重新提交 | 指定审核人填原因退回；负责人默认列表重新出现未批准记录；重提 revision 从 1 经退回到 3 |
| 审核/Excel/结束 | 真实时长审核，在线预览，下载并用 ExcelJS 检查十列和院系；下载后仍“进行中”，手动结束后只读 |
| 版本/持久化 | 过期 revision、证据篡改、SQLite 重启与不确定应用恢复、JSON 重启/损坏关闭写入均有 Node 回归 |
| 自动献血车 | 保留源表生成和原月度审核，隐藏网页整表提交/手动结束；不改变历史生成流程 |

响应式矩阵覆盖 360、390、768、1280、1440px；岗位弹窗另覆盖 320px，签到桌面主题/宽度及手机 200 人列表也实际操作。完整交接用例监听 `pageerror`，两种布局均要求零异常。

## 测试记录

- `npm ci --ignore-scripts`：成功，依赖审计 0 漏洞。
- `npm run verify`：最终功能代码 **2140 通过，0 失败，0 跳过**；模块/文档与 ESLint 检查通过。
- `npm run check:links`：通过。
- `git diff --check`：通过。
- 十组浏览器最终回归：**92 通过，0 失败，4 按布局跳过**（3 项仅手机、1 项仅桌面）。
- GitHub Actions：本报告写入时尚未运行；推送后通过现有 `workflow_dispatch` 运行完整门禁，该事件不满足生产部署条件。最终结果和具体运行链接在交付消息中报告，也可在 [整合分支 Actions](https://github.com/WANGLEVY9/NJURedCross/actions/workflows/ci.yml?query=branch%3Acodex%2Factivity-workflow-integration) 核对。

相关浏览器命令：

```powershell
npx playwright test tests/browser/activity-approval.spec.mjs tests/browser/activity-form-workspace.spec.mjs tests/browser/activity-management-integration.spec.mjs tests/browser/activity-notice-approval-flow.spec.mjs tests/browser/activity-change.spec.mjs tests/browser/project-positions.spec.mjs tests/browser/field-workspace.spec.mjs tests/browser/hours-submission.spec.mjs tests/browser/activity-header-consistency.spec.mjs tests/browser/activity-workflow-handoff.spec.mjs
```

失败历史保留说明：第一轮 94 项中 84 通过、4 按布局跳过、6 失败（原 #20 审批后菜单等待、旧 tab/计数断言）；修正后针对性回归确认。新增真实交接用例首轮因直接操作样式隐藏的 checkbox 超时，改为与实际用户一致的 label 点击后桌面/手机通过。最终统计不混用旧运行结果。

## 截图与前后对比

截图仅为内存合成身份。原手机成果见 [#15 的验收记录](ATTENDANCE_MOBILE_2026-10-15.md)，原整表页面见 [#21 的验收记录](ACTIVITY_CONFIRMED_SCOPE_2026-10-17.md)。本轮统一操作区、退回后编辑与多宽度截图在 `reports/activity-integration-qa/`，由上述真实交互用例生成。

| 合成截图 | 链接 |
| --- | --- |
| 统一报名默认服务岗（手机） | [查看](activity-integration-qa/creation-default-mobile.png) |
| 通知与审批（桌面） | [查看](activity-integration-qa/creation-notice-desktop.png) |
| 进行中、提交门禁（1440px） | [查看](activity-integration-qa/attendance-desktop.png) |
| 手机签到证据与编辑抽屉 | [查看](activity-integration-qa/attendance-inspector-mobile.png) |
| 整表提交后手机锁定 | [查看](activity-integration-qa/submitted-mobile.png) |
| 退回后的桌面 / 手机 / 平板 | [桌面](activity-integration-qa/returned-desktop.png) · [390px](activity-integration-qa/returned-mobile.png) · [768px](activity-integration-qa/returned-tablet.png) |
| 手机时长列表与 Excel 预览 | [时长](activity-integration-qa/hours-mobile.png) · [预览](activity-integration-qa/excel-preview-mobile.png) |
| 单独结束后的只读结果 | [查看](activity-integration-qa/completed-desktop.png) |

## 待决事项及合并前交接

- Excel 链接站内通知的接收人（全部指定审核人或实际审核人）、投递方式、去重及失败策略需产品确认；未新增真实投递。
- 新流程待办提醒与右侧独立流程图继续暂缓；保留现有顶部阶段及下一步提示。
- 没有生产账号、远程 Base、SMTP、服务器目录或真实照片的联调验收；没有迁移、修改真实业务数据或部署。
- 私有状态必须同时保留：`PLATFORM_WRITE_STATE_DIR/activity-hours-review.json`，以及按 Base 哈希命名的 `activity-changes-*.sqlite`（含 SQLite sidecar）。备份/恢复见 [变更恢复](../docs/ACTIVITY_CHANGE_REVIEW.md) 和 [运维](../docs/OPERATIONS.md)。
- 当前依然是单实例写队列/私有状态。回滚前停写并协调备份业务明细与两种私有存储；不能删除 JSON/SQLite 来解锁，也不能把旧代码回滚当作数据回滚。
- PR 未创建，main 未修改，未合并、未部署；后续由用户决定何时提交整合 PR。
