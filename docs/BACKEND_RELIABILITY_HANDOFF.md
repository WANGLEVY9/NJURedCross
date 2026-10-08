# 后端可靠性优化交接清单

## 当前状态

本地分支：fix/audit-reconciliation。
本次记录更新日期：2026-10-08。
本地完整验证：718 个 Node 测试通过，verify 退出码 0。
验证环境为本地 Windows、Node.js 24.21.0。
最终交接提交号以交接时的 git log 为准。
最新修改在 Linux、Node 22 和目标服务器上的结果仍待实际验证。

此前部分修改已上传 fix/backend-reliability。
后续修改继续保存在本地，不能假设 GitHub 已包含所有修改。
上传、PR 合并和服务器部署分别确认。

真实验证已完成：
- 本地退出及重启后，旧会话 Cookie 失效。
- SeaTable 测试副本中的物资恢复演练与演练数据清理。
- 账号和审计 SQL 查询的只读兼容性检查。

尚未完成：
- 真实 SMTP 投递与故障恢复。
- 审计持久化开启后的真实写入和故障恢复。
- 生产容量、跨服务器协调、备份恢复验收。
- 最新本地修改在 Linux 和目标服务器上的验证。

## 发布前由维护者确认

- [ ] 明确发布提交及其相对服务器实际文件的差异。
- [ ] 确认服务器 Node/npm 版本、操作系统、启动命令和服务账号。
- [ ] 确认实例数量、后台任务及所有外部写入脚本。
- [ ] 确认各 Base 的用途、UUID、权限和表结构。
- [ ] 确认持久化目录、磁盘容量、目录权限和备份方式。
- [ ] 确认业务测试范围、故障演练授权及回滚负责人。

不得以仓库 HEAD 或服务启动成功代替服务器文件一致性检查。
不得在交接材料中附真实 Token、Cookie、验证码或个人资料。

## 配置和私有数据

| 配置 | 发布要求 |
| --- | --- |
| NODE_ENV | 生产使用 production |
| PLATFORM_SESSION_SECRET | 保留受保护的强密钥；轮换前规划邮件与审计历史凭据恢复 |
| PLATFORM_SESSION_REVOCATIONS_FILE | 生产使用持久化私有目录中的绝对文件路径 |
| PLATFORM_WRITE_STATE_DIR | 生产显式指定私有本地持久化目录；同机参与进程使用同一目录 |
| SEATABLE_BUSINESS_BASE_UUID | 与业务连接认证返回的 UUID 一致 |
| SEATABLE_IDENTITY_* | 生产使用独立私有身份 Base |
| SMTP_* | 真实邮件功能需要完整配置及投递验收 |
| WORKFLOW_EVIDENCE_DIR | 独立私有照片目录，不能随源码替换或清空 |
| PLATFORM_AUDIT_RECONCILIATION_ENABLED | 默认 false；单独完成测试后再决定启用 |

试点和正式志愿环境配置按当前
[运行指南](GETTING_STARTED.md)和[试点指南](WORKFLOW.md)核对；
不得通过更换 UUID 绕过代码规定的环境绑定。

写入状态目录包含：
- material-receipts.sqlite：物资操作凭据。
- write-lock.sqlite：同机写入协调。
- mail-deliveries.sqlite：邮件发送状态。
- mail-retries.sqlite：加密通知重试任务。
- audit-reconciliation.sqlite：启用后保存的加密审计凭据。

这些数据库具有不同用途，不构成跨数据库事务。
邮件状态仍含需保护的收件人和主题等数据，不能因正文加密而公开。

SQLite 使用一致性备份方式；运行中不能只复制主文件而忽略 WAL。
会话撤销文件、照片、数据库和恢复所需密钥都需纳入保护计划。
备份完成不等于恢复验收，必须在隔离环境实际恢复并核对结果。

## 本地与隔离环境验证

使用目标 Node 版本和 lockfile 安装：

~~~powershell
npm.cmd ci --ignore-scripts --include=optional
npm.cmd run verify
~~~

依赖审计：

~~~powershell
npm.cmd run audit:dependencies
~~~

服务启动后，在另一终端运行：

~~~powershell
npm.cmd run smoke:public
~~~

公开冒烟通过只证明其检查范围，不证明管理写入、SMTP、
多实例或恢复流程已经验收。

测试 Base 的查询兼容性检查：

~~~powershell
node --env-file=.env scripts/preview-account-query.mjs
node --env-file=.env scripts/preview-audit-query.mjs
~~~

检查使用本地配置，执行前核对目标 Base。
脚本只读，不输出真实账号或审计内容；样本通过不代表全表正确。

## 功能启用和上线后检查

首次部署保持审计持久化关闭。
开启前验证 UUID、私有状态目录、旧凭据密钥兼容性、
settings 权限、CSRF、读取成本及真实故障恢复。

同机协调只覆盖接入的进程和维护脚本。
其他服务器、第三方脚本和直接编辑底表仍可能产生冲突。
不得因已有 SQLite 锁而直接扩大为多服务器部署。

上线后检查实际版本、HTTPS、登录、退出、权限边界、
公开冒烟和后台任务状态，并记录实际验证范围。
未登录访问受保护健康接口返回 401，不能单独判定服务故障。

## 回滚限制

回滚前记录未完成物资凭据、邮件任务和审计待核对状态。
恢复数据备份前停止所有参与写入的服务、任务与维护脚本。

代码回滚不会撤销 SeaTable 写入、SMTP 投递或表结构变化。
旧代码是否兼容现有状态库必须先在隔离环境确认。

不能删除未完成物资凭据来解除阻断。
不能清空邮件状态库来强制重发。
不能删除审计库来绕过密钥或 Base 不匹配。
回滚到不支持持久化会话撤销的版本会改变旧 Cookie 的安全行为。

无法确认远端写入或邮件投递结果时，保留凭据并人工核对，
不凭超时、异常或本地缺少记录直接认定远端没有执行。

## 后续补充的本地防护与诊断

- 共享状态目录在启动前检查公开目录边界、符号链接和已有数据库文件。
- 提供不访问网络的本地配置检查，输出脱敏错误和警告。
- 签到图片使用 Sharp 完整解码，并限制文件大小、像素、尺寸及处理并发。
- 写锁限制待处理请求数量，并验证超时、取消和失败后的容量释放。
- 合成备份恢复测试覆盖 SQLite、会话撤销文件及照片校验。
- 提供物资凭据只读阶段统计，不执行恢复、不访问 SeaTable。

这些验证不替代生产容量、真实备份恢复或业务故障演练。
图片解码不证明照片拍摄日期或签到真实性。
依赖应在目标系统按 lockfile 安装，不能直接复制 Windows 的 node_modules。

## 不需要启动网站的本地检查

以下命令在仓库根目录执行：

~~~powershell
node --env-file=.env scripts/check-local-configuration.mjs
node --env-file=.env scripts/inspect-material-state.mjs
~~~

配置检查不验证真实凭据权限、网络可达性或目录实际写入能力。
物资统计只反映当前本地数据库，plansValidated: false 表示未核验执行计划。
未完成数量为零不代表远端业务已全部核对。
检查失败时保留原文件，不创建空数据库替代故障数据库。

合成备份恢复范围与限制见
[合成备份恢复说明](BACKUP_RESTORE_SYNTHETIC.md)。

## 跨平台验证状态

CI 配置覆盖 Node 22/24 与 Windows/Linux，并显式安装可选依赖。
最新本地测试已通过；其余环境应以对应提交的 CI 实际结果为准。
CI 全部通过仍不代表服务器部署及真实外部服务已验收。