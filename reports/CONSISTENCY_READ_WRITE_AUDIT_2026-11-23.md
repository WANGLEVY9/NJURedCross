# 读写一致性与质量巡检（2026-11-23）

## 范围

同步 `main` 到 `87100c35` 后执行本轮巡检。该版本线上 CI 已成功，服务器 `release.json` 为同一提交、989 个运行文件校验通过、三个服务 active。检查重点为远端 15 个新提交引入或改动的读写链路：时长补录与主席团确认、报销补充材料 Word/PDF 合成与按项目导出、身份注册教职工声明、报名信息导出与个人进度卡。未访问真实业务表，未做认证后压测，未改生产配置。

本地验证：1464 个 JS 模块 / 196 篇文档静态检查、ESM 链接、源码安全规则、遥测边界和 lint 均通过；`node --test --test-concurrency=1 tests/*.test.mjs` 共 3592 项通过、0 失败、1 项既有 skip；生产依赖审计仍可沿用上一轮的 0 高危公告结论。线上匿名私有接口与公开接口边界在上一轮已核验，本轮未重复触碰业务数据。

## 总体判断

新代码的**业务一致性设计总体稳健**：写操作使用串行队列、读操作要求完整分页、审批/确认与导出门禁明确，派生文件生成放在 worker 并设有超时。主要残余风险不是权限绕过，而是**跨表写入没有事务**、**派生副本失败后缺少显式恢复状态**和**配置项文档滞后**。这些风险在单实例、低并发下可控，但若上游写入中途失败，需要人工按状态与原始材料核对。

## 已闭合的读写不变式

- **写串行化**：`lib/events/safety.js` 的 `createMutationQueue()` 覆盖时长补录、确认、撤回、导出和邮件状态；`workflow.js` 中报名、请假、签到、时长、审批写入也经同一 `write()`。队列会等待当前请求预算、观察 `queue/wait`，失败或取消仍释放锁。SQLite `createWriteCoordinator()` 对身份/物资等跨进程可感知文件锁提供 `BEGIN IMMEDIATE/EXCLUSIVE`、上限 64 个等待请求和超时回滚连接。
- **完整读取门禁**：`assertCompleteRows()` 拒绝 `readMeta.truncated` 的行集；`readPagedRows()` 检查重复 `_id`、短页/溢出、取消和上游失败；`lib/identity/account-query.js` 的定向 SQL 查询也拒绝截断或畸形页。写前不会把不完整数据当成空表。
- **展示缓存不介入写入**：`displayRead()` 只让展示读命中，鉴权、写入和身份库读取直连权威源；`trackClient()` 在 `appendRow/updateRow/batch*` 后按表名调用 `invalidateDisplayReads()` 与公共快照失效。新声明写入 `志愿资料` 不缓存权限结论，角色仍为 `member`。
- **补录审批闭环**：负责人补录行初始 `manualApproval='pending'`；主席团确认前 `exportFinalHours()` 明确拒绝；撤回行从视图、列表和合计中过滤；历史无审批字段的行按已确认兼容；合并行继承 `pending`，不会因普通行排在前面而洗掉待确认状态。导出 workbook 在备注列标注“补录”。`tests/hours-supplement.test.mjs` 覆盖草稿阶段补录、权限、阻塞导出、确认/自审标记、撤回、历史兼容、合并行和导出标注。
- **补录身份绑定**：`addSupplement()` 只接受已注册且启用的平台账号，`accountId` 与检索结果不一致时拒绝；`createManualHoursWriter()` 用 `WMH-<requestId>-<fingerprint>` 报名编号、HMAC 签到凭证、同班次重复报名和同学号不同姓名校验保证重放不重复创建。撤回时排除 `已撤回` 报名行，避免旧行阻断重试。
- **导出权限与审计**：`registration-export` 位于 `admin` 分支，先 `authority.assertEvent(id)`，再 `w.registrationTemplate()` 内的 `assertRegistrar`，写 `workflow.registrations.export` 审计，响应 `private, no-store`，`HEAD` 不返回正文。上一轮已修复默认表格不回显邮箱，受控下载仍包含联络邮箱。
- **报销派生文件边界**：PDF/Word 处理都在 worker 中运行，设有 30/90 秒超时和内存上限；`processPdfs()` 保留原始字节，只生成 merged PDF 与 source manifest；订单/付款截图并排同页时 `generateItemPackets()` 用 `placed` 映射避免同一源页重复复制，清单中两个来源指向同一页。测试覆盖发票优先、共享页、Word 图片页、Word-only、无 Word packet、生成失败原子性和并发重试复用一份派生文件。
- **教职工声明**：`REGISTRATION_STAFF_EMAIL_DOMAINS` 经 `staffEmailDomains()` 规范化；仅当邮箱后缀完全匹配时要求 `staffDeclared` 为“是/否”，值写入私有 `志愿资料` JSON，不改角色和权限。`tests/staff-declaration.test.mjs` 与浏览器用例覆盖域名匹配、重复确认不二次弹窗、账号角色保持 `member`。

## 发现与建议

### P1｜时长补录撤回/确认是多表写入，但没有跨表事务或补偿记录

