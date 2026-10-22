# 测试与验证

## 无凭据的提交门槛

```bash
npm ci --ignore-scripts
npm run verify
```

`verify` 顺序执行 `check`、ESLint 与四组回归；无需 `.env`，不启动真实业务服务，不读取学生数据。

| 套件 | 覆盖 |
| --- | --- |
| `test:permissions` | 权限词表、角色、状态与路径范围 |
| `test:identity` | 注册、密码策略、验证、跨来源拒绝、会话与账号隔离 |
| `test:volunteer-profile` | 邮箱/姓名/学号匹配、绑定冲突、白名单、故障与待同步恢复 |
| `test:node` | HTTP/依赖、会话、验证码排序、容量、名单、献血车、照片、时长与半成功恢复 |
| `test:infrastructure` | 基础设施专项：临时文件与回环 HTTP 服务 |
| `test:materials` | 库存、累计借还、故障恢复、资料校验、CSV、本地新增与停用恢复、HTTP/CSRF |

各套件的断言数量随新增测试变化，运行后以实际输出为准。

基础设施套件会创建临时文件和回环 HTTP 服务，结束后关闭服务并删除文件。邮件使用 stream transport，不投递。SDK 兼容性检查覆盖构造、认证以及行读取/追加的本地模拟 HTTP 契约。

CSS 打包的链接越界测试在 Windows 上创建无需文件符号链接权限的目录联接（junction），其他系统保留文件符号链接。两种夹具都会实际指向 `styles` 目录以外的合成 CSS，并断言打包器拒绝读取；无需以管理员身份运行或开启开发者模式，不跳过此安全检查。

`tests/smtp-request.test.mjs` 与 `tests/smtp-tls.test.mjs` 使用回环合成 SMTP/TLS 服务，不访问外部网络。Node 26 会拒绝 IP 字面量 SNI；连接器仅给域名发送 SNI，IP 仍按连接目标校验证书。测试覆盖 IP、自动/指定 DNS SNI、显式关闭 SNI、可信/不可信证书、错误证书身份、超时、预先取消和并行请求隔离。`tests/fixtures/smtp-tls` 的公开测试私钥只用于回环夹具，发布包排除整个 tests 目录。

## CI 与发布门禁

`.github/workflows/ci.yml` 在 main push、PR、手动触发和每日计划中运行。以下六类必须全部成功才能通过 `Quality gate`；测试阶段无生产凭据。

| 检查 | 覆盖与运行方式 |
| --- | --- |
| Node 22/24/26 × Ubuntu/Windows | 6 组完整模块、文档、具名 ESM 导入、ESLint、权限/身份/业务回归与高风险依赖审计 |
| Chromium 桌面/手机 | 既有全量页面、交互、键盘、主题、无障碍和业务回归 |
| Firefox / WebKit | 关键页面资源、宽/窄屏、筛选 URL、键盘焦点、私人路由与 API 权限、轮播减少动态 |
| UTC / Asia/Shanghai / America/Los_Angeles | 3 组完整 Node 业务回归，发现时区依赖 |
| HTTP boundary coverage | HTTP 基础层行 ≥90%、分支 ≥80%、函数 ≥90%；生成报告，其他模块不宣称达到此覆盖率 |
| Release safety | Python 发布/回滚回归、实际压缩包白名单和哈希、隔离安装生产依赖、图片/二维码/XLSX 编码、入口资源与 CSP/缓存校验 |

Firefox／WebKit 任务的整体上限为 15 分钟，包含浏览器与系统依赖安装、测试及证据上传。WebKit 冷安装曾耗时 6 分 20 秒，原 10 分钟预算会在测试尚正常推进时取消任务；延长任务预算不改变 30 秒的单用例上限、测试范围、失败判定或 Quality gate 要求。

本地命令：`npm run test:browser:cross`（先 `npx playwright install firefox webkit`）、`npm run test:coverage`、`python3 scripts/package-release.py /tmp/release.tar.gz` 后 `npm run test:release -- /tmp/release.tar.gz`。后者需要 Python 和 npm 网络/缓存，仅在临时目录安装公开依赖；结束后清理，不加载 `.env`、不启动真实业务服务。Safari 不默认把鼠标点击按钮变成键盘焦点，跨引擎测试使用实际键盘激活来验证焦点保留。

