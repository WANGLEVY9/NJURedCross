# NJUTable 空表清理与日志保留

`scripts/njutable-maintenance.mjs` 面向已经显式配置在 `.env` 中的 NJUTable Base。它默认只读预览，只有同时传入 `--apply --confirm=APPLY-NJUTABLE-HYGIENE` 才写入。预览和执行结果写入 `reports/NJUTABLE_MAINTENANCE_2026-11-23.json`，权限 600；报告只含表名、UUID、行数、动作和固定原因，不含任何 Token、行内容、账号或业务标识。

## 安全边界

- 每次连接都 `auth()` 后核对 `dtableUuid` 与环境变量中的 Base UUID；不按文档里的固定 UUID 猜测目标。
- 删除表只接受脚本内的显式候选白名单，并拒绝 `protectedTables` 中的业务表。代码引用的 0 行正式 schema（宣传投稿、活动附件、物资流水等）不在候选里。
- 非空开发表、备份表和 `(copy)` 表默认跳过；只有额外传入 `--confirm=DELETE-NON-EMPTY-DEV-TABLES` 才会纳入。默认空壳表 `Table1` 是例外。
- 身份库的验证码与邮件发件记录默认跳过；需服务器显式设置 `PLATFORM_NJUTABLE_IDENTITY_CLEANUP=true`。验证码还要求状态为 `已过期` 或 `已失效`，避免删除仍可能用于限流/幂等判断的近期记录。
- 操作审计默认跳过，需额外传 `--include-audit`；systemd timer 使用该参数以实现 60 天自动清理。审计之外的验证码、账号、报名、时长和审批业务表不做行级自动删除。
- 每表单次最多读取和删除 1000 条过期行，批量删除按 200 条分批；不完整或畸形读取直接失败，不静默截断。

## 60 天 TTL

默认保留 60 天，可用 `--retention-days=<1..3650>` 覆盖。时间字段支持 ISO 时间戳、`YYYY-MM-DD` 和 `YYYY-MM-DD HH:mm:ss`（按北京时间解释）；无法解析时间的行保留，不因格式问题误删。当前规则：

| Base | 表 | 时间字段 | 默认动作 |
| --- | --- | --- | --- |
| 主业务 | `操作审计表` | `时间` | 需 `--include-audit`，删除 60 天前操作日志 |
| 志愿服务 | `志愿服务平台 脚本运行日志` | `运行时间` | 删除 60 天前脚本日志 |
| 身份 | `邮箱验证码表` | `创建时间` | 需环境变量显式开启，仅删已过期/已失效行 |
| 身份 | `邮件发件记录表` | `发送时间` | 需环境变量显式开启，删除 60 天前发件记录 |

业务审计与持久化任务数据库仍按 [链路观测与保留策略](TELEMETRY.md) 和 [运维](OPERATIONS.md) 单独管理；journald 应用日志保留 7 天，Nginx timing 按日轮转 14 份。这里新增的 TTL 只针对 NJUTable 内的不重要日志/操作记录，不对私有账号、报名、签到、时长明细、审批或邮件幂等凭据做默认清理。

## 运行

```sh
npm run maintenance:njutable:preview
npm run maintenance:njutable:preview -- --include-audit
npm run maintenance:njutable:apply
PLATFORM_NJUTABLE_IDENTITY_CLEANUP=true npm run maintenance:njutable:apply -- --include-audit
```

生产部署使用 `ops/systemd/njuredcross-njutable-hygiene.service` 与同名 `.timer`：每日北京时间 03:20 前后运行，`Persistent=true`，随机延迟最多 10 分钟。安装和启用：

```sh
sudo install -m 0644 ops/systemd/njuredcross-njutable-hygiene.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/njuredcross-njutable-hygiene.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now njuredcross-njutable-hygiene.timer
sudo systemctl list-timers njuredcross-njutable-hygiene.timer
```

服务通过 `EnvironmentFile=/opt/njuredcross/.env` 读取凭据，工作目录为 `/opt/njuredcross`；脚本属于运维工具，不在发布包白名单内，需要 Owner 在服务器上安装。首次安装后先以手动 preview 核对当前 Base UUID、候选表和过期行数，再启用 timer。

## 2026-11-23 首次执行

对本地 `.env` 指向的开发/测试 Base 做只读盘点后，以协调锁执行 `--apply --include-audit`：删除身份库默认空壳表 `Table1`（3 行）、志愿服务库 `志愿服务平台 脚本运行日志` 中 529 条 60 天前记录、主业务库 `操作审计表` 中 5 条 60 天前记录。执行后读回：`Table1` 已不存在，脚本日志为 0 行，操作审计从 1670 降到 1665；非空测试表、备份/copy 表、验证码、发件记录和所有业务 schema 均保留。运行回执保存在本机受忽略的 `reports/NJUTABLE_MAINTENANCE_2026-11-23.json`，不进入 Git。
