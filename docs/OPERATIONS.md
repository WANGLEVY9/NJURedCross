# 部署、回滚与运行维护

## 发布单位

以明确 Git 提交和文件清单为发布单位，记录配置版本、Node/npm 版本、lockfile、表结构版本与静态资源哈希。源码、环境配置和数据迁移独立管理。

## 运行拓扑

| 项目 | 值 |
| --- | --- |
| 运行目录 | `/opt/njuredcross` |
| 服务 | `njuredcross.service`（systemd） |
| 反向代理 | Nginx，终止 HTTPS |
| 发布记录 | `/var/lib/njuredcross-deploy/release.json` |
| 照片目录 | `/var/lib/njuredcross-evidence` |
| 运行状态目录 | `.write-state`（邮件、物资、写锁、`jobs.sqlite` 队列） |

当前典型环境为单个 Node.js 服务、systemd 和 HTTPS 反向代理。完整 Node 服务默认监听所有网卡，部署时通过防火墙/代理限制直接访问；仅界面 preview 绑定回环。身份使用私有 Base，生产设置 `NODE_ENV=production`，启用 HTTPS/Secure Cookie。

判断运行版本以 `release.json` 为准，它记录提交号、变更文件与全部运行文件哈希。服务器上的 Git HEAD 单独不足以证明运行代码版本：运行目录由发布树复制加增量更新而来，HEAD 只反映历史部署动作。核对时把 `release.json` 与运行文件哈希一起看。

`/api/health` 受保护：匿名访问返回 401 是接口边界，判断服务是否可用请连同 `systemctl status` 与页面实际响应一起看。

## 发布流程

1. 选定提交，记录服务器当前文件和差异，备份配置、待替换文件及必要数据。
2. 使用匹配的 Node 版本和 `npm ci --ignore-scripts`，完成 `verify` 和依赖审计。
3. 在隔离环境核验 SMTP、SeaTable、NJUBox 与业务流程；依赖重大升级尤其需要集成验证。
4. 如需迁移，先预览、验证 UUID 和列类型、备份，再按工具执行并检查结果。
5. 替换审核后的文件；后端和依赖变化需重启进程，静态文件按请求读取。
6. 检查服务状态、实际版本、HTTPS、公开接口、会话与权限；核对资源哈希。
7. 记录结果与可恢复的前一版本。业务验收失败时执行对应回滚，不把推送当上线。

## main 自动部署

Owner 可直接推送 main；其他开发者继续使用主题分支和 PR。main 的删除与强推规则适用于所有人。GitHub Actions 的 `Deploy main to production` 任务在六类质量检查全部通过后运行（Node 22/24/26 × Linux/Windows 共六组）；较旧提交若已被更新的 main 替代，由最新提交部署其全部累计变更。

`scripts/package-release.py` 只打包已跟踪的运行源码（server.js、package/lockfile、lib JavaScript、public 资源），排除隐藏文件、.env、数据库和生产日志。服务器通过独立且限于部署命令的 SSH 密钥接收；主机公钥固定校验，不关闭 SSH 主机验证。密钥保存在 GitHub Actions 加密 Secrets 中，生产 NJUTable Token 不上传到 GitHub。

接收器 `scripts/receive-release.py` 安装在 `/usr/local/sbin/njuredcross-ci-deploy.py`，校验路径、压缩包、文件哈希与 JS 语法，仅替换发生变化的文件。每次备份在 `/opt/njuredcross-backups/main-*`；部署状态与完整运行文件哈希记录在 `/var/lib/njuredcross-deploy/release.json`。只删除上一次部署明确管理、而新提交已移除的运行文件。前端变更无需重启；后端变更重启服务；依赖变化执行 `npm ci --ignore-scripts --omit=dev`。

部署后检查 systemd、HTTPS 页面、运行文件哈希和 .env 未变化。失败恢复已替换文件、依赖和服务，部署状态不前移。此代码回滚不涉及数据库，也不撤销外部业务操作。照片、私有 Base 和环境配置始终独立保留。修改服务器接收器或轮换部署密钥时，需要由 Owner 显式维护外部安装文件和 Secrets。

本地验证接收器：`python3 -m unittest discover -s tests -p '*_test.py'`。查看发布状态：GitHub Actions 的部署任务，以及服务器上的 `release.json`。

## 连接重置与加载超时

不要把浏览器 `ERR_CONNECTION_RESET` 直接等同于 Node 崩溃或 NJUTable 故障。先对齐客户端故障时间，再核对 systemd 重启、内核 OOM、Nginx 上游错误、TLS 连接和 API 耗时。
2026-10-13 晚间排查时，2 核主机负载约 0.02，可用内存约 294MiB，Swap 未使用，根分区使用 22%；未发现该窗口内的崩溃或 OOM。本机应用约 2ms、本机 HTTPS 约 68ms，公网采样约 1.1–3.6s。这是单点样本，不是 SLA，不能证明所有客户端链路正常。

