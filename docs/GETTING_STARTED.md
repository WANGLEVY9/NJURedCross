# 运行与复现指南

## 1. 环境与安装

需要 Node.js 22.13 或更新版本、npm、Git。优先使用 Node.js 24。进入仓库根目录执行：

```bash
node --version
npm --version
npm ci --ignore-scripts
npm run verify
```

`npm ci` 按 `package-lock.json` 重建依赖；检查、lint 和合成测试不读取 `.env`，不访问 SeaTable 或 SMTP。npm 安装需要网络，应用前端无需编译。Windows 可使用 PowerShell；复制配置使用 `Copy-Item .env.example .env`。

## 2. 无凭据界面预览

```bash
npm run preview
```

打开 `http://127.0.0.1:3000`，停止使用 Ctrl+C。若端口占用，macOS/Linux 用 `PORT=3001 npm run preview`；PowerShell 用 `$env:PORT='3001'; npm run preview`。

预览只绑定本机回环地址，不加载真实服务端或业务数据。匿名会话可用，其余 API 明确返回 `503 preview_only`。可查看页面布局、加载和错误状态，无法验收登录、数据统计或业务流程。

## 3. 完整业务测试环境

复制 `.env.example`，已有配置时先备份再编辑。不要使用生产 Token 做新贡献者的测试环境。

| 配置组 | 要求 |
| --- | --- |
| `SEATABLE_SERVER_URL` / `SEATABLE_API_TOKEN` | 独立业务 Base；默认 URL 是学校服务，新部署可配置自己的 SeaTable |
| `PLATFORM_SESSION_SECRET` | 至少 32 字符随机密钥，例如下方生成命令 |
| `SEATABLE_IDENTITY_API_TOKEN` / `SEATABLE_IDENTITY_BASE_UUID` | 独立私有身份 Base；设置后账号表不可达或为空会阻止启动，避免凭据兜底 |
| `SEATABLE_BUSINESS_BASE_UUID` | 业务关联使用的 Base UUID |
| `SEATABLE_VOLUNTEER_*` | 可选，志愿数据只读连接 |
| `SEATABLE_PROFILE_*` | 可选，明确指定的资料写连接；不可与只读报表连接混用 |
| `SMTP_*` | 生产注册/重置所需；开发不配置时验证码进入服务端日志 |
| `NJUBOX_*` | 可选，附件能力；未配置不具备上传能力 |

生成密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

最小本地兼容模式可以留空 `SEATABLE_IDENTITY_API_TOKEN` 和 UUID，使用业务 Base 与本地账号文件；这只用于隔离测试环境。`.env.example` 默认指向账号文件，文件必须存在且非空：

```json
[
  { "username": "local-admin", "password": "ChangeMe-Local-Only-123!", "role": "platform_admin", "label": "本地测试管理员" },
  { "username": "local-member", "password": "ChangeMe-Local-Only-456!", "role": "member", "label": "模拟成员" }
]
```

将该合成示例保存为 `.platform-accounts.json` 并自行替换口令。若采用单账号环境变量兜底，需将 `PLATFORM_ACCOUNTS_FILE` 留空，设置 `PLATFORM_ADMIN_USERNAME` 和密码。已配置私有身份 Base 时，上述兜底不会启用；应由维护者初始化私有账号表。生产配置必须使用独立私有身份 Base。

## 4. 表结构与数据准备

项目依赖现有物资、活动、志愿及身份数据模型，不是“一条命令创建全部业务数据”的通用 SaaS。底表关系参见 [专项架构](../PLATFORM_ARCHITECTURE.md)、[物资说明](../MATERIALS_MODULE.md) 和 [资料映射](../VOLUNTEER_PROFILE_MAPPING.md)。仓库不附真实数据导出。

先在测试 Base 运行需要的只读预览：

```bash
npm run events:dry-run
npm run state:dry-run
npm run accounts:dry-run
npm run notices:dry-run
npm run profile-mapping:preview
```

预览需对应 Token；最后一项针对私有身份表字段。私有身份迁移工具以已有合法账号为输入，并非空 Base 的账号生成器。参见 [脚本分类](../scripts/README.md)，由维护者核对目标 Base、备份和授权后执行必要迁移。不要为了让页面显示数据而导入真实同学资料。

## 5. 启动与验证

```bash
npm start
# 或监视模式
npm run dev
```

服务启动日志会显示账号来源和邮件通道。用另一终端执行：

```bash
npm run smoke:public
```

此时默认检查 `http://127.0.0.1:3000`。其他端口使用 `SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke:public`（PowerShell 先设置环境变量）。其余 smoke 的地址变量为 `BASE_URL`，默认端口见测试指南。

## 常见问题

