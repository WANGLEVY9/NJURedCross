# 脚本与外部写入边界

只有 `check`、lint、`test:*` 和 UI `preview` 进入默认离线验证；其他工具各自需要配置。不要把 `scripts/*.mjs` 全部执行。

## 无业务数据访问

`check-project.mjs` 检查语法、导入、本地文档链接；`test-*.mjs` 使用合成夹具；`preview-site.mjs` 仅提供前端静态文件。基础设施测试位于 `tests/`。

## 在线检查与冒烟

| 工具/命令 | 行为 |
| --- | --- |
| `smoke:public` | 公开页面与资源 GET、匿名权限边界；使用 `SMOKE_BASE_URL` |
| `smoke:auth` | 六个历史测试账号登录和边界；`--write` 额外写投稿，可能产生审计 |
| `smoke:data-boundary` | 鉴权和数据暴露检查；需要测试管理员 |
| `smoke:identity` / `smoke:events` | 会发码/创建测试记录，尝试结束时回收；需隔离环境 |
| `audit:data` | 对照数据源和应用结果；输出可能含内部业务统计，不直接公开 |

其他 smoke 使用 `BASE_URL`，默认端口不统一，见 [测试指南](../docs/TESTING.md)。默认账号口令是历史夹具，不能用于生产。

## 默认预览的 Schema/迁移工具

`preview-event-schema`、`preview-permission-schema`、`preview-profile-schema` 只检查现有结构。`apply-account-schema`、`apply-event-schema`、`apply-notice-schema`、`apply-state-schema` 默认预览；写入需要 `--apply` 和脚本规定的确认短语。npm 中 `*:apply` 名称本身不代表已执行写入。

```bash
npm run events:dry-run
npm run state:dry-run
npm run accounts:dry-run
npm run notices:dry-run
npm run profile-mapping:preview
```

旧专项工具 `migrate-private-identity.mjs`、`retire-business-identity.mjs`、`extend-registration-profile-schema.mjs`、`extend-volunteer-profile-schema.mjs` 以 `--apply` 切换执行，**不都要求第二个确认短语**。迁移/资料工具检查目标 UUID、备份或结果的方式不同，执行前读源码与专项文档，不假设它们是空环境初始化器。身份迁移以已有合法行和哈希为源；不生成测试账号。

## 清理

`state:clean-preview` 预览标记行，`state:purge-preview` 预览状态表全部行。添加 `--apply` 与对应确认短语会真实删除。清理不属于安装流程；purge 仅用于明确授权的隔离演练。

新增外部写入工具应默认预览、明确目标 Base、备份、显式确认与后置验证。预览也可能输出内部 Schema/统计，上传日志前脱敏。

## 志愿流程工具

- `preview-workflow.mjs`：内存合成界面，3121端口，不读取`.env`，不是生产登录。
- `inspect-volunteer-workflow.mjs`：配置数据源只读检查；输出Schema和统计，分享前脱敏。
- `apply-workflow-schema.mjs`：指定测试UUID的六表/字段预览，`--apply`真实建表/加列，不都要求第二确认短语。
- `smoke-workflow-test-base.mjs`：直接向测试副本追加合成记录并保存本地证据；不自动回收，不进入verify。

运行身份旧smoke的日志码/真实行清理方式与当前生产不兼容；默认用合成test。源码发布排除截图、原始JSON证据和`._*`，仅哈希清单可以显式跟踪。

## 维护脚本的同机写入协调

以下脚本执行写入时，必须通过 `run-coordinated-script.mjs`：

- apply-account-schema.mjs
- apply-event-schema.mjs
- apply-notice-schema.mjs
- apply-state-schema.mjs
- apply-workflow-schema.mjs
- clean-test-rows.mjs
- extend-registration-profile-schema.mjs
- extend-volunteer-profile-schema.mjs
- migrate-private-identity.mjs
- retire-business-identity.mjs
- set-account-role.mjs
- smoke-workflow-test-base.mjs

入口在加载目标脚本之前取得共享锁，覆盖脚本读取计划和执行写入的
整个过程，并保留原脚本参数。它不会自动添加 --apply，也不会替代
原脚本的目标 UUID 校验、确认短语、备份要求或写入授权。

npm 中涉及上述脚本的命令已经接入协调入口。例如以下命令仍然预览：

```powershell
npm.cmd run state:dry-run
直接运行支持预览的旧脚本仍可预览，但携带 --apply 的直接运行会被拒绝。
smoke-workflow-test-base.mjs 默认就会写入，因此始终要求协调入口。
没有 npm 命令的工具，也必须使用协调入口。调用格式为：
node --env-file=.env scripts/run-coordinated-script.mjs 脚本文件名 原脚本参数
脚本文件名只接受入口规定的名单；新增写入工具时，需要同时接入入口、
添加写入检查并补测试。不得因为直接运行被拒绝而移除检查。
与网站使用相同状态目录
维护脚本和网站必须在同一台服务器上使用同一个本地锁文件。
生产必须显式设置 PLATFORM_WRITE_STATE_DIR，并保持服务和脚本配置一致。
本地默认目录是当前仓库的 .write-state。若从另一份仓库副本运行脚本，
默认路径不同，不能协调；应显式配置相同目录。
运行账号需要具备该目录的访问权限，不要使用网络文件系统共享 SQLite 锁。
这只是协作程序之间的同机锁，不是跨服务器锁或 SeaTable 跨表事务。
其他仓库、第三方脚本以及直接编辑底表仍可能绕过协调。
脚本等待锁失败时不会开始执行；执行过程中失败仍可能已完成部分写入，
必须按原工具的恢复说明核对，不能假设加锁等于回滚。