原 Nginx 仅启用 HTTP/1.1。`ops/nginx/njuredcross-site.conf` 与 `ops/nginx/njuredcross-timing.conf` 提供 nginx 1.24 的 HTTP/2 和分段耗时配置，独立于应用自动部署，不能未经审阅覆盖其他站点配置。
操作前备份站点配置；先安装 `conf.d` 下的日志格式，再安装站点，运行 `nginx -t` 后平滑 reload；测试失败恢复备份。不要关闭 TLS 校验。
本次原配置保存在服务器 `/opt/njuredcross-backups/nginx-20261013-connection/site.before`。回滚需恢复站点文件、移走本次新增的 timing 配置，再检验、reload。

新日志 `/var/log/nginx/njuredcross-timing.log` 记录路由类别、状态、协议、字节数、总耗时及上游耗时，不记录账号、IP、Cookie、查询参数、正文或业务行 ID；沿用 Nginx 每日轮转、14 份保留策略。

- 总耗时高但上游低：检查客户端接收、公网出口和链路。
- 上游耗时高：结合 API 排查身份源、业务 Base 和应用读取链。
- 499：客户端中止，不能单独判定服务端崩溃。
- 浏览器失败且日志无对应完成请求：检查 DNS、TLS、代理和网络路径；尚未完成的请求也可能未写日志。
- CPU/内存长期饱和才优先升级计算规格；公网带宽、突发型 CPU 积分和依赖服务瓶颈需分别核实，升级 CPU 不等于升级公网带宽。

前端只读 GET 在连接中断、响应不完整和 502/504 时最多重试一次，两个尝试共享 12 秒上限。401/403、业务冲突及业务写入不通过此机制重试。持续故障仍显示可重新加载的错误，不将其伪装成空表。

## 全链路耗时诊断

生产环境默认启用 `PLATFORM_TELEMETRY`（显式 `false` 关闭）；非生产需显式 `true`。JSON 日志写标准输出，由 `njuredcross.service` 的 journald 接收，不新增第三方上报服务，不写 NJUTable。journal 保留量由主机配置管理，排障前应核实剩余磁盘和保留策略；Nginx timing 日志另按既有 14 份日轮转。

- `http`：所有入口的脱敏路由、方法、状态、总耗时、断开标志、活动请求数、依赖次数/累计耗时。返回 `X-Request-ID`，Nginx 配置同步更新后亦记录该 ID。
- `dependency`：SeaTable SDK 请求（包括认证）、SMTP、NJUBox、OSS、外部内容、队列等待、密码计算及后台任务分类。默认最多 10000 条诊断记录/分钟/进程，丢弃数量进入下一条 runtime；并行调用的累计耗时可能大于请求墙钟耗时，不要相减计算网络时间。
- `browser`：共享 JSON API 边界的完成耗时、失败类型、服务端请求 ID 与每次尝试独立的 clientTrace。超过 1 秒及错误尝试优先上报，快速成功抽样 5%，每标签最多 20 条/分钟；写入仍只执行一次，日志不会自动重发业务操作。文件下载、原生导航、渲染耗时不在该浏览器指标内，服务端仍覆盖所有入口。
- `runtime`：每 30 秒输出 RSS/堆内存、进程 CPU、事件循环 p95/max、活动请求数与日志丢弃量。CPU 百分比按单核计，可能超过 100%。

Fetch-only 适配器标为 `headers`，只计响应头到达时间，读取正文仍包含在外层 HTTP 耗时中；SeaTable/有界外部请求计至正文消费完成。共享请求、缓存和后台任务可能没有一一对应的 HTTP 父请求；不能把重复利用的依赖计成每位用户一次调用。HTTP finish 代表应用已交给传输层，不证明浏览器已完整收到。

浏览器上报端点 `/api/telemetry/client` 仅 POST、同源、2KB、3 秒读取预算、按 IP 每小时 12000 次限制，并受全局日志限额控制。客户端数据标为不可信，严格白名单取字段；不得据此更改业务状态。跨站、超限和非法格式被拒绝；日志写入失败不得使报名、审批或读取失败。新日志不含 Token、Cookie、邮件正文、学号、邮箱、原始查询参数、文件名或 SDK 异常正文。旧业务审计记录保持独立。

在本地仓库目录排查最近半小时（时间按服务器本地时区确认；汇总脚本不包含在生产运行包内）：

