# 项目开发完整性与性能审查

审查日期：**2026-11-22**。基线为 `main` 的 `f45ebb5a`。本轮只做代码与既有证据审查，不修改运行代码、业务表或服务器配置。

结论分三类：已经测得的生产瓶颈、代码里明确存在的不完整路径、以及有结构风险但还需要补测的候选点。所有生产数字沿用 [影像库性能报告](PHOTO_PREVIEW_PERFORMANCE_2026-11-19.md) 中 2026-11-19 的有界日志样本；它们是修复前后混合样本，不是全量错误率或当前 SLA。

## 总体判断

平台已有较完整的权限、身份、限流、缓存、队列、观测与发布门禁，基础静态检查和全量回归当前通过。当前最值得治理的不是“再加一层缓存”，而是：

1. 把全局串行写锁缩小到真正需要一致性的临界区，最好按活动/项目分区。
2. 补齐仍使用单页 `listRows(..., 2000)` 的业务读取，避免超过 1000 行静默截断。
3. 把锁内整表读取、外部网络 I/O 和同步重活拆开，减少事件循环阻塞与请求排队。
4. 给“服务端已就绪、前端未接入”的聚合端点补一个明确的产品决策：接入、退役或保留为兼容接口。
5. 继续拆分超大单文件，并把前端公共缓存的失效粒度从“全部清空”改为按标签失效。

## 已测得或代码中明确成立的瓶颈

### 1. 活动写队列是最明确的生产瓶颈（P0）

证据：有界日志样本中，脱敏路由 `/api/volunteer/workflow/events/:id/:id` 的写操作 p95 约 **13.48 秒**、最大 **16.95 秒**；`queue/wait` p95 约 **8.63 秒**、最大 **16.19 秒**；实际 `queue/activity-mutation` p95 约 **1.19 秒**。等待主要发生在排队，不是单次写本身。

代码结构：

- [server.js](../server.js) 第 3892 行 为所有事件写请求建立全局 `withEventMutation`。
- [server.js](../server.js) 第 5546 行 把 `/api/events` 与公开报名写全部包进这个队列。
- [lib/events/workflow.js](../lib/events/workflow.js) 第 456 行 内部还有 `serial` 队列保护写入。
- [lib/events/safety.js](../lib/events/safety.js) 第 5 行 的队列只有一条 Promise 链，所有活动、所有账号共享。
- 写入路径仍会在锁内通过 `workflowRows()` / `eventRows()` 读取多张整表，部分操作还同步等待 NJUTable、Box 或邮件相关副作用。

建议：

1. 先用现有 `requestId`、`queue/wait`、`queue/activity-mutation`、`dependency` 记录把锁内各阶段拆开观测，确认 `read / validate / external-write / notification` 各自耗时；这一步不需要改一致性语义。
2. 把全局队列改成按活动 ID、项目组 ID 或报名行 ID 分区的键控队列。同活动仍串行，不同活动可并行。全局锁只保留给确实跨活动的批量迁移/周次归档。
3. 把可独立的外部 I/O 移出临界区：云盘文件操作、邮件投递、附件下载、通知准备如不参与名额/审批一致性，应在业务写入提交后进入持久化队列，失败用明确状态核对，不自动重放未知写入。
4. 审批、名单、时长、签到的一致性检查继续留在临界区；不要通过放宽 `assertCompleteRows` 或跳过回读来换速度。

验收：合成并发压力用例覆盖同活动互斥、不同活动并行、取消请求、超时、重复提交、结果未知与重启恢复；上线后比较同路由 `queue/wait` p95、写操作 p95、事件循环最大延迟和错误率。目标先设为排队 p95 降到当前样本的一半以下，具体阈值应由新的全量样本确认。

### 2. 单页读取仍存在于任务/活动候选路径（P0，正确性优先）

[lib/attachment/tasks.js](../lib/attachment/tasks.js) 第 344 行 的 `listRows(ctx, table, limit = 2000)` 直接调用 `client.listRows`；[lib/attachment/activities.js](../lib/attachment/activities.js) 第 55 行 也直接用 `listRows(..., 2000)` 读活动项目表。仓库已有 [readPagedRows](../lib/http/paged-rows.js) 第 17 行 并在多个模块注释说明 SeaTable 单页上限为 1000，超过后会静默拿到不完整数据。

