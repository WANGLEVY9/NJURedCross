# 页面与 API 参考

接口实现以 `server.js`、`lib/identity/api.js`、`lib/events/api.js` 与 `public/app/core/api.js` 为准。此处是人工维护的主要接口索引，不是完整 OpenAPI 契约。

## 路由

### 公众端

| 路径 | 页面 | 主要任务 | 需登录 |
| --- | --- | --- | :-: |
| `/` | 首页 | 了解服务并进入最常用的入口 | — |
| `/events` | 活动广场 | 按状态、校区与关键词筛选活动 | — |
| `/events/:eventId` | 活动详情 | 查看场次与名额，在抽屉中完成报名并获得签到凭证 | 提交时 |
| `/materials` | 物资借用 | 三步表单提交借用申请，返回申请编号 | 提交时 |
| `/submit` | 内容投稿 | 提交稿件/影像/设计，选择署名方式并确认授权 | 提交时 |
| `/warmth` | 温暖连接 | 了解边界与承诺后自愿加入生日祝福 / 早安晚安 | 加入时 |
| `/status` | 我的状态 | 用报名编号查询进度（本账号记录只需编号） | ✓ |
| `/me` | 个人中心 | 查看属于本账号的报名、投稿与温暖连接记录 | ✓ |
| `/login` | 活动平台登录 | 学生账号登录入口 | — |
| `/register` | 自助注册 | 校园邮箱 + 验证码 + 自设密码，签发唯一身份码 | — |
| `/verify-email` | 邮箱验证 | 输入邮箱与验证码完成验证并建立会话 | — |
| `/about` | 平台与隐私说明 | 数据边界、同意与撤回、在建能力 | — |

### 管理端

`/console/overview` 工作台 · `/console/materials` 物资中心 · `/console/events` 活动中心 · `/console/volunteers` 志愿服务 · `/console/outreach` 宣传中心 · `/console/community` 温暖连接 · `/console/data` 数据中心 · `/console/settings` 系统设置

未登录访问 `/console/*` 会被重定向到 `/console/login`；已登录的活动平台成员访问 `/console/*` 会被送回 `/me`，因为控制台接口对他们一律返回 403。

---

## API

### 公众端（读无需登录，写需登录）

| 方法与路径 | 说明 | 需登录 |
| --- | --- | :-: |
| `GET /api/public/overview` | 品牌统计、开放活动、服务通道 | — |
| `GET /api/public/events` | 已公开活动列表，支持 `status` / `campus` / `q` | — |
| `GET /api/public/events/:eventId` | 活动详情与场次名额 | — |
| `POST /api/public/events/:eventId/registrations` | 报名（容量、候补、重复邮箱均由服务端裁决） | ✓ |
| `POST /api/public/registrations/lookup` | 用报名编号查询报名状态 | ✓ |
| `POST /api/public/materials/requests` | 创建「待审批」借用申请 | ✓ |
| `POST /api/public/submissions` | 内容投稿进入人工审核队列 | ✓ |
| `POST /api/public/warmth/interest` | 登记温暖连接参加意愿（生日祝福同一账号不可重复报名） | ✓ |
| `POST /api/public/warmth/blessings` | 生日祝福投稿（仅已确认加入者可提交；**每人最多 3 条，进行中与已通过占用额度、审核不通过可重写**；指定学号 / 随机匹配 / 祝福仓库） | ✓ |
| `GET /api/public/warmth/blessings/mine` | 本人生日祝福投稿、审核进度与审核意见 | ✓ |
| `POST /api/public/warmth/blessings/:id/resubmit` | 「需修改」的生日祝福重新提交 | ✓ |
| `GET /api/public/warmth/blessings/delivered` | 站内投递：生日当天送达本人的祝福（不暴露祝福库） | ✓ |
| `POST /api/public/warmth/blessings/:id/report` | 收件人举报已送达的祝福 | ✓ |
| `POST /api/public/warmth/reports/:id/acknowledge` | 举报人确认处理结果（确认后不在内建广场置顶显示） | ✓ |
| `POST /api/public/warmth/interests/:id/update` | 会员中心修改生日祝福资料 | ✓ |
| `POST /api/public/warmth/interests/:id/withdraw` | 本人退出温暖连接登记 | ✓ |
| `GET /api/portal/me` | 个人中心：本账号的报名、投稿、温暖连接记录 | ✓ |

