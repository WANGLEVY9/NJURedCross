# 读缓存与后台队列改造（2026-10-17）

## 问题

业务数据都在 NJUTable（SeaTable）。每次控制台打开、切页、刷新，服务端都要向
远端表服务发起多次分页整表读取；一次渲染常见 3–8 张表，每次 0.5–2 秒，
等待时间叠加。写入侧更糟：任意一次成功写入都会清空全部展示缓存，批量审批时
每条记录都要重建整表读取。请求内的重活（报名通知对账、结果邮件）也还在
链路里，SMTP 失败只能打日志，进程重启后事件就丢了。

## 结论与取舍

单进程 + 单机部署下：

- **进程内缓存优于外部缓存**：命中路径没有网络往返和序列化，延迟最短。
  引入 Redis 会多一个进程、多一份内存和一条故障链，命中反而更慢；
  主机可用内存约 300MiB 量级，不划算。
- **需要持久化的只有队列**：副作用要能重启后继续、去重、退避重试。
  本地 SQLite 已经是仓库既有选择（写锁、收件凭证、邮件重试），运维面零新增。
- **不做本地读模型/整表镜像**：NJUTable 没有可靠变更流，外部直接改表无法
  及时感知；报名名额与审批不能建立在可能过期的副本上。

## 改动

### 缓存

- `lib/cache/service.js`：单飞合并、TTL、有界陈旧窗口、标签失效、容量上限、
  命中统计。失败不缓存，也不会把失败写成空表。
- `lib/cache/write-tracker.js`：请求级写表记账；SeaTable 客户端代理只记录
  `updateRow`/`appendRow`/`deleteRow`/`batch*` 的表名，不改返回值、不吞异常、
  保留原实例 `this`。
- `lib/http/display-reads.js`：新增 `invalidateDisplayReads(tables)`，
  只丢弃打有这些表标签的投影；`clearDisplayReads()` 保留为整体失效。
- `server.js`：`listAllRows`、`workflowRows`、`eventRows`、`scopedRows` 带上
  表标签；请求返回前按写表记录失效；公共快照按依赖表级联丢弃
  （工作流表 → 目录/首页，活动项目表 → 目录/首页，工位物资表 → 首页）；
  失效失败退化为整体清空，最坏只陈旧到 TTL，不会把已完成的响应变成错误。
- 扩大只读 GET 共享范围：名单、岗位、负责人、邮件状态、导出预览、时长审核、
  出勤明细、门户「我的报名」在 5 秒窗口内共享同一次读取。

### 队列

- `lib/queue/store.js`：SQLite（WAL）`jobs` 表，去重入队、`BEGIN IMMEDIATE`
  事务领取（并发下不重复执行）、退避重排、租约回收。
- `lib/queue/runner.js`：单进程有界并发 worker；任务自带请求预算，不被触发
  它的 HTTP 请求取消；失败 `15s × 2^(n-1)`（上限 15 分钟）退避。
- `server.js`：报名确认、请假结果、审批提醒的对账与发送从 `setImmediate`
  迁到持久化队列；入队失败只降级告警，不把已成功的业务写入报告为失败；
  停机时先停止领取再把在途任务放回队列。
- `PLATFORM_QUEUE_CONCURRENCY`（1–4，默认 2）。

### 观测

`GET /api/health`（需要 `settings` 权限）新增 `runtime.cache`
（命中/陈旧命中/未命中/加载/淘汰/条目）与 `runtime.queue`
（queued/running/done/failed、最老排队时间、worker 计数）。

## 不变式（没有放松的地方）

- 缓存里只有 NJUTable 行投影，没有鉴权结论、会话、响应体或令牌。
- 校验会话/权限、执行写入的代码都在 `withDisplayReads()` 之外，读到当前值。
- 身份库读取一直走 `readPagedRows`，不经过展示缓存。
- 写后可见性上界 = 投影 TTL（展示读 5 秒，公共快照 10 秒 + 20 秒陈旧窗口）。
- 队列只承载副作用；业务写入成功后才入队。

## 验证

- 新增 `tests/cache-service.test.mjs`、`tests/display-invalidation.test.mjs`、
  `tests/job-queue.test.mjs`（共 17 项）：标签失效、陈旧窗口、容量、去重入队、
  事务领取、崩溃回收、退避与死信、worker 停止。
- `npm run check`、`npm run lint` 在我的改动范围内通过；单元套件 2011 项通过。
- 本地启动冒烟：服务正常启动，`/api/public/overview` 200。

## 上线核对（be33e7d，2026-10-17 12:10）

- `/var/lib/njuredcross-deploy/release.json` 记录提交 `be33e7d`，
  运行文件含 `lib/cache/*`、`lib/queue/*`、`server.js`；服务于 12:10:18 重启后 active。
- 运行状态目录 `/var/lib/njuredcross/write-state/jobs.sqlite` 已建立，当前无积压任务。
- 线上 `https://njuredcross.cn`：`/` 200、`/events` 200；`/api/public/overview`
  冷读约 0.99s（7 次 SeaTable 读取，单次 220–980ms），同一窗口内后续请求 6.6ms
  且不产生任何 SeaTable 依赖记录；`/api/public/workflow/events` 0.02s。
- `/api/health` 匿名 401 是既有接口边界；启动后 journald 无 error/unhandled 记录。

## 未完成

- 名单邮件批量投递、时长入账镜像仍在请求链路内，迁移需要单独的结果语义设计。
- 不缓存鉴权结论；不做跨进程共享缓存（多实例前需重新设计）。
## 提交范围

改造前工作区中另一会话正在做「审批结果邮件」，一度把 `server.js` 的 lint 打断
（`notifyRegistrationDecisions` 未定义）。该会话随后移除了 `server.js` 里的接线，
但其残留物（`lib/events/decision-mail.js` 无人引用、未完成的 `rejectionMessage`
与 `notifyDecisions`）不属于本次任务，按仓库约定未一并提交，留在工作区由对应
作者决定：`lib/events/decision-mail.js`、`lib/events/workflow-api.js`、
`lib/events/registration-notifications.js`。