浏览器截图/trace/JUnit 保存 7 天，HTTP 覆盖率报告保存 14 天，生产发布回执保存 30 天。Node 26 现为正式门禁，不再允许失败。main 推送通过全部检查后部署；每日和 PR 仅检查。部署完成额外执行有 30 秒单请求期限的只读公网冒烟；若此检查失败，发布任务报告失败，按运维指南排查或回滚，不能把文件更新当成已验收。

## 完整环境冒烟

公众检查默认 `SMOKE_BASE_URL=http://127.0.0.1:3000`，读取页面、资源与公开接口。`preview` 不提供真实数据接口，因此不能作为冒烟目标。

其他检查用 `BASE_URL`：`smoke:auth` 与 `smoke:data-boundary` 默认 3100，`smoke:identity` 与 `smoke:events` 默认 3200。运行前显式设置目标与测试账号。`smoke:auth` 的历史夹具期待 admin1–3 / user1–3 六个账号，不会自动建立它们；夹具中的弱口令只用于测试环境。

登录和会话操作会写审计记录。`smoke:auth --write` 还写投稿；identity/events 冒烟会注册、发码或生成业务记录并尝试回收。回收不是事务，失败可能留下数据 —— 这类测试只在有授权的隔离测试环境执行。

### v3 业务冒烟（`E2E_BASE`，指向本地已起的带 `.env` 服务）

| npm script | 脚本 | 覆盖 | 最近结果 |
| --- | --- | --- | --- |
| `smoke:v3-tasks` | `scripts/smoke-v3-tasks.mjs` | 任务发布技能要求、申领 → 管理员审核（通过/驳回）、技能下拉与软件多选、条件必填、越权拦截 | 37/37 |
| `smoke:v3-storage` | `scripts/smoke-v31-storage.mjs` | 槽位部门+活动前置校验（含**活动白名单 `attachment_activity_not_allowed`**）、投稿附件三级落点（**云端核对目录真实建出**）、删除保护 | 13/13 |
| `smoke:v3-media` | `scripts/smoke-v3-media.mjs` | 影像三级落点（**云端核对**）、精选双库复制、删除审核、批量 zip | 30/30 |
| `smoke:v3-s6` | `scripts/smoke-v3-s6.mjs` | 中心-活动联动、展示墙双板、栏目字典 | 12/12 |
| `smoke:v3-s7` | `scripts/smoke-v3-s7.mjs` | 宣传展示半自动导入与幂等 | — |

要点：脚本会把记录/文件写进**测试 Base 与真实 NJU Box**并尝试回收（回收不是事务）；服务必须与测试**同一条命令内**启动并收尾。写入限流是进程内存计数（每桶 1 小时窗口）——同一进程内重复跑同一脚本会撞 429，重启服务即复位。`scripts/.link-check.mjs` 提供 ESM 具名导入 ↔ 目标导出的静态比对（防「页面整模块加载失败」类问题）。

## 按修改选择证据

| 改动 | 需要的证据 |
| --- | --- |
| 权限/身份 | 拒绝路径与跨账号隔离 |
| 持久化 | 故障恢复与重复请求 |
| 界面 | 真实浏览器下的宽/窄屏、键盘操作与错误态 |
| 依赖 | 离线兼容性 + 目标服务集成验证 |

`check` 只做语法、导入与文档链接检查，不验证业务逻辑。

2026-10-12 本轮完整 Node 回归为 **594 项**；测试数随代码增长，以实际运行输出为准。`test:node` 替代原来用基础设施命名承载所有 Node 测试的入口，`npm test` 仍跑全套。

## 试点与预览工具

`preview:workflow` 使用合成内存服务，演示时钟固定在 2026-10-04/05 以保证签到窗口可复现。预览照片写本地私有目录，重启后内存业务记录重置，全程不访问外部服务。

`preview:materials` 仅监听本机，启动时只读加载真实 API 快照，后续库存、申请、流水和照片修改均保存在隔离内存中，不回写远端。离线验证请显式使用 `preview:materials:synthetic`，不读取环境配置或访问外部服务。自动测试注入合成数据与假 API，不使用真实凭据。页面验证与真实 Base 验收边界见 [物资管理说明](MATERIALS_MANAGEMENT.md)。

`smoke-workflow-test-base.mjs` 会追加合成记录，不自动清理；不是只读 smoke。旧 `smoke:identity` 的开发日志验证码方式不适合当前生产邮箱流程，禁止对生产执行。完整业务需另外验证真实邮箱、角色、照片与恢复路径。
