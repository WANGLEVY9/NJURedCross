# 链路观测与保留策略

平台沿用浏览器上报、Nginx timing 日志和应用结构化日志。部署初期用这些现有组件排查，不另起采集服务。结构化记录描述操作类型、耗时、结果和关联号，禁止保存业务数据本身。

| 环节 | 可查证据 | 关联方式 |
| --- | --- | --- |
| 浏览器加载 | 会话等待、页面模块、渲染、导航、慢静态资源 | 脱敏路由、阶段、时间窗口。导航结束表示页面结构已挂载，异步数据仍看对应 API |
| 浏览器请求 | JSON、二进制响应、XHR 上传、超时与中断 | 同源请求用 `clientTrace` 和返回的 `X-Request-ID`。直传云盘只上报固定类别和结果 |
| Nginx | 请求总耗时、上游耗时、连接耗时、状态、字节数 | 有上游响应时用 `requestId`，静态资源另按类别和时间排查 |
| 应用 | 每条 HTTP 请求、结果、用时、中断和依赖数量 | `requestId` 同时是服务端 Trace ID |
| 数据流转 | 已接入适配器的 NJUTable、邮件、云盘、存储和队列等待 | `traceId`、`spanId`、`parentSpanId`。并行依赖耗时可能重叠 |
| 后台任务 | 已包裹的同步、对账和投递任务及其依赖 | 无 HTTP 上下文时，顶层任务生成独立 Trace ID |

浏览器连续上报上限为每标签每分钟 20 条，低于 1 秒的成功记录抽样 5%，慢请求和失败优先进入发送条件。整个应用每分钟最多写 10,000 条结构化记录，runtime 记录包含丢弃数量。浏览器记录标记为不可信，仅用于诊断。禁止记录完整 URL、查询字符串、Cookie、凭据、正文、学号、姓名、文件名、SQL 和第三方错误原文。禁止用浏览器自报结果决定业务状态。

浏览器 Resource Timing 只能看到浏览器给出的已完成资源记录。目前按时间和类别诊断静态资源，不能精确拼成单条 API Trace。SPA 导航与其后发起的请求、历史裸调用、原生下载和未接入适配器的调用仍有覆盖缺口。排障时若没有关联号，可先用窄时间窗口比对路由类别，再为确认缺少的环节补固定阶段。

## 日志存储

应用的 `LogNamespace=njuredcross` 把后续应用日志写到独立 journal。配置为目标保留 7 天、总量上限 256 MiB、单文件上限 32 MiB、每天滚动。空间压力可能提前淘汰旧归档，当前写入文件的轮转会影响实际回收时点。生效后用 `journalctl --namespace=njuredcross` 读新日志。此前共享 journal 中的记录按主机原策略回收，Nginx timing 日志沿用每日轮转和 14 份保留。业务审计与持久化任务数据库不使用此清理策略。

首次安装将仓库的 `ops/systemd/journald@njuredcross.conf` 和 `ops/systemd/njuredcross.service.d/telemetry.conf` 分别放入 `/etc/systemd/` 和该服务的 drop-in 目录。执行 `systemctl daemon-reload` 后随下一次应用发布重启生效。通过 `systemctl show njuredcross -p LogNamespace`、`systemctl is-active systemd-journald@njuredcross` 和下列有界查询核验。回滚时移除该 drop-in、重新加载 systemd，并随发布重启；仍可按 namespace 查询已保留日志。

```sh
ssh njuredcross "timeout -k 2 10 journalctl --namespace=njuredcross -u njuredcross --since '15 minutes ago' -n 2000 -o cat --no-pager" | node scripts/summarize-telemetry.mjs
ssh njuredcross "timeout -k 2 10 journalctl --namespace=njuredcross -u njuredcross --since '15 minutes ago' -n 2000 -o cat --no-pager" | node scripts/read-telemetry-trace.mjs <UUID>
```

## 新增及改动的质量门禁

- 新增接口经统一 HTTP 入口。前端复用 `request`、`requestBlob` 或已观测的上传入口。外部 HTTP、数据库和后台任务使用已有依赖适配器或 `observer.dependency`，计时覆盖实际消费响应的阶段。
- 对会影响用户等待的新阶段使用固定名称。和接口行为一起验证成功、失败，适用时验证超时或取消。对外上报字段必须脱敏并可关联。重复刷新、页面切换和后台并发时核对记录量。
- CI 拦截已识别的新增裸传输调用，并运行真实 HTTP 上报边界、关联、限额和脱敏测试。这些检查进入发布质量门禁。现有历史例外有固定数量上限，新增覆盖由代码审查核对测试和阶段定义。自动检查不能判断业务语义是否完整，新增或改动的链路需在变更说明中列出对应验证。
