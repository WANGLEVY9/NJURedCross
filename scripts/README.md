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