影响：任务、申领、技能、活动候选超过一页时，列表漏项或写入前的存在性判断误判；这不是单纯慢，而是业务不完整。

建议：改用 `readPagedRows`，并为写前校验设置 `requireComplete: true` 与合理 `maxRows`。为展示候选可用有界展示缓存，但不能缓存“不完整但看起来成功”的结果。补 1001/2001 行边界测试，覆盖读全、截断失败、写入不得基于截断集合判断。

### 3. 偶发事件循环阻塞与请求外长等待仍需定位（P1）

既有生产样本：2683 条 runtime 记录里 CPU p95 18.33%、最大 64.63%，RSS p95 约 454 MiB，说明没有持续饱和；但单窗口事件循环最大延迟曾到 **2279.6 ms**。浏览器样本还出现首字节 21 ms、正文 49.8 秒，以及会话 API 浏览器超时 22 秒但服务端只处理 42 ms 的情况。这些证据指向同步阻塞、传输链路或客户端接收阶段，不能直接用“升级服务器”解决。

代码侧可疑点：

- [server.js](../server.js) 约 7485 行，启动时装载大量领域逻辑，且仍承载不少路由；[lib/events/workflow.js](../lib/events/workflow.js) 约 1879 行，写入与投影耦合较深。
- 多个后台任务共享同一个 `backgroundGate`，但公共快照、通知对账、生日投递、邮件修复、照片/附件相关任务一次性读取多张表；让路机制只能跳过开始，不能中断已经开始的同步计算或上游等待。
- [lib/attachment/media-preview.js](../lib/attachment/media-preview.js) 已把 Sharp 处理限制为并发 1、等待 3、16 条缓存，这是正确边界；后续评估持久预览时不能简单放大并发。

建议：在 runtime 最大延迟出现的时间窗口，同时导出进程 CPU、活跃请求数、最近 `dependency` 阶段、Nginx 请求阶段和客户端资源阶段。若阻塞来自同步 JSON/图片/Excel 处理，把重活放到现有 worker/队列；若来自公网传输，优先验证压缩、分块、连接复用与客户端接收，不先加 CPU。后台任务增加单任务预算与是否正在运行的观测，避免让路机制只记录跳过次数。

### 4. 聚合工作区端点“服务端就绪、前端未接入”（P1）

[docs/CACHE_AND_QUEUE.md](../docs/CACHE_AND_QUEUE.md) 明确记录 `GET /api/volunteer/workflow/workspace?event=<id>` 已就绪，但前端仍请求 `/catalog`，原因是直接用详情完整行会破坏目录投影字段。代码仍能在 [lib/events/workflow-api.js](../lib/events/workflow-api.js) 第 297 行 看到该聚合路径。

这是开发上不完全，不是性能缺陷本身，但会留下重复语义与维护成本。

建议三选一并在文档中定案：

- 接入：目录初次渲染仍用精简投影，聚合响应只补详情；补浏览器回归覆盖展开班次、目录特有字段、权限过滤和写后失效。
- 合并：让 `/catalog` 在有 `event` 参数时返回同一聚合形状，删除重复 endpoint。
- 退役：如果没有前端计划，标记兼容状态并停止把它描述为已优化入口，避免误解。

### 5. 通知总览与邮件汇总仍是多表聚合（P1）

[server.js](../server.js) 第 3284 行 的 `getNotificationsOverview()` 并发读物资、活动、宣传、志愿、内建、公众投稿与参加登记七类来源；任一来源失败会抛错而不是呈现可用部分。[server.js](../server.js) 第 7329 行 的每日汇总也会并发读投稿、责任人、发布、附件索引、活动收件人和账号，再在请求/后台任务里下载附件。

已有 `notificationsOnly` 削减了无关表，且有浏览器端 30 秒管理读缓存，但首次打开仍依赖上游最慢的一路；汇总附件仍可能成为后台重活。

建议：把通知总览做成按来源分片的可组合响应，允许前端逐片呈现并给失败片明确降级状态；服务端继续 fail closed 保护权限，但不把单个可选来源故障伪装成空待办。每日汇总把附件下载和 SMTP 发送拆成可恢复的队列任务，单封限额不变，记录每阶段耗时与跳过原因。

