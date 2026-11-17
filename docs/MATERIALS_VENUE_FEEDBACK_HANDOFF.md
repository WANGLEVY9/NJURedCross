# 物资 / 场地 / 问题反馈 交接文档（需求 32–45）

> 面向：Rouin101（后端 / 部署）、WANGLEVY9（仓库 owner / 负责人）、周妙（用户端前端）。
> 状态：代码已合并到分支并开 PR，**建表这步还没做**，必须由后端先跑 schema 脚本，新功能才能上线。

## 1. 交付总览

- **分支**：`feat/materials-venue-feedback`
- **提交**：`2b5998df feat: 物资/场地/问题反馈（需求 32–45）`
- **PR**：#103（`feat/materials-venue-feedback` → `main`）
- **规模**：35 个文件，+2446 / −44

三块功能一次落地：

| 块 | 需求 | 内容 |
|---|---|---|
| 物资 | 32–36 | 出入库调研文档、二维码批量标签打印、编号兼容、容量只读报表、安全清理（归档） |
| 场地 | 37–40 | 场地借用 v1：清单 / 可借时段 / 申请 / 审批 / 占用日历 |
| 问题反馈 | 41–45 | 平台问题反馈全链路：提交 / 处理台 / 部门分派 / 通知 |

## 2. 部署前必做：建表 ⚠️

新功能要读写 SeaTable，但真实业务 base 里还没有这几张表/列。**不建表，场地与反馈端点一跑就报「读不到表」。**

### 2.1 需要新增的结构

| 表 | 字段 | 说明 |
|---|---|---|
| **场地表** | 场地名称(text)、地点(text)、可借开始时间(text)、可借结束时间(text)、容量(number)、状态(text)、备注(text) | 新建 |
| **场地借用申请表** | 申请人姓名、申请人账号、场地ID、场地名称、开始时间、结束时间、用途、状态、审批人、审批时间、不通过理由、备注、提交时间（均 text） | 新建 |
| **平台问题反馈表** | 分类(text)、描述(long-text)、截图(text)、联系方式(text)、提交人姓名(text)、提交人账号(text)、提交来源(text)、业务域(text)、状态(text)、处理人(text)、处理说明(long-text)、提交时间(text)、开始处理时间(text)、回复时间(text)、关闭时间(text) | 新建 |
| **物资流水表** | 新增一列 `归档状态`(text) | 在现有表上补列 |
| **物资流水归档备份表** | 备份ID(text)、原流水ID(text)、归档时间(text)、操作人(text)、流水快照(long-text) | 新建 |

> 状态/分类列全部用**纯文本**，不用 SeaTable 单选列——状态机取值由代码冻结校验，避免跟单选列的可选值打架。

### 2.2 建表命令（后端执行）

前置：本地 `.env` 填好真 token + 业务 base UUID，且能访问 `https://table.nju.edu.cn`（校园网 / 内网）。

```bash
# 先预览（不带 --apply 只打印计划，不写库）
node scripts/apply-venue-schema.mjs
node scripts/apply-feedback-schema.mjs
node scripts/apply-materials-archive-schema.mjs

# 确认无误后真正写库
node scripts/apply-venue-schema.mjs --apply --confirm=ADD-VENUE
node scripts/apply-feedback-schema.mjs --apply --confirm=ADD-FEEDBACK
node scripts/apply-materials-archive-schema.mjs --apply --confirm=ADD-MATERIALS-ARCHIVE
```

脚本特性（`lib/schema/ensure.js` 统一实现）：

- **幂等**：表/列已存在就跳过；字段类型不一致会报错，不会乱改。
- **校验 UUID**：会核对 `SEATABLE_BUSINESS_BASE_UUID` 与连接到的 base 是否一致，防止建错库。
- **归档脚本依赖**：`物资流水表`必须已存在（物资模块已上线，应该没问题），否则该脚本会报「缺少物资流水表」。

## 3. 环境变量

**无需新增任何环境变量。** 三个模块复用现有配置：

- 建表：`SEATABLE_API_TOKEN` + `SEATABLE_BUSINESS_BASE_UUID`（`SEATABLE_SERVER_URL` 默认 `https://table.nju.edu.cn`）
- 邮件通知：复用现有 `SMTP_*`；若 SMTP 未配置，通知会落到开发 console transport（只在服务日志打印，不真发），属既有降级行为。
- 无新的密钥、无新的开关。

