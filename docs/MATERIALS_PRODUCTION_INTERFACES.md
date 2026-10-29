# 财务物资正式接口接入（2026-10-28）

本次以最新 main 为基准保留其他部门代码，修复物资新页面调用预览接口、归还正式接口缺失，以及报销配置提示无法区分未开放与未配置的问题。广场名称沿用 10-21 的“物资广场”（10-28 曾有提交按旧词改回“财务物资广场”，10-29 由 Owner 确认以“物资广场”为准）。不改变活动、宣传、内建或会员业务规则。

## 正式接口

- 用户：`GET /api/public/materials/loans`、`GET/POST /api/public/materials/returns`、`GET /api/public/materials/returns/:id/photo`。
- 管理：`GET /api/materials/schema`、`GET /api/materials/flows`、`PATCH /api/materials/flows/:id/review`、`POST /api/materials/flows/:id/retry-sync`。
- 管理：`POST /api/materials/movements`、`POST /api/materials/inventory`、`PATCH /api/materials/inventory/:id`、`PATCH /api/materials/inventory/:id/availability`。
- 管理核对：`GET /api/materials/returns`、`POST /api/materials/returns/:id/review`，以及兼容此前登记的 `/api/materials/inbound` 列表和核对接口。

管理路由使用既有物资权限和 CSRF。正式会话使用 `/api/materials/*`，只有服务器明确标记的本地预览会话使用 `/api/preview/materials/*`。旧借用审批、申请出库/归还和恢复 URL 保留；新页面复用同一出库/归还凭证执行函数。

## 数据和部署前提

真实库存、借用单、数量变化仍保存在原 NJUTable 的工位物资表、物资管理、物资配置表、物资流水表中。新增“平台物资登记表”，仅保存归还/入库登记、新物资创建进程、停用/恢复状态和历史。五列为登记ID（text）、登记类型（text）、版本（number）、内容（long-text）、摘要（text）；摘要核对失败、重名记录或不完整读取均拒绝继续写入。

归还照片保存在 NJUBox `/物资材料/对象/` 中，复用内容摘要和字节校验，按已登录账号归属或物资管理权限代理读取。不公开原始 Box 引用或令牌。照片可不上传；已上传则须配置 `NJUBOX_MATERIALS_TOKEN`，未单独配置时复用既有 `NJUBOX_MAIN_TOKEN` 或 `NJUBOX_API_TOKEN`。金融报销专用凭据仍独立，不因物资照片而启用或更换。

`PLATFORM_WRITE_STATE_DIR/material-workflow-intents.sqlite` 仅保存写入意图和恢复回执，与原 `material-receipts.sqlite` 一起备份。未知追加结果不盲目重试；没有可核对的唯一结果时停止并交人工核查。既有共享写锁覆盖本机 HTTP 写操作；不宣称具备跨服务器事务或防止直接编辑底表的能力。

结构检查默认只读，必须使用已核实的业务 Base 配置：

```powershell
node --env-file=.env scripts/apply-materials-workflow-schema.mjs
```

维护人员备份表结构、确认目标 Base 和增量计划后，可显式新增表/缺列：

```powershell
node --env-file=.env scripts/apply-materials-workflow-schema.mjs --apply --confirm=ADD-MATERIALS-WORKFLOW
```

该脚本不改已有列类型、不删除表、不写业务行、不自动启用功能。源码发布不执行该迁移。本轮开发和测试未执行真实表变更、Box 上传或真实发信。未建好登记表时，本人借用单仍可读取，页面明确显示登记尚未开放，不能伪装成没有历史记录；传统借还与库存登记不因缺少新增登记表而关闭。新增/停用按钮只在表结构核验通过后开放。

## 财务配置提示

`GET /api/reimbursements/config` 在专用存储未启用时返回 HTTP 200 和 `available: false`，明确区分未正式开放、Table/Box 配置未完成、暂未开放写入。页面显示可理解的状态，不调用模拟服务、不生成假申请表。实际业务路径仍返回 503，保留原保护。管理员 `/api/reimbursements/readiness` 提供配置缺项和表结构核验结果，不返回令牌。

正式启用仍需服务器私有配置：`PLATFORM_REIMBURSEMENTS_ENABLED`、`PLATFORM_REIMBURSEMENTS_ALLOW_WRITES`、财务专用 Table/Box 配置及中文 PDF 字体；真实邮件还需现有 SMTP 和财务邮件开关。不能通过源码提交自动补齐这些私有配置，也不能以页面有提示代替真实业务验收。

## 验证范围

隔离 Table/Box 回归覆盖真实归属、权限/CSRF、重复提交、过量归还、截断数据、照片类型与授权读取、应答丢失、申请状态更新失败后恢复、新物资首次入库、停用后阻止新增借出，以及原恢复凭证阻止相关新操作。浏览器检查使用正式 URL 和合成状态，断言没有预览请求、没有物资 404，并检查确认与结果页面。

不把此前本地演示的内存记录迁移到正式表，也不假设旧上传仍存在。原三个财务预览、3127 和两份 reports 验证目录保持独立。