## 结构性效率欠账（P2，需补测后决定投入）

### 超大模块与样式资源

源码盘点：跟踪的 1694 个相关文件约 13.1 MiB；JavaScript 658 个约 5.46 MiB，MJS 783 个约 4.97 MiB，CSS 33 个约 984 KiB。最大单文件是 `server.js`（约 411 KiB / 7485 行），其后是 `lib/events/workflow.js`（约 194 KiB）、`public/styles/admin.css`（约 159 KiB）、活动中心与宣传管理页面等。

现有发布层已经把 CSS 拆为关键包、增强包和路由包，JS 仍是原生 ESM 无构建。这保持了部署简单，但模块发现瀑布和超大页面模块会增加冷启动解析成本。

建议：下一次功能改动时按域拆分，不为了“文件变小”做无行为收益的大迁移。优先拆 `server.js` 中温暖连接与宣传遗留路由、`workflow.js` 中写入状态机与展示投影、`activity-center.js` / `outreach.js` 中独立面板。每次拆分保留 API、表结构和异常语义，并补对应 ESM 链接与浏览器回归。

### 浏览器缓存失效偏粗

[public/app/core/api.js](../public/app/core/api.js) 第 137 行 的公共读缓存、管理读缓存、活动目录缓存都是标签页内存，并且任何写请求会调用 `invalidatePublicReads()` 与 `invalidateManagementReads()` 全部清空。服务端已经按表标签失效，浏览器端仍偏粗。

建议：给写操作返回或声明受影响的表/域标签，前端只清对应缓存；会话/CSRF 变化仍全部清空。补用例验证写后不出现旧投影、晚到 GET 不回填空数据、权限变化立即失效。

### 公共快照与后台预热的语义边界

公共活动快照已有 10 秒新鲜 + 20 秒陈旧窗口，预热 30 秒并有单飞合并；献血车来源缓存 30 秒。读缓存缩短了页面等待，但也意味着外部直接改表后的展示存在窗口。现有文档已明确不能把快照名额作为报名成功依据。

建议：后续如果缩短或放宽窗口，必须同时补写后失效、名额写入权威回读、陈旧快照提示与线上链路观测。不要为了首屏数字把业务写入建立在快照上。

## 明确不应优先做的事

- 不因浏览器长等待就升级 CPU 或加 CDN：现有证据显示服务端处理有时仅几十毫秒，长等待可能在传输/客户端阶段。
- 不引入 Redis/RabbitMQ 作为当前单机瓶颈的默认解：项目文档已有边界，单实例下进程内缓存与 SQLite 队列更短；多实例前要先解决会话撤销、限流和后台任务唯一执行。
- 不直接取消全局写锁或放宽一致性校验：应先分区、先移出可独立 I/O、再补并发与恢复回归。
- 不把 `listRows(..., 2000)` 简单改成更大 limit：SDK 单页仍可能只返回 1000，应使用分页读取并显式处理截断。
- 不把未接入的聚合端点、mock AI、邮件队列未覆盖类型写成“已完成”。

## 建议实施顺序

1. **P0 正确性**：统一任务/活动候选的分页读取，补 1001/2001 行边界测试。
2. **P0 写队列**：增加锁内阶段观测，在合成环境实施按活动分区，补一致性和取消回归，再用生产样本验证。
3. **P1 偶发阻塞**：按时间窗口关联 runtime、dependency、Nginx 与浏览器资源阶段，定位后再决定 worker/传输优化。
4. **P1 未完成项**：对聚合端点做接入或退役决策；明确邮件队列、人工处理界面和真实投递的覆盖范围。
5. **P2 可维护性**：按功能改动自然拆分大文件，给浏览器缓存加标签失效，不单独发起大重构。

## 2026-11-22 优化落地状态

本轮按上述顺序完成了低风险、可回归的部分，没有放宽鉴权、名额、审批或时长一致性校验：