## 4. 路由与权限速查

| 页面 | 路由 | 权限 |
|---|---|---|
| 公众端 · 场地借用 | `/materials/rooms` | 清单公开可见；申请/取消需登录会员 |
| 公众端 · 问题反馈 | `/feedback` | `requirePortalSession`（登录会员） |
| 管理端 · 场地管理 | `/console/materials/rooms` | `requireConsoleScope('materials')` |
| 管理端 · 物资容量 | `/console/materials/capacity` | `requireConsoleScope('materials')` |
| 管理端 · 问题反馈处理台 | `/console/feedback` | `requireConsoleScope('settings')` |

后端 API：

- 场地：`lib/materials/venue-api.js`（management + public 两组）
- 反馈：`lib/feedback/api.js`（`POST /api/public/feedback`、`POST /api/feedback`、`/transition`、`/summary` 等）
- 容量：`GET /api/materials/capacity`（`lib/materials/management-api.js`）

⚠️ **权限分配注意**：处理台用的是 `settings` scope，不是 `materials`——给「平台运维」同学开权限时别只开物资。

## 5. 外部依赖与待定（不阻塞主体）

| 依赖 | 提供人 / 时间 | 当前处理 |
|---|---|---|
| 场地第三方「指间管理」对接 | 11-20 决策 | 默认不接，`venue.integration = 'pending'`，页面标「待接」，只留适配点 |
| 反馈 C7 状态机抽象 | 龚 11-21 | 先用现有 `dataTable` + `openDrawer` + frozen 枚举实现，结构已收敛成可复用小块 |
| 部门 / 中心统一枚举 | 葛 11-20 | 分类→业务域映射用可替换配置函数（`lib/feedback/dispatch.js`），当前兜底 `service-context.js` 的 centers |
| 反馈邮件收件人 | 管理层定义未定 | 默认 = 所有活跃管理员（console role + 已验证邮箱），`feedbackRecipients()` / `resolveRecipients` 可替换 |

### 状态机口径（冻结枚举）

- 场地申请：`待审批 → 审批通过 / 审批不通过 / 已取消`（`审批通过`/`待审批` 计入占用）
- 问题反馈：`待处理 → 处理中 → 已回复 → 已关闭`；**`已关闭` 是终态，拒绝一切写操作**
- 冲突判定：`a.start < b.end && a.end > b.start`（`YYYY-MM-DD HH:mm`，半开区间，首尾相接不算冲突）

## 6. 测试与验证

- 新增 20 项：`tests/materials-venue.test.mjs`（11）+ `tests/feedback.test.mjs`（9）
- 相关既有 80 项回归通过（materials-service / preview / production-api / public-api / mail-retry-policy / portal-navigation / console-navigation / console-task-route）
- `node --check` 通过 server.js 与全部新模块、新页面

```bash
node --test tests/materials-venue.test.mjs tests/feedback.test.mjs
```

## 7. 验收要点对照

| 编号 | 验收 |
|---|---|
| 32 | `docs/MATERIALS_INBOUND_OUTBOUND_RESEARCH.md`（差异清单 / 缺失单据 / 编号建议 / D1·D3 拆解） |
| 33/34 | 控制台台账勾选 → 「打印标签」A4 拼版；扫码 `NJU-RC-` 直达详情，旧码不 404 |
| 35 | `/api/materials/capacity` 用 `readMeta.total` 口径，与控制台面板一致 |
| 36 | 清理：备份 → 二次确认 → 分批归档（软删，与 E5「已删除」口径一致，账本保留） |
| 37–40 | 同场地同时段第二条申请 400 拦截；审批后进占用日历；页面标「待接」 |
| 41–45 | 公众端 + 管理端均可提交；四态流转、关闭后不可改；新问题进总览待办 + 邮件；回复通知失败可重试 |

## 8. 风险 / 注意

- **归档是软删**：置 `归档状态=已归档`，不物理删除行；流水备份进「物资流水归档备份表」。
- **场地冲突在提交和审批两个时点都校验**：审批时若发现时段被抢，会拒绝并提示，避免并发窗口漏掉冲突。
- **问题反馈表 ≠ 活动反馈表**：这是全新的「平台问题反馈表」，与龚的「活动反馈表」互不干扰，别把数据导错表。
- **通知不阻塞主流程**：新问题/回复先落库，邮件走持久化队列重试；通知失败不会让提交或回复失败。
