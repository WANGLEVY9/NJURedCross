# PR26 与 main 集成核对（2026-10-25）

## 基线和范围

- PR26 原提交：`bb900d3c8781fa9e334538987e5356f77613f424`。
- 本轮同步的 main：`926058cc0d53c09bcf6ad292b7d2fe33c883662d`。
- 在独立工作区合并 main，保留 PR 原有业务提交。没有合并 PR27、PR28、PR30 或 PR31。
- 没有文本冲突。逐项复核双方改过的 workflow、management API、生产服务入口、合成预览、活动 CSS 和草稿/提交测试。
- 保留 main 新增的通知收件核验、岗位及起止时间、资料必填、QQ群校验和物资/报销功能；本 PR 的定向读取与列表配色、岗位计数继续存在。
- 活动和报名查询仍保留逐活动鉴权、完整分页、结果投影及写前重新取证；SQL 失败不退回全表扫描。SQLite 局部索引与恢复边界见本 PR 原查询审查记录。

## 本地验证

Windows、Node 24.15.0，使用锁文件安装依赖；测试只使用临时/内存合成数据，不加载生产配置或写真实业务表。

- `npm run verify`：通过。1086 个 JavaScript 模块、169 个 Markdown 文档检查无错误；lint、权限、身份、资料检查通过；Node 套件 **2546 项通过，0 失败，0 跳过**。
- `npm run check:links`：1083 个模块通过。
- `git diff --check`：通过。
- Edge 桌面与手机：**94 项通过，2 项测试自身预设跳过**。覆盖岗位计数、完整草稿工作区、通知再次发送及资料完整度提醒。临时配置仅改变浏览器通道，保留原合成项目名。
- 完整套件首次出现 PDF 资源测试文件的进程失败；该文件单独复跑通过，随后完整 verify 重跑全部通过。没有删除断言或修改业务代码来规避该结果。

```powershell
npm ci --ignore-scripts --include=optional
npm run verify
npm run check:links
$env:PLAYWRIGHT_PREVIEW_PORT='3186'
npx playwright test --config=.cache/pr26-edge.config.mjs tests/browser/activity-directory-count.spec.mjs tests/browser/activity-draft-workspace-v2.spec.mjs tests/browser/repeat-notification.spec.mjs tests/browser/profile-completeness.spec.mjs --reporter=line
```

本地日志和临时 Edge 配置仅在 `.cache/`，不提交。

## 远端门禁与发布

原 CI `39934276967` 的 WebKit 卡在浏览器下载安装，15 分钟后取消，尚未执行用例；其他检查成功，Quality gate 因取消失败。本轮先更新 PR 基线并重新运行完整远端门禁，全部通过后再合并。

本记录是合并前验证，不代表已上线。main 合并后的 CI、部署回执（服务器 release.json 提交与运行文件哈希核对）和只读线上检查，须另行核验后报告。