```bash
ssh -S /private/tmp/njuredcross-config.sock root@47.82.5.176 "journalctl -u njuredcross --since '30 minutes ago' -o cat --no-pager" | node scripts/summarize-telemetry.mjs
```

汇总脚本只接受已知诊断结构，最多统计 100000 条，不回显其他应用日志；输出各路由/服务 p50、p95、max 和失败数。浏览器抽样/限流统计不能直接作为全站错误率，压测报告应使用请求发生端的完整计数。

关联顺序：浏览器 clientTrace → HTTP clientTrace/requestId → dependency requestId → Nginx requestId。未收到响应头时浏览器没有 requestId，仍可按 clientTrace 查应用入口；连应用入口日志都没有时检查 DNS/TLS/代理/传输路径。新增 nginx requestId 格式需单独备份配置、`nginx -t`、reload，应用发布不会替换 `/etc/nginx`。

会议缺陷分类与后续验收见 [活动反馈待办](ACTIVITY_FEEDBACK_BACKLOG_2026-10-13.md)。

## 回滚和故障

代码回滚恢复上一版本文件与 lockfile，再重启验证。数据/Schema 回滚必须按迁移备份处理；代码回滚不会自动撤销表结构或写入。备份含凭据/个人信息时限制访问、加密保存并验证恢复过程，不进入源码仓库。

认证失败先区分平台会话、权限/CSRF 和 SeaTable 短期访问 Token；连接工厂会在有效期前刷新。资料源故障应检查私有保存与待同步状态，禁止通过更换资料行绑定来绕过冲突。

## 持续运营


上线前明确服务负责人、故障响应、数据访问审批、日志保留与清理、
备份恢复演练、凭据轮换和业务高峰容量。

审计写入仍可能失败，受保护的状态接口提供进程内统计。
可选持久化核对默认关闭；启用后保留加密凭据，
通过远端证据确认结果，不自动重复写入不确定的记录。

邮件使用本地持久化发送状态与安全通知重试队列。
历史记录读取失败或不完整时停止相关发送判断；
SMTP 结果不确定的任务需人工核对，不能保证恰好投递一次。

同机共享写入协调已经覆盖参与的服务任务和维护脚本，
但不保证跨服务器协调。多实例部署前仍须核验会话撤销、
限流、后台任务唯一执行、外部写入者及跨表一致性。

报名通知额外使用持久化任务，发送结果不确定时停止自动重试，详见 [报名名额与通知](REGISTRATION_OPERATIONS.md)。

后台副作用（报名确认、请假结果、审批提醒对账）进入 `.write-state/jobs.sqlite`，
由进程内 worker 按租约执行，失败退避重试，重启后继续。检查方式：

```bash
ssh -S /private/tmp/njuredcross-config.sock root@47.82.5.176 \
  "sqlite3 /opt/njuredcross/.write-state/jobs.sqlite \
   'SELECT status, COUNT(*) FROM jobs GROUP BY status;'"
```

`failed` 表示已用尽重试次数，需要人工核对业务结果后再决定是否重新入队；
不要直接改 `queued` 绕过业务校验。队列并发由 `PLATFORM_QUEUE_CONCURRENCY`
（1–4，默认 2）控制；停机时在途任务会被立即放回队列，重启后重新执行。
状态接口 `GET /api/health`（需要 `settings` 权限）返回 `runtime.queue` 与
`runtime.cache` 计数。设计边界见 [读缓存与后台队列](CACHE_AND_QUEUE.md)。

## 管理端响应优化（2026-10-17）

管理端切换页面此前要 1.6–3.8 秒，原因是热路径绕过展示缓存。改动集中在四处，
都不改变业务语义：

1. `lib/events/organization-authority.js`：权限证据接入带表标签的展示缓存，
   写请求仍在展示缓存之外直读权威源。
2. `server.js`：会话账号行（仅展示读）与组织目录加短期快照；新增后台任务让路。
3. `lib/events/workflow-api.js`：新增 `GET /api/volunteer/workflow/workspace`，
   一次返回目录与选中活动详情。
4. `public/app/console/pages/activity-center.js`：改用聚合端点；`public/app/core/api.js`
   给控制台 overview 与活动工作区加前端共享缓存，导航悬停时预取。

### 逐个关闭（不需要回滚代码）

在 `.env` 里把对应窗口设为 `0` 即回到逐请求直读，可逐个验证是哪项在起作用：

| 变量 | 默认 | 关闭后 |
| --- | --- | --- |
| `PLATFORM_AUTHORITY_CACHE_MS` | `3000` | 每个请求整表读活动表 |
| `PLATFORM_ACCOUNT_REFRESH_MS` | `5000` | 每个请求重读会话账号行 |
| `PLATFORM_DIRECTORY_CACHE_MS` | `60000` | 每次目录请求重读账号与组织档案 |