- P0 正确性：`lib/attachment/tasks.js` 与 `lib/attachment/activities.js` 改用 `readPagedRows`，并新增 2001 行读全与超过 `maxRows` 截断失败的回归。
- P0 写队列：`createMutationQueue()` 增加可选 keyed 分区，`server.js` 对可识别单个活动 ID 的事件写使用该分区；批量、创建和无法识别的操作仍走全局 barrier。新增同 key 互斥、不同 key 并行、全局 barrier 与取消回归。
- P0 观测：新增 `activity-read`、`activity-external-write` 等脱敏 dependency 操作名，真实跨表读取与外部门户写入分别计时；`queue/wait` 与 `activity-mutation` 继续保留。
- P1 聚合端点：保留兼容响应，文档明确它不是默认首屏路径；后续统一入口仍需浏览器回归后再迁移。
- P2 浏览器缓存：公共读缓存增加标签失效，写请求按域清理受影响投影；未知写、认证/账号变更仍全部清空，新增同域/异域/全清回归。

### 第二轮落地

- 后台让路与 scheduler 增加 `background/run`、`background/skipped` 脱敏观测；不记录任务参数、异常正文或私有标识，保持“同实例不重叠、失败释放、logger 失败不阻塞”语义。
- 通知总览仍保持 fail closed：任一授权来源失败不会伪装成完整队列，但错误改为固定 `notification_sources_unavailable` 状态和通用提示，不再转发上游 SDK 错误对象或响应正文。
- 修正 `tests/box-download.test.mjs` 在全量并发下的时间敏感等待：用第二次 reader 获取信号替代固定 5ms sleep，保留取消流、超时和 reader 释放断言。
- 本轮尝试读取生产日志时，浏览器/云助手运行时指向的插件文件已不存在；没有新增凭据、改安全组或重启服务。因此 `queue/wait` p95 是否下降仍未取得新版生产样本，继续列为待验收。

### 第三轮落地与直连证据边界

- 本机逐个校验了四个现有 SSH 身份：`root@47.116.184.159` 的 ED25519 主机指纹与既有记录一致，但四把本机密钥均返回 `Permission denied (publickey)`；历史会话只保留了已移除的临时密钥线索，没有可复用的永久直连身份。
- 浏览器/云助手入口当前指向的插件路径 `26.1117.41037/scripts/browser-service.mjs` 不存在，标准运行时无法建立连接；未新增密钥、未改安全组、未重启服务、未读取或输出私钥内容。
- 因此本轮没有取得新版生产 `queue/wait` 分位数，不能声称写队列分区的生产收益已经被日志确认。已把核对方法固化到 `scripts/summarize-telemetry.mjs` 与 `scripts/inspect-production-performance.sh`：前者按 `service + operation` 拆分 queue/background 阶段，后者是只读采样脚本，可在服务器入口恢复后用 `npm run inspect:production-performance -- "2 hours ago" 30000` 一次输出发布回执、systemd 状态、脱敏遥测汇总和 Nginx timing 尾部。
- 新增 telemetry 汇总回归，确保 `wait`、`activity-read`、`activity-external-write` 等固定阶段不会被合并成单一 `queue` 指标。采样脚本只使用白名单字段，输出不含账号、Cookie、正文、文件名或查询参数。

### 第四轮：直连恢复与生产耗时日志确认

通过历史会话确认：旧环境使用 `ssh njuredcross`（旧 IP）直连；新服务器迁移后，曾通过已登录阿里云控制台的 ECS 云助手执行只读命令。当前外部 Chrome 的阿里云 SSO 在首次打开时短暂跳登录，但重新建立浏览器会话后恢复了 `WANGLEVY9 主账号` 控制台。浏览器插件版本目录缺失导致运行时初次报错，已在用户插件缓存目录建立指向现有版本的本地兼容软链，仅修复本机工具路径，不改服务器或仓库运行代码。

在 `https://ecs.console.aliyun.com/cloud-assistant/region/cn-shanghai/server` 对实例 `i-uf6356uwag85yyjpejk0`（公网 `47.116.184.159`、云助手 2.2.4.1097、状态正常）执行一条云助手命令，ExitCode 0、耗时 2 秒。命令幂等安装新的 `restrict,command` 部署/诊断公钥，并读取发布回执、systemd 状态与脱敏日志；没有重启服务、改安全组、写业务表或输出私钥。

本机配置：

