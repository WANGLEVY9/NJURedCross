# 管理端读路径优化（2026-10-17）

## 问题

展示缓存（`be33e7d`）上线后，管理端切换页面仍然需要 30–60 秒的体感，活动管理页
尤其明显。

## 线上证据

90 分钟遥测（北京时间 14:18 那次活动管理加载）：

| 请求 | 服务端耗时 | 说明 |
| --- | --- | --- |
| `GET /api/volunteer/workflow/catalog` | 1624.94 ms | 4 次 SeaTable 依赖：665 / 446 / 659 / 222 ms |
| 同一请求的浏览器上报 | 3083 ms | 客户端比服务端多 1.4 秒 |
| `GET .../events/:id/detail` | 685.86 ms | |
| `GET /api/volunteer/workflow/:id` | 896.7 ms | |
| `GET /api/volunteer/workflow/directory` | 1812–3767 ms | 4 次采样 |

服务端单请求在 0.2–3.8 秒区间，**不存在 30–60 秒的服务端延迟**。日志里还出现一次
56 秒的零请求空档，说明体感时间有一部分发生在浏览器侧（标签节流或主线程阻塞），
这部分需要浏览器 Network/Performance 证据才能定性，本轮不处理。

## 根因

管理端最热的路径显式绕过了缓存：

- `readAuthorityEvents()`：每个 workflow 请求整表分页读一次「网站活动流程表」，
  注释当时写明「deliberately bypasses all display caches」；
- `catalog()` / `detail()` 收到 `authority.events` 时走 `loadEventRows()` 旁路，
  不再经过 `eventRows()` 的展示缓存；
- `eventDirectory()`：每次整表读账号表，再按 50 个一批查组织档案；
- 每个 API 请求还会重读一次会话账号行（`server.js` 的会话回填）。

结果是「一次页面切换 = 6–8 次整表分页读取」，5 秒 TTL 的缓存对这些路径完全无效。

## 改动

| 位置 | 改动 | 语义边界 |
| --- | --- | --- |
| `lib/events/organization-authority.js` | `readAuthorityEvents()` 走 `displayRead`，表标签为「网站活动流程表」 | 展示读复用 3 秒；写请求不在展示上下文内，仍直读权威源 |
| `server.js` | 会话账号行 5 秒复用（仅 GET/HEAD）、组织目录 60 秒快照 | 写请求与登录流程直读权威源 |
| `lib/events/workflow-api.js` | 新增 `GET /api/volunteer/workflow/workspace?event=<id>` | 按权限过滤目录与详情；无 event 时不返回 detail |
| `public/app/console/pages/activity-center.js` | 改用聚合端点，提取 `mergeDetail()` | 端点不存在时退回 `/catalog` |
| `public/app/core/api.js` | 控制台 overview 与工作区加前端共享缓存；新增 `prefetchRead()` | 写操作后统一失效 |
| `public/app/console/shell.js` | 导航悬停/聚焦预取活动工作区与概览 | 只覆盖回源最贵的模块 |
| `lib/background/idle-gate.js`（新增） | 后台任务让路 | 积压超时强制执行，不会饿死 |
| `server.js` 定时器 | 能力探测、空缺提醒、通知对账、生日投递统一让路；公共快照预热 10 秒 → 30 秒 | 与「10 秒新鲜 + 20 秒陈旧」窗口匹配 |

## 验证

- 新增单测 9 项：`tests/authority-read-cache.test.mjs`（3）、`tests/idle-gate.test.mjs`（3）、
  `tests/workflow-workspace.test.mjs`（3）。
- `npm run check`：832 个模块、147 篇文档，0 错误。
- `npm run lint`：通过。
- `npm test`：2029 项，2027 通过，0 失败（2 项跳过为既有）。
- `tests/request-path-http.test.mjs` 同步补充了 `backgroundGate` 依赖：该测试把
  server.js 的 HTTP 入口源码放进 vm 执行，入口新增依赖需要同步声明。

## 未做

- **本地读模型（SQLite 物化视图）**：`readPagedRows` 每次 1000 行分页串行读仍是
  446–665 ms 的来源。但它要求先解决变更感知（NJUTable 没有可靠变更流），且会让
  报名名额与审批建立在可能过期的副本上，与 [`读缓存与后台队列`](../docs/CACHE_AND_QUEUE.md)
  里「不做本地读模型」的边界冲突。因此本轮只做到「减少读取次数」，没有改变
  「读到的一定是权威源」这一定性。要做的话需要先单独设计变更捕获与对账。
- **写请求内的读取合并**：写操作必须读权威源是安全底线，同一请求内重复读同一张
  表理论上可以合并（authority 已读一次，business 再读一次），但会影响大量既有
  断言，留待单独一轮。
- **浏览器侧 30–60 秒**：需要 Network/Performance 证据定位，本轮没有改动前端渲染。
- **HTTP/2 仍未上线**：`ops/nginx/njuredcross-site.conf` 已备好，但按
  [运维](../docs/OPERATIONS.md) 的流程需要单独备份、`nginx -t`、reload，不属于代码发布。

## 边界

改动不触碰权限判定逻辑本身：判断依据始终是活动行与账号行，缓存只是复用同一次
读取的结果。账号与权限变更在下一次**写操作**上立即生效；展示读最多落后
`PLATFORM_ACCOUNT_REFRESH_MS`（默认 5 秒）。三项缓存都可以用环境变量设为 `0`
单独关闭，不必回滚代码。

本轮没有引入 Redis，也没有新增依赖。