前端聚合端点失败会退回 `/catalog`，因此后端可以先于前端单独发布。

### 核对效果

对比同一操作在改动前后的 SeaTable 依赖次数与耗时（同一条 `requestId` 下的
`dependency` 记录）：

```bash
ssh -S /private/tmp/njuredcross-config.sock root@47.82.5.176 \
  "journalctl -u njuredcross --since '30 minutes ago' -o cat --no-pager" \
  | node scripts/summarize-telemetry.mjs
```

关注 `dependency seatable /api/volunteer/workflow/catalog`（现为 `workspace`）的
次数与 p95：命中缓存时该路由不应产生新的整表读取记录。

## 当前试点与照片

当前运行状态见 [线上部署现状](PRODUCTION_BASELINE.md)。试点开启不等于正式历史迁移，写入始终受指定测试 UUID 门禁约束。照片目录须单独受保护备份并验证恢复；发布、回滚和 `npm ci` 都不覆盖它。


制作源码包排除`._*`、`.env`、node_modules、私有备份、照片与原始QA数据。只有源码包清单与运行文件哈希一致时才能报告代码一致，不以Git HEAD或服务active代替。

## 后端可靠性优化交接

本地验证范围、新增私有状态、配置要求和回滚限制见
[后端交接清单](BACKEND_RELIABILITY_HANDOFF.md)。
发布前按实际服务器环境逐项确认，未勾选项不代表已验收。

## 合成备份恢复验证

临时数据库、会话撤销文件及照片的恢复测试范围见
[合成备份恢复演练](BACKUP_RESTORE_SYNTHETIC.md)。
这些测试不替代生产备份恢复和远端状态核对。

制作源码包排除 `._*`、`.env`、node_modules、私有备份、照片与原始 QA 数据。代码一致的判据是发布包清单与 `release.json` 中的运行文件哈希逐一对上。

## CI/CD 检查与协作者通知

`Project verification` 在 main 推送、PR、手动触发及北京时间每天 05:17 运行。
开发分支先开 PR（可为 draft）以获得检查；避免同一提交同时由 push 和 PR 重复检查。
Owner 可直接推送 main，但生产部署仍必须通过 `Quality gate`。

- Node 22/24/26 × Linux/Windows：模块与文档链接、具名 ESM 导入、ESLint、权限/账号/业务回归及依赖审计。Node 26 已纳入正式门禁。
- `Release safety`：发布/回滚测试，以及实际包的隔离依赖安装、图片/二维码/XLSX 编码、启动资源、CSP、缓存、路径和哈希验证。
- Chromium 桌面与手机全量回归，以及 Firefox/WebKit 的关键路径测试，均使用内存合成服务器。
- 三个时区运行完整业务回归；HTTP 基础层按行 90%、分支 80%、函数 90% 阈值把关并上传报告。
- 六类全部成功才通过 `Quality gate`。main push 随后部署，每日与 PR 不部署。
- 发布接收器核对服务及所有文件哈希后，CI 再运行只读公网冒烟（页面、资源、公开 API、匿名权限边界），单请求限 30 秒。此后置检查失败会把发布标为失败，需要排查或按前文回滚，不自动撤销数据库操作。
- 浏览器失败截图、trace、JUnit 和 HTML 报告保留 7 天；覆盖率报告保留 14 天；部署回执保留 30 天。
- 服务重启后允许短暂启动等待，接收器检查持续失败仍触发文件回滚，不覆盖生产 `.env`。

[CI/CD 状态议题](https://github.com/WANGLEVY9/NJURedCross/issues/7) 集中汇总每次运行的所有阶段，并提及全部协作者。
`CI result distribution` 仅在已完成的 `Project verification` 后运行；读取可信 main 的通知代码，不执行 PR 代码、不读取 PR artifacts，不使用生产凭据。
每个 run ID 与 attempt 只分发一次。重跑会形成新的结果记录；取消也如实呈现。

仓库 Actions variables `CI_STATUS_ISSUE` 为状态议题编号，`CI_COLLABORATORS` 为逗号分隔的 GitHub 登录名。
新增或移除协作者时，Owner 需同步更新名单；当前包含全部 10 位协作者。
GitHub 站内通知通过 @mention 分发；邮件是否送达由每位协作者自己的通知设置决定，不能由仓库强制开启。
通知工作流失败时可重跑其任务，去重标记防止重复发送。

其他开发者合入 main 前必须通过 `Quality gate`，并满足既有 PR 审核规则；Owner 的既有管理员豁免不变，main 禁止强推与删除。