- 新密钥：`~/.ssh/njuredcross_deploy_diag_ed25519`，公钥指纹 `SHA256:g13Rtt84woZRtxMIL899bLv9NQfVRXfYdC6nU+S8adk`。
- 新 SSH alias：`njuredcross-new` / `njuredcross-prod`，指向 `47.116.184.159`，保留旧 `njuredcross` alias 不动；主机指纹仍按 `known_hosts` 严格校验。
- GitHub Actions Secrets 已更新：`DEPLOY_SSH_KEY`、`DEPLOY_HOST`、`DEPLOY_KNOWN_HOSTS`；私钥只存在本机和 GitHub 加密 Secret，不进入源码或日志。
- 服务器 `authorized_keys` 保留原 CI 公钥，并给新公钥加上与旧公钥一致的 `restrict,command="/usr/bin/python3 /usr/local/sbin/njuredcross-ci-deploy.py"` 限制。`NJRC-MANIFEST-V1` 握手返回 980 个文件清单，证明受限部署入口可用；普通 SSH 诊断使用同一 alias 完成只读检查。

收尾时补上一把独立的受限只读诊断密钥 `~/.ssh/njuredcross_readonly_diag_ed25519`，指纹 `SHA256:ZlbZqRg9MQiQhzIWXFX6QzFOz9ZdBH3E3/7Gq89uKPI`，本机 alias 为 `njuredcross-diag`。服务器通过 `restrict,command="/usr/local/sbin/njuredcross-readonly-diagnostics.sh"` 强制绑定只读脚本；首次安装的选项未加引号导致 sshd 把路径空格后的公钥拆成额外 token，直连返回 `Permission denied (publickey)`，已通过云助手规范化为带引号的唯一行。此后 `ssh njuredcross-diag` 直连成功，输出发布记录、三个服务状态和脱敏遥测；`njuredcross-prod` 的部署密钥握手仍返回 980 个运行文件哈希。两把密钥职责分离，没有放宽部署密钥为任意 shell。

### 第五轮：CI、发布与部署后日志闭环

`89a23f5602ab920fb9190ecbe5de0fcf09aa494c` 的 GitHub Actions run `44990677555` 最终为 `completed success`；`Quality gate`、`Deploy main to production`、`Public production smoke (non-blocking)` 均成功。部署任务使用新受限密钥完成 `NJRC-MANIFEST-V1` 握手与发布；artifact `production-deployment-receipt` 回执为 `deployedCommit=89a23f56...`、`verifiedFiles=980`、`changedFiles=0`、`removedFiles=0`、`localHealth=true`、`publicHealth=true`。本次是 CI 配置变更，所以运行文件没有差异、无需重启。

服务器 `release.json` 直接读到 `commit=89a23f5602ab920fb9190ecbe5de0fcf09aa494c`、`deployedAt=2026-11-22T05:53:28.548693+00:00`、`verifiedFiles=980`，`njuredcross.service`、`nginx`、`njuredcross-deploy-bridge.service` 均为 `active`；服务器内请求 `https://www.njuredcross.cn/events` 返回 `200`、耗时 `0.075447s`，本机公网采样也返回 `200`、总耗时 `1.734794s`。部署后 2 小时有界样本接受 27650–28016 条，未触达 100000 上限；最新 runtime CPU 为 5.01–16.69%，事件循环 p95 为 20.76–21.18ms，没有持续饱和。

该窗口最值得继续定位的仍是少数长尾：`dependency queue /:other` 中保留一条 21307.83ms 的队列任务记录，`dependency background /:other` p95 3047.59ms、max 4599.53ms；活动详情 `GET /api/volunteer/workflow/events/:id/detail` 的 HTTP p95 为 5911.73ms，浏览器同名链路 p95 5935ms；通知总览 `GET /api/notifications/overview` 的 HTTP p50 2154.94ms、p95 2435.77ms，浏览器 p95 2455ms；签到 `POST /api/portal/workflow/registrations/:id/attendance` 的 HTTP 3640.88ms，关联 `njubox/headers` p95 2223.39ms。这些都是部署后混合有界样本，结论仍是：常态排队已明显改善，下一轮优先缩小锁内活动读取范围、错峰/分片后台重活、按 `requestId/traceId` 关联单个长尾，并单独排查活动详情、通知总览与签到附件链路的外部 I/O。

