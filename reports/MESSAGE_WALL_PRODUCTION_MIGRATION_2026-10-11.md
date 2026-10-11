# 线上留言墙原地迁移验收

## 目标与连接边界

通过已有 SSH ControlPath 会话，在服务器 `/opt/njuredcross` 使用服务器 `.env` 认证 NJUTable。未输出或下载 Token，未更换服务器配置。

生产业务 Base UUID 为 `076b49ed-6f04-4ea6-8799-1b9ad71dba88`，与上一轮本地配置的 Base 不同。此前报告中的本地建表结果不能代表生产库；本次以服务器认证后的元数据为准。

## 库表变更

用户明确授权将语录墙替换为留言墙。本次预览确认只有旧表存在、九列均为文本、表 ID 为 `z25M`、首页记录数为 0，再执行两项原地改名：

- `红会语录墙` → `红会留言墙`。
- `语录ID` → `留言ID`。

保持表 ID、列 key 不变，没有删除或复制表，没有写入或修改留言记录。迁移后服务端实际 GET handler 返回 `200`、`ready: true`、`count: 0`。

`scripts/migrate-message-schema.mjs` 导出 `migrateMessageSchema`；默认只预览，执行必须提供与认证结果相符的 `expectedUuid`、`apply: true` 和 `confirm: 'RENAME-MESSAGE-WALL'`。拒绝双表并存、双 ID 列、异常字段类型和缺失稳定 ID。可在表改名成功、字段改名未完成时安全重试，不自动删除或回滚。

## 前端范式与验证

沿用原生 JavaScript/CSS 和项目 frontend-design 技能，现有页面已提供三列 `columns`、卡片 `break-inside: avoid`，1180px 以下两列、760px 以下一列。不重排 DOM；按纵向列流阅读与键盘顺序保持一致，不宣称横向逐行顺序一致。

空态在列容器外。正文使用 `--font-serif`，署名显式 700 字重，来源为小字号。引号使用 `--accent-soft` 且 `aria-hidden`。状态保留文字、颜色和图标，草稿使用 `--bg-sunken`，下架透明度为 0.72。筛选结果新增 polite/atomic 播报，包括当前结果数量。

本地 Node 24 `npm run verify`：272 模块、84 文档语法检查通过，ESLint 无警告，Node 测试 386 项通过。迁移专项测试覆盖预览、确认、Base 防误连、原地保留 ID、重复执行、异常结构和中断续执行。桌面/手机浏览器留言起草、发布、下架测试 2 项通过，额外检查列数、禁止拆卡、衬线、装饰隐藏、署名字重和空态位置。

浏览器写入只发生在合成预览服务。未使用真实留言测试写入，未新增公众投稿或公众展示能力；本次范围仍为管理端留言墙。