生日祝福收件规则：收到的祝福 = **指定给本人的** + **等量于本人「随机匹配」与「祝福仓库」已通过条数之和的他人一对一祝福**；完全没有写过非指定祝福（「指定给某人」不算）时，改从**祝福仓库**随机抽取 1 条。「随机匹配」与「祝福仓库」都换取等量一对一，「指定学号」不计入——投稿表单中已明确声明。投稿上限 3 条：进行中（待审核 / 等待对方加入 / 需修改）与已通过占用额度，审核不通过（已拒绝）不占、可在「我写的生日祝福」中重写。自助加入即时生效。

公众端写接口按**动作分桶**限流（默认每小时 12 次，报名与借用更严格；温暖连接加入/退出按账号标识，生日祝福投稿不设小时限额，其余匿名写接口按来源地址），要求明确同意确认，并且只接受 `PUBLIC_EMAIL_DOMAINS` 中的邮箱域名。响应不回显他人个人信息。当前为单 Node 实例，多实例部署前需把限流与关键状态锁迁移到共享存储。

未登录调用写接口或 `/api/portal/me` 返回 `401` 且 `code=login_required`；缺少 CSRF 令牌返回 `403` 且 `code=csrf_failed`。

活动是否对公众可见的判定：状态属于 `报名中` / `进行中` / `已结束`，且公开范围不包含 `不公开`、`仅管理员`、`内部限定`。

### 管理端（需 `platform_admin` 和对应权限范围，写操作另需 CSRF）

`/api/auth/*` · `/api/health` · `/api/notifications/overview` · `/api/audit/recent` ·
`/api/materials/*`（总览、扫码、二维码、申请、审批、出库、归还、流水）·
`/api/events/*`（总览、创建、场次、发布/关闭、报名、取消、签到）·
`/api/volunteer/overview` · `/api/outreach/*`（总览、审核、排期、结果、公众投稿审核）·
`/api/community/*`（总览、匹配预览、投稿池、审核与撤销拒绝、同意与退出、公众端参加登记确认、生日当天投递任务的手动触发）·
`/api/rows`（受保护的表级 CRUD）

物资与活动总览额外返回 `series`：按 Asia/Shanghai 逐日聚合的真实事件序列，供趋势图使用。

---

## 身份与资料接口补充

| 方法与路径 | 用途 | 边界 |
| --- | --- | --- |
| `GET /api/auth/session` | 当前会话 | 匿名可读 |
| `POST /api/auth/login`、`POST /api/auth/logout` | 登录与退出 | 退出要求会话与 CSRF |
| `GET /api/auth/registration-config` | 注册可用性 | 匿名可读 |
| `POST /api/auth/register`、`POST /api/auth/email-codes` | 注册与发码 | 校园邮箱、来源、验证码与限频 |
| `POST /api/auth/verify-email`、`POST /api/auth/reset-password` | 邮箱验证与密码重置 | 一次性验证码与密码策略 |
| `POST /api/auth/change-password/code`、`POST /api/auth/change-password` | 已登录账号修改密码 | 会话、CSRF 与验证码 |
| `GET /api/auth/account`、`PATCH /api/auth/account` | 当前账号私有资料 | 会话，修改需 CSRF 与字段白名单 |

页面另包含 `/reset-password` 与 `/change-password`。资料映射细节见 [专项说明](../VOLUNTEER_PROFILE_MAPPING.md)。不要把账号 hash、源 row ID、托管字段或任意 Base/表选择暴露给用户编辑。

公众写入返回业务编号或受控错误；客户端应通过 `core/api.js` 处理会话、CSRF 和错误消息，不直接调用 SeaTable。预览模式除匿名会话外均返回 `503 preview_only`，不满足这里的完整业务 API 契约。

## 独立试点接口

| 范围 | 方法/入口 | 保护 |
| --- | --- | --- |
| 已批准公开活动 | `GET /api/public/workflow/events` | 试点开关及测试UUID |
| 本人记录 | `GET /api/portal/workflow/me` | 会话、稳定账号归属 |
| 试点报名 | `POST /api/portal/workflow/events/:id/register` | 会话、CSRF；身份字段由服务端读取 |
| 请假、照片 | `/api/portal/workflow/registrations/:code/leave`、`attendance`、`photo` | 本人记录；写入CSRF，照片不可公开缓存 |
| 管理流程 | `/api/volunteer/workflow`及其子路径 | 管理角色、events范围、写入CSRF |
| 献血车整周准备 | `POST /api/volunteer/workflow/blood-roster` | 模板与日期、容量、时长校验 |
| 导出草稿 | `GET /api/volunteer/workflow/events/:id/export-preview` | 活动管理权限；不是xlsx下载 |

审批、发布、名单确认、签到核验、时长核对/批准/入账，以及停点、报名失败和请假审批均在管理子路由。参数与允许状态以 `workflow-api.js` 为准。尚未部署的目录、编辑或归档接口不在本轮线上基线契约中。