`revokeSupplement()` 在同一 `write()` 串行锁内依次 `update(WF.registrations, ...已撤回...)` 和 `updateRows(WF.ledger, ...revoked...)`；`confirmSupplement()` 更新 `FINAL:` 台账行；`addSupplement()` 先由 `addParticipant()` 创建报名/签到行，再追加或更新台账。SeaTable 没有跨表事务，若第二次写入失败或客户端在两次写入之间断开，需要人工核对哪张表先行落盘。串行锁避免并发交叉，但不能提供原子提交。

现有幂等键、状态过滤和指纹能降低重放风险：报名编号带 `requestId/fingerprint`，台账以 `FINAL:<rowId>` 为幂等键，撤回行会退出导出和视图。但失败后没有统一的“补录意图/写入阶段/待补偿”持久化收据，审计也只在 HTTP 成功后写入，失败路径没有专门记录。

建议：为补录增加本地 SQLite 意图表（requestId/fingerprint/actor/阶段/目标行 ID/结果），在每步写入后更新；失败或重启时由只读巡检报告列出“有报名行无台账”“有台账无确认状态”的孤儿，并提供明确的补偿动作。不要改用最终一致但不透明的后台自动修复；补录涉及服务时长，保留人工确认更合适。

### P2｜报销 Word 是“尽力生成”的派生副本，缺失状态不够显式

`submit()` 在业务申请已整理完成后调用 `generateSupportingPacket()`；worker 超时、内存不足、容量不足或生成器返回 null 时，代码删除 `bundle.supportingDocx` 并继续提交，仅在 `reimbursement_material_needed` 时抛错。这样保证原件和申请不丢，符合“派生文件不能阻断提交”的取舍，但 `supportingDocxUrl=null` 同时可能表示“本申请没有补充材料”“有材料但生成失败”“容量不足”。财务页面无法区分，也没有重试生成入口；重提会创建新的 bundle，派生副本仍可能缺失。

建议：在 bundle 摘要中增加受控状态（例如 `supportingDocx: {status:'none'|'ready'|'failed'|'capacity', reasonCode}`），下载接口对 `failed/capacity` 返回明确的“派生副本暂不可用，请下载原件/稍后重建”，并提供管理员触发的安全重建入口。重建只读原始文件、重新生成副本，不改变申请状态或审核结论。当前 `delete bundle.supportingDocx` + `catch` 的语义应补合成回归。

### P2｜补录相关失败审计与结果不确定性提示不足

`workflowRoutes()` 只在 `addSupplement/confirm/revoke` 成功后调用 `ctx.audit(...)`；审计写本身是普通模式，不是 `recordMorningAudit` 的 `strict`。若业务写入成功但审计写失败，调用方仍收到成功；若业务写入在两步之间失败，前端只看到通用错误，审计不会记录已执行到哪一步。对于“写入结果可能需要核对”的场景，应把失败阶段也纳入可追溯证据。

建议：至少补一条失败/不确定审计（动作、requestId/rowId、失败阶段、固定错误码，不含姓名/学号/异常正文）；对时长补录、确认、撤回和最终导出考虑 `strict` 审计，或把审计收据与补录意图表合并。注意不要让审计失败反过来把已成功的多表写入误报为失败。

### P3｜注册教职工声明的部署配置没有进入文档和 `.env.example`

`server.js` 读取 `REGISTRATION_STAFF_EMAIL_DOMAINS`，但 `.env.example`、`LOGIN_REGISTRATION_FLOW.md` 和 `docs/API.md` 尚未说明。运营者不配置时功能静默关闭；配置错误域名时看似注册页无变化，却可能让特定邮箱注册一直被 400 拒绝。声明值写入私有资料，不提升角色，安全风险低，但部署可预期性不足。

本轮已补充配置模板与文档说明（见相邻提交）。后续 `registration-config` 的测试应继续断言规范化域名列表，避免把 `@bad`、`fake-nju.edu.cn` 等写进公开配置。

### P3｜新增个人进度卡是只读投影，但应保留服务降级语义

`public/app/portal/activity-personal-card.js` 在 `/api/portal/workflow/me` 503 时显示“个人参与进度暂时无法加载”和重试按钮，且只展示当前活动范围内的记录；这符合“私有资料不缓存、失败不伪造 0 值”的边界。浏览器用例覆盖重试与不包含其他活动。建议后续把它纳入统一浏览器遥测的固定阶段，区分接口失败、空数据、超时和取消。

## 质量巡检结论

- 已部署版本与仓库一致，CI、发布回执、服务状态和线上页面此前均已核验；本轮代码同步后本地全量 node 测试通过。
- 新增读写链路在权限、完整性、幂等和导出门禁上比上一轮更严格；未发现可直接绕过权限或把未确认补录计入导出的缺口。
- 最需要后续投入的是**多表写入意图收据**、**派生副本显式状态**和**失败阶段审计**。这三项都属于故障后恢复能力，不改变当前正常路径业务语义。
- 不应为了消除这些缺口引入分布式事务或把 SeaTable 外部编辑镜像成长期权威副本；应先在单实例内把“读后写 token、串行锁、幂等键、审计/意图表、人工补偿工具”做完整。

## 验证边界

本轮未做认证后压测，未向生产业务表写入，未执行数据库迁移，未重新进行浏览器全矩阵（以远端 `87100c35` 已成功的 CI 和本地全量 node 测试为依据）。报告用于确定下一轮改造顺序，不替代故障注入演练或正式容量验收。
