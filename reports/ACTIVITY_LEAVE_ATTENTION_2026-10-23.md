说明：以下是原始开发阶段记录。2026-10-25 已按最新 main 收敛为仅补充进行中页面，当前范围与冲突处理见 [本地核对记录](PR28_MAIN_INTEGRATION_2026-10-25.md)。

# 活动岗位请假待办提示本地验收

## 范围

- 分支 `codex/activity-leave-attention`，从 main `79cf421` 开始。
- 报名中、进行中岗位页签显示待审批请假的数字角标和边框，项目提示条提供查看入口。
- 查看入口优先当前岗位，其次第一个有待办的岗位；报名中切换请假筛选，进行中定位请假记录。
- 单岗位有请假时同样显示带角标的岗位，避免仅因页签原本隐藏而遗漏待办。
- 提示基于当前项目已经加载的详情，单次建立岗位／来源映射并遍历报名，不增加 API 或数据库查询。歧义来源记录不重复归属。
- 保留审批权限、失败恢复和原处理记录。

## 验证

环境：Windows、Node.js 24.15.0、本机 Microsoft Edge。浏览器项目名沿用 desktop-chromium / mobile-chromium，实际配置 `channel: 'msedge'`。

- 岗位统计 Node 单测 2 项通过：待审批／已处理区分、无关项目、取消报名、分组容器、唯一及歧义来源映射、输入不变。
- Edge 相关桌面和手机回归 30 项通过，覆盖新提示、键盘岗位切换、查看入口、批准与驳回后的角标消失、失败保留、只读及单岗位，以及既有联系信息、报名审批与栏目选择。
- 真实本地活动演示：三个岗位待办 0／2／1，总数 3；入口选择摄影岗并切换到请假待审批，桌面及 390px 手机无整页横向溢出、无页面脚本错误。合成截图保存在本地 reports 中。
- `npm run check`、`npm run lint`、`npm run check:links`、`git diff --check` 通过。
- `npm run verify` 的 Node 测试 2432 / 2433 通过，唯一失败为 main 既有 `tests/web-assets.test.mjs` 的 Windows 文件符号链接 `EPERM`；相关兼容改动位于 PR #26。本次保留该失败及原有安全断言。

浏览器用例范围：`activity-leave-attention.spec.mjs`、`registration-contact-leave.spec.mjs`、`activity-draft-workspace-v2.spec.mjs` 的报名及岗位相关用例、`roster-columns.spec.mjs`。报名组件测试夹具显式登录合成账号，保证单独运行相关子集时也有确定的会话状态。

## 本地复现

```powershell
$env:PORT='3137'
$env:PREVIEW_LEAVE_ATTENTION='1'
npm run preview:workflow
```

打开启动输出中的 Leave attention 链接。演示使用原有合成内存服务和原生创建、审批、发布、报名、请假流程，不读取生产配置。可直接批准／驳回并观察数量变化，重启恢复初始数据。

提交按“岗位统计与单测 → 工作区提示与浏览器回归 → 合成演示及文档”分阶段保留，通过独立 PR 审查；PR #27 保持原样。合并 main 后按仓库发布流程核对 CI、发布清单和线上页面。
