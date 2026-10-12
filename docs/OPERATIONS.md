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

## 回滚和故障

代码回滚恢复上一版本文件与 lockfile，再重启验证。数据/Schema 回滚必须按迁移备份处理；代码回滚不会自动撤销表结构或写入。备份含凭据/个人信息时限制访问、加密保存并验证恢复过程，不进入源码仓库。

认证失败先区分平台会话、权限/CSRF 和 SeaTable 短期访问 Token；连接工厂会在有效期前刷新。资料源故障应检查私有保存与待同步状态，禁止通过更换资料行绑定来绕过冲突。

## 持续运营

上线前明确服务负责人、故障响应、数据访问审批、日志保留与清理、备份恢复演练、凭据轮换和业务高峰容量。审计写入是旁路并可能失败；通用邮件日志去重按完整分页读取，但 SMTP 无法保证收件箱恰好一次投递。报名通知额外使用持久化任务，发送结果不确定时停止自动重试，详见 [报名名额与通知](REGISTRATION_OPERATIONS.md)。部署模型的约束见 [架构](ARCHITECTURE.md)。

## 当前试点与照片

当前运行状态见 [线上部署现状](PRODUCTION_BASELINE.md)。试点开启不等于正式历史迁移，写入始终受指定测试 UUID 门禁约束。照片目录须单独受保护备份并验证恢复；发布、回滚和 `npm ci` 都不覆盖它。

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