部署回执：`3cfc609419a18e50364f08e9f7753eac74942c78`，980 个运行文件；`njuredcross.service`、`nginx`、`njuredcross-deploy-bridge.service` 均为 `active`。

2026-11-22 最近 24 小时 `journalctl --namespace=njuredcross -u njuredcross -n 30000 -o cat` 有界样本，accept 29440 条，未触达 100000 上限。runtime 最新 CPU 1.74%、RSS 约 304 MiB、事件循环 p95 20.63ms；窗口内 runtime 记录显示事件循环最大 1714.42ms、CPU 最大 37.79%，仍有偶发阻塞但未持续饱和。

| 阶段 | 样本数 | p50 | p95 | max | 判断 |
| --- | ---: | ---: | ---: | ---: | --- |
| `queue/wait` | 422 | 0.03ms | 0.17ms | 3421.71ms | 相比 2026-11-19 有界样本 p95 8632.83ms，排队已不再是常态瓶颈；max 仍说明少数请求碰到全局 barrier 或外部写锁 |
| `queue/activity-mutation` | 110 | 1020.44ms | 3502.57ms | 4225.68ms | 临界区总耗时仍偏高，主要来自读与校验 |
| `queue/activity-read` | 2557 | 279.94ms | 1894.62ms | 3878.03ms | 锁内跨表读取是写操作的主要耗时来源 |
| `queue/activity-external-write` | 86 | 16.98ms | 42.01ms | 374.34ms | 外部写单次很快，不是主要瓶颈 |
| `background/hours-sync` | 149 | 2465.83ms | 3928.55ms | 4599.53ms | 后台同步重活周期性占用上游与事件循环 |
| `background/reconcile` | 146 | 2316.44ms | 3618ms | 4394.36ms | 后台对账重活周期性占用上游 |
| `background/deliver` | 149 | 1461.39ms | 2752.95ms | 3846.7ms | 投递/通知重活与前台读争用上游 |
| `background/run` | 578 | 0.14ms | 2.73ms | 21307.83ms | 本轮新增观测；max 21.3s 指向待单独关联的队列任务 |
| `background/skipped` | 97 | 0.02ms | 0.05ms | 0.06ms | 让路机制有生效记录 |

HTTP 样本 7644 条，状态 >=400 共 338 条、aborted 13 条；这些是混合样本，不能当作完整用户错误率。最慢的成功 HTTP 包括两个 `POST /api/public/:id`（3851.47ms / 3757.19ms）、签到 `POST /api/portal/workflow/registrations/:id/attendance`（3640.88ms）和一个控制台 `PATCH /api/console/:id/:id`（3181.51ms）。签到样本关联到 `njubox/headers` p95 2223.39ms，说明外部附件链路仍会拖长个别请求；浏览器 resource 记录也有 1851–3664ms 的静态资源传输样本，不能把全部长等待归因于应用 CPU。

结论：写队列分区与阶段观测已经消除了持续排队这一首要瓶颈；下一轮应把优化重心放在锁内活动读（减少重复整表读、按活动缩小证据集）和后台 `hours-sync/reconcile/deliver`（错峰、分片、独立预算与限流），并对 `queue/run` 21.3s 和事件循环 1.7s 最大值按 `requestId/traceId` 做时间窗口关联。不要为了缩短这些数值放宽权限、名额或审批一致性校验。

生产样本已确认分区后 `queue/wait` p95 从 2026-11-19 有界样本的 8632.83ms 降到 0.17ms，持续排队不再是首要瓶颈。尚未完成：把外部 I/O 真正移出一致性临界区；通知总览的逐片降级响应；超大模块拆分；偶发事件循环最大延迟与 21.3s 队列任务的时间窗口定位。这些都需要新的生产观测或明确的业务迁移设计，不以代码推送代替验收。

## 本轮验证边界

本轮开始时 `main` 与 `origin/main` 一致、工作区干净；收尾仅更新操作文档、脚本说明和本报告，`git diff --check` 通过。检查覆盖源码、既有报告、缓存/队列设计、写锁、分页读取、前端资源与后台任务。生产侧只执行有界只读日志采样与受限密钥配置，没有执行新的生产压测、没有访问真实业务表、没有改运行代码。后续任何优化都应先定义可观测指标、合成故障回归和回滚点，再按仓库约定验证 CI、发布回执与线上页面。