- `Missing SEATABLE_API_TOKEN`：真实服务需要 Token；无凭据请使用 `preview`。
- 私有身份启动失败：核对 UUID、访问权、账号表与账号状态；不要删除私有配置来绕过安全边界。
- 预览 API 的 503：预期行为；完整业务接口需独立数据环境。
- `EADDRINUSE`：检查端口所属实例或更换端口，避免把冒烟测试跑到错误服务。
- 生产邮箱无法注册：检查 SMTP 通道；生产禁用控制台验证码兜底。
- `403`：先区分应用权限/CSRF 与上游数据源认证失败，不能仅凭状态码归因。

## 6. 志愿活动试点

`npm run preview:workflow` 在3121端口提供合成管理员/学生界面。真实测试副本需显式启用 `PLATFORM_TEST_WORKFLOW`，且配置 UUID 与认证返回均符合代码指定值；默认关闭。详见 [试点运行](WORKFLOW.md)。生产照片使用独立目录和权限，不复制到 `public/`。

当前线上版本与本地开发不能仅通过Git HEAD推断；来源与依赖见 [线上基线](PRODUCTION_BASELINE.md)。新维护者不应为复现而运行写入联调或清空表。
## 本地会话撤销存储

退出登录会先持久化会话撤销记录，再返回成功。默认文件为仓库目录下的
`.session-state/revocations.json`，该目录不提交到 Git。文件仅保存会话标识的
SHA-256 哈希及过期时间；过期记录在后续保存时清理。

可通过 `PLATFORM_SESSION_REVOCATIONS_FILE` 指定文件位置。生产部署必须使用
位于代码发布目录之外的持久私有目录，并由服务账号限制访问权限。

记录文件损坏或读取失败会阻止启动；保存失败时退出接口返回 503，
不会返回退出成功或清除 Cookie。

首次运行允许文件不存在。因此，删除记录文件或丢失存储卷会丢失撤销历史；
不要通过删除文件解决启动错误。无法恢复撤销历史时，应更换
`PLATFORM_SESSION_SECRET`，使现有会话全部失效，用户需重新登录。

此实现只支持单进程写入。它不提供多实例协调，也不代表已经完成断电、
磁盘故障或备份恢复验收。

### 本地验证记录（2026-10-06）

Windows、Node.js 24 环境：
- npm run verify 通过，退出码 0。
- 服务重启及 smoke:public 检查通过。
- 使用测试账号的同一旧 Cookie 验证：
  退出前 authenticated=true，退出后=false，服务重启后仍为 false。

以上为本地验证，不代表线上部署、多实例或断电恢复验收。

## 外部请求超时与取消

应用 API 默认使用 30 秒共享预算，包含队列等待时间。
SeaTable、NJUBox 和 SMTP 外部操作默认还有 15 秒截止时间。
请求超时或客户端连接中断后，取消信号传递到外部操作，
预算失效后不再开始新的外部请求。

SeaTable SDK、直接照片上传、NJUBox 请求均覆盖响应内容读取。
SMTP 为每封邮件创建独立连接，取消时关闭对应连接。
不完整的请求体上传超时后会终止连接，客户端可能收到连接中断。

写入队列等待当前任务结束及清理完成后才释放，不通过提前返回制造并发写入。
共享认证和展示缓存独立于单个用户的取消信号，调用方可单独停止等待。
后台密码重置任务使用独立预算。

超时或取消不表示用户登录失效，也不能回滚上游已经完成的写入。
写入结果可能未知，不自动重试，应先核对记录或文件。

SeaTable 保护依赖 SDK 所用 Axios 的默认适配器，
升级 SDK 或 Axios 后须重新运行兼容性测试。
未经保护入口初始化的独立运维脚本不属于本次覆盖范围。

合成测试覆盖超时、连接取消、队列恢复、共享请求隔离、
后台任务隔离、上传读取及 SMTP 握手停滞。
尚未完成真实 NJUBox 上传、真实 SMTP TLS 登录投递、生产容量和线上部署验收。
预算依赖异步操作响应取消，不会强行中断同步计算或回滚本地文件写入。


## 物资恢复凭证与共享写锁

本地开发默认将操作凭证与共享锁保存在仓库根目录的 `.write-state/`，
该目录不提交到 Git。可通过 `PLATFORM_WRITE_STATE_DIR` 指定目录。

生产必须显式配置持久化私有目录。同机参与进程应使用相同路径，
目录不得放在 `public/` 下。不要为了重试操作而删除未完成凭证。

恢复接口、人工核对条件、备份要求与同机协调边界见
[物资写入与恢复说明](../lib/materials/README.md)。

逾期提醒使用有超时保护的 SMTP 调用，并接入共享写锁。
邮件发送与发送记录写入仍不具备原子性，重复投递问题需另行处理。