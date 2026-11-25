# 验证流水线设计（2026-10-30 起）

目标：**覆盖要广，但主分支到部署的墙钟时间不随之变重**。做法是分层：能便宜验证的放单测与契约层，昂贵的端到端按风险分发，靠夜间全量兜住覆盖面。

## 一、分层

| 层 | 内容 | 成本 | 是否阻断发布 |
| --- | --- | --- | --- |
| 静态与模块 | `check` / `check:links` / `lint` | 秒级 | 是 |
| 行为契约（Node 单测） | `npm test`、`test:coverage`（HTTP 边界 行90/分支80/函数90） | 1–2 分钟 | 是 |
| 发布安全 | 隔离目录 `npm ci` + 逐文件哈希 + 不可变缓存 + 编码能力 | 3–5 分钟 | 是 |
| 浏览器端到端 | 桌面/移动 chromium × 3 分片 | 并行约 4–8 分钟 | 是 |
| 跨引擎 | firefox / webkit（官方镜像） | 并行约 5–10 分钟 | 是 |
| 时区 | UTC / 上海 / 洛杉矶 | 并行约 2 分钟 | 是 |
| **视觉布局** | `@visual` 标记的布局/亚像素一致性 | 约 1 分钟 | **否（告警）** |
| 公网只读冒烟 | 8 页面 + 6 资源 + CSP/XFO | 约 1 分钟 | **否（告警）** |

新增覆盖面优先放进"行为契约"层（Node 单测，毫秒级、无浏览器），只有必须真实渲染才进端到端。

## 二、抗抖动（不靠人工重跑）

1. **浏览器分片只对基础设施失败重跑一次**。`scripts/run-browser-shard.mjs` 读取 Playwright JSON 报告，区分启动/网络/超时失败与确定性断言失败。前者重跑一次；后者立即判红，保留首轮证据，不再用整片重跑掩盖同一条坏断言。
2. **布局/亚像素断言移出阻塞门禁**。这类断言（元素对齐差 <1px、两处间距必须相等）在 CI 与本机渲染有亚像素差异，历史上多次因 1.7px 的差异挡住全站部署。现在它们带 `@visual` 标记，跑在 `visual` job 里：结果进报告与 run 摘要，不阻断发布。
3. **区分「未验证」与「验证未过」**。`Quality gate` 分别列出 `failure` 与 `cancelled`；两者都不部署，但提示不同，便于判断是"没跑完"还是"跑挂了"。
4. **`Quality gate` 直接给出失败用例名**：每个 shard 上传紧凑的 `*-summary.json`，门禁下载 evidence 后由 `scripts/ci-quality-report.mjs` 汇总文件、行号、项目与错误类别，写进 run 摘要，无需手动下载 job 日志。
5. **内部滚动容器禁止页面级视口断言**：`npm run check:browser-contracts` 扫描 `tests/browser/*.spec.mjs`；表格、弹窗和详情面板的末行必须用容器几何判定是否可达。确需页面级断言时用行内豁免注明原因。
6. **发布回执记录累计提交范围**：部署前读取服务器 `release.json` 的 `commit`，回执列出自上次上线以来包含的所有提交，帮助区分「某次提交红色」与「最新绿色提交已包含该代码」。

## 三、不增重的提速

- **依赖审计只跑一次**：`npm audit --audit-level=high` 只在 ubuntu + Node 24 执行，避免一次公告同时把六组矩阵变红。
- **Windows 收敛到 LTS 一组**：保留平台覆盖（Node 24 + Windows），不再把 Node 版本矩阵乘三遍。
- **浏览器二进制缓存**：`~/.cache/ms-playwright` 按 `package-lock.json` 哈希缓存，省去重复下载。
- **PR 按改动选例**：`scripts/ci-select-specs.mjs` 按变更路径挑选受影响的 spec；命中共享层（server.js、lib/http、public/app/core、public/styles、index.html…）或改动过大时自动退回全量。main 推送与每日全量仍跑全部用例。
- **发布与后置冒烟拆分**：发布成功即记成功；冒烟非阻塞，避免"线上已是新版本但 CI 显示红"。

## 四、覆盖面如何继续扩大而不变重

1. **先写契约测试**：读取/写入路径、权限边界、缓存失效这类逻辑用 Node 单测表达（毫秒级），不要为每个断言起一个浏览器用例。
2. **端到端只保留"必须真实渲染"的路径**：布局、焦点管理、键盘可达性、跨浏览器差异。
3. **跨引擎只跑关键流**（已是现状：`test:browser:cross`）。
4. **夜间全量兜底**：每日 21:17 UTC 跑完整矩阵（含 Windows、跨引擎、全部分片、视觉集合）。PR 的裁剪只影响反馈速度，不影响最终覆盖。
5. **视觉集合是"趋势"而非"门禁"**：差异进 artifact（保留 7 天）与 run 摘要，由人判断是否回归。

## 五、相关文件

- `.github/workflows/ci.yml`：验证、门禁、部署、后置冒烟
- `.github/workflows/ci-notify.yml`：结果汇总（只加载可信 main 的通知代码）
- `scripts/ci-select-specs.mjs`：PR 用例挑选（含 `tests/ci-spec-selection.test.mjs` 契约测试）
- `scripts/run-browser-shard.mjs`：浏览器分片失败分类与证据落盘
- `scripts/ci-quality-report.mjs`：门禁摘要、失败用例汇总、发布回执
- `scripts/check-browser-contracts.mjs`：内部滚动容器断言契约
- `tests/ci-browser-runtime.test.mjs`、`tests/ci-quality-report.test.mjs`、`tests/check-browser-contracts.test.mjs`：流水线守卫
- `scripts/smoke-public.mjs`：公网只读冒烟
- `docs/OPERATIONS.md`：部署、回滚、接收器
