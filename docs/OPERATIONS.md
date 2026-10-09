# 部署、回滚与运行维护

## 发布单位

以明确 Git 提交和文件清单为发布单位，记录配置版本、Node/npm 版本、lockfile、表结构版本与静态资源哈希。源码、环境配置和数据迁移独立管理。历史生产按文件增量发布，仓库 HEAD 不能证明服务器整体一致；历史事实见 [部署记录](../DEPLOYMENT.md)。

当前典型环境为单个 Node.js 服务、systemd 和 HTTPS 反向代理。完整 Node 服务默认监听所有网卡，部署时通过防火墙/代理限制直接访问；仅界面 preview 绑定回环。身份使用私有 Base，生产设置 `NODE_ENV=production`，启用 HTTPS/Secure Cookie。`/api/health` 受保护，未经认证的 401 是接口边界，不能单独用来判断服务不可用。

## 发布流程

1. 选定提交，记录服务器当前文件和差异，备份配置、待替换文件及必要数据。
2. 使用匹配的 Node 版本和 `npm ci --ignore-scripts`，完成 `verify` 和依赖审计。
3. 在隔离环境核验 SMTP、SeaTable、NJUBox 与业务流程；依赖重大升级尤其需要集成验证。
4. 如需迁移，先预览、验证 UUID 和列类型、备份，再按工具执行并检查结果。
5. 替换审核后的文件；后端和依赖变化需重启进程，静态文件按请求读取。
6. 检查服务状态、实际版本、HTTPS、公开接口、会话与权限；核对资源哈希。
7. 记录结果与可恢复的前一版本。业务验收失败时执行对应回滚，不把推送当上线。

## main 自动部署

Owner 可直接推送 main；其他开发者继续使用主题分支和 PR。main 的删除与强推规则适用于所有人。GitHub Actions 的 `Deploy main to production` 任务在四组 Node/操作系统验证全部通过后运行；较旧提交若已被更新的 main 替代，由最新提交部署其全部累计变更。

`scripts/package-release.py` 只打包已跟踪的运行源码（server.js、package/lockfile、lib JavaScript、public 资源），排除隐藏文件、.env、数据库和生产日志。服务器通过独立且限于部署命令的 SSH 密钥接收；主机公钥固定校验，不关闭 SSH 主机验证。密钥保存在 GitHub Actions 加密 Secrets 中，生产 NJUTable Token 不上传到 GitHub。

接收器 `scripts/receive-release.py` 安装在 `/usr/local/sbin/njuredcross-ci-deploy.py`，校验路径、压缩包、文件哈希与 JS 语法，仅替换发生变化的文件。每次备份在 `/opt/njuredcross-backups/main-*`；部署状态与完整运行文件哈希记录在 `/var/lib/njuredcross-deploy/release.json`。只删除上一次部署明确管理、而新提交已移除的运行文件。前端变更无需重启；后端变更重启服务；依赖变化执行 `npm ci --ignore-scripts --omit=dev`。

部署后检查 systemd、HTTPS 页面、运行文件哈希和 .env 未变化。失败恢复已替换文件、依赖和服务，部署状态不前移。此代码回滚不涉及数据库，也不撤销外部业务操作。照片、私有 Base 和环境配置始终独立保留。修改服务器接收器或轮换部署密钥时，需要由 Owner 显式维护外部安装文件和 Secrets。

本地验证接收器：`python3 -m unittest discover -s tests -p '*_test.py'`。查看发布状态：GitHub Actions 的部署任务，以及服务器上的 release.json；服务器 Git HEAD 属于历史增量部署记录，不能用它判断当前运行版本。

## 回滚和故障

代码回滚恢复上一版本文件与 lockfile，再重启验证。数据/Schema 回滚必须按迁移备份处理；代码回滚不会自动撤销表结构或写入。备份含凭据/个人信息时限制访问、加密保存并验证恢复过程，不进入源码仓库。

认证失败先区分平台会话、权限/CSRF 和 SeaTable 短期访问 Token；连接工厂会在有效期前刷新。资料源故障应检查私有保存与待同步状态，禁止通过更换资料行绑定来绕过冲突。

## 持续运营

上线前明确服务负责人、故障响应、数据访问审批、日志保留与清理、备份恢复演练、凭据轮换和业务高峰容量。审计写入是旁路并可能失败；邮件幂等当前依赖有限行读取，不能当作全量分布式幂等保证。多实例部署需先补共享锁、会话撤销、限流与事务策略。

## 当前试点与照片

当前服务器基线见 [实际读取记录](PRODUCTION_BASELINE.md)。试点开启不意味着正式历史迁移；保持指定测试UUID门禁。照片目录默认`/var/lib/njuredcross-evidence`，须单独受保护备份与恢复验证；发布、回滚和npm安装均不能覆盖它。

制作源码包排除`._*`、`.env`、node_modules、私有备份、照片与原始QA数据。只有源码包清单与运行文件哈希一致时才能报告代码一致，不以Git HEAD或服务active代替。
