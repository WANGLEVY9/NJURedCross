# 页面与 API 参考

接口实现以 `server.js`、`lib/identity/api.js`、`lib/events/api.js` 与 `public/app/core/api.js` 为准。此处是人工维护的主要接口索引，不是完整 OpenAPI 契约。

### 宣传多级审核推进

`POST /api/outreach/reviews/:contentId/step` 要求宣传管理权限、CSRF，以及当前层级按栏目配置的唯一启用审核人邮箱与服务端账号邮箱一致。请求字段为 `decision`（approve/return）、`note`、`checklist`、`opinions`、`expectedLevel`（当前页面读取的层级）；客户端 `role` 和邮件地址不作为权限或收件人依据。通过审核必须覆盖全部启用清单项；退回需填写意见并保留一轮限制。

非指定审核人返回 403；期望层级过期或审核已完成返回 409；审核人未配置、配置歧义、清单为空/无效或读取失败返回 503。没有隐式管理员跨级放行。配置与真实库表迁移独立于自动代码部署。

## 路由

### 公众端

| 路径 | 页面 | 主要任务 | 需登录 |
| --- | --- | --- | :-: |
| `/` | 首页 | 了解服务并进入最常用的入口 | — |
| `/events` | 活动广场 | 按状态、校区与关键词筛选活动 | — |
| `/events/:eventId` | 活动详情 | 查看场次与名额，在抽屉中完成报名并获得签到凭证 | 提交时 |
| `/materials` | 物资借用 | 三步表单提交借用申请，返回申请编号 | 提交时 |
| `/submit` | 内容投稿 | 三步工作台：选类型 → 写内容 → 传附件并确认授权（直传未开放时降级为正文贴链接） | 提交时 |
| `/warmth` | 温暖连接 | 了解边界与承诺后自愿加入生日祝福 / 早安晚安 | 加入时 |
| `/status` | 我的状态 | 用报名编号查询进度（本账号记录只需编号） | ✓ |
| `/me` | 个人中心 | 查看属于本账号的报名、投稿与温暖连接记录 | ✓ |
| `/login` | 活动平台登录 | 学生账号登录入口 | — |
| `/register` | 自助注册 | 校园邮箱 + 验证码 + 自设密码，签发唯一身份码 | — |
| `/verify-email` | 邮箱验证 | 输入邮箱与验证码完成验证并建立会话 | — |
| `/about` | 平台与隐私说明 | 数据边界、同意与撤回、在建能力 | — |

### 管理端

控制台共七个板块，页面、权限与旧链接兼容见 [管理端板块](ADMIN_PLATFORM.md)，权威定义在 `public/app/console/navigation.js`。

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
| `POST /api/public/submissions` | 内容投稿进入人工审核队列；`attachmentIds` 绑定本账号已上传的附件 | ✓ |
| `POST /api/public/attachments` | 申请附件槽位（返回 `待上传` 槽位与上传配置公告） | ✓ |
| `GET /api/public/attachments/mine` | 本账号附件（含已绑定与待上传槽位）与存储配置 | ✓ |
| `POST /api/public/attachments/:id` | 上传文件本体（multipart，服务端中转到对象存储；未配置时 `503` 降级） | ✓ |
| `DELETE /api/public/attachments/:id` | 删除未绑定附件（软删除，已绑定投稿的需走投稿流程） | ✓ |
| `POST /api/public/warmth/interest` | 登记温暖连接参加意愿（需明确同意） | ✓ |
| `GET /api/portal/me` | 个人中心：本账号的报名、投稿、温暖连接记录 | ✓ |
| `GET /api/morning/cards` | 同行广场：按账号与北京时间日期随机抽取最多 6 张；当日再次读取返回同一快照 | ✓ |
| `GET /api/morning/cards/:cardId` | 名片详情；带有效三天邀约令牌时允许收件人查看发起人主页 | ✓ |
| `POST /api/morning/cards/:cardId/invitations` | 发起好友邀约；附言选填，邮件发送至收件人绑定邮箱 | ✓ |
| `GET /api/morning/invitations/feedback/:token` | 校验三天反馈链接并读取邀约双方昵称 | ✓ |
| `POST /api/morning/invitations/feedback/:token` | 收件人确认成功结识并向对应地区指导组报备 | ✓ |
| `GET /api/community/morning/invitations` | 内建管理：邀约总数、等待反馈、成功结识与成功率 | community |
| `GET /api/community/morning/revisions` | 内建管理：已发布名片的资料更新审核队列 | community |
| `GET /api/community/morning/revisions/:id` | 读取一条名片资料更新 | community |
| `POST /api/community/morning/revisions/:id/review` | 通过、退回或拒绝资料更新；通过后覆盖广场名片 | community + CSRF |

公众端写接口按**来源地址 + 动作分桶**限流（默认每小时 12 次，报名与借用更严格），要求明确同意确认，并且只接受 `PUBLIC_EMAIL_DOMAINS` 中的邮箱域名。响应不回显他人个人信息。

未登录调用写接口或 `/api/portal/me` 返回 `401` 且 `code=login_required`；缺少 CSRF 令牌返回 `403` 且 `code=csrf_failed`。

活动是否对公众可见的判定：状态属于 `报名中` / `进行中` / `已结束`，且公开范围不包含 `不公开`、`仅管理员`、`内部限定`。

### 管理端（需 `super_admin`，或带对应权限范围的 `platform_admin`；写操作另需 CSRF）

`/api/auth/*` · `/api/health` · `/api/notifications/overview` · `/api/audit/recent` ·
`/api/materials/*`（总览、扫码、二维码、申请、审批、出库、归还、流水）·
`/api/events/*`（总览、创建、场次、发布/关闭、报名、取消、签到）·
`/api/volunteer/overview` · `/api/outreach/*`（总览、审核、排期、结果、公众投稿审核、投稿附件读取 `GET /api/outreach/public-submissions/:id/attachments`）·
`/api/community/*`（总览、匹配预览、投稿池、同意与退出、公众端参加登记确认）·
`/api/rows`（受保护的表级 CRUD）

物资与活动总览额外返回 `series`：按 Asia/Shanghai 逐日聚合的真实事件序列，供趋势图使用。

物资扩展服务的本地预览契约见 [物资管理说明](MATERIALS_MANAGEMENT.md)。`lib/materials/service.js` 当前供隔离预览使用；生产继续使用入口中的既有物资接口和持久化回执，不将预览接口视为生产能力。

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

公众写入返回业务编号或受控错误；客户端应通过 `core/api.js` 处理会话、CSRF 和错误消息，不直接调用 SeaTable。普通静态预览除匿名会话外均返回 `503 preview_only`；`preview:materials` 单独提供合成物资接口。两者都不满足真实环境的完整业务 API 契约。

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
| 在线时长审核表 | `GET /api/volunteer/workflow/events/:id/hours-review` | 活动管理权限；待审核/退回/已审明细 |
| 批量签到并录入 | `POST /api/volunteer/workflow/events/:id/attendance-batch` | 活动管理权限、CSRF；1～200人，同活动，逐人返回结果 |
| 编辑待审核服务明细 | `POST /api/volunteer/workflow/events/:id/hours-edit` | 七项服务字段白名单、核对摘要、独立审核人；CSRF；不改变审批状态 |
| 批量审核 | `POST /api/volunteer/workflow/events/:id/hours-approve` | 独立审核人及核对摘要校验；CSRF |
| 退回时长 | `POST /api/volunteer/workflow/hours/:id/return` | 独立审核人、修改说明及核对摘要；CSRF |
| 下载已审 Excel | `GET /api/volunteer/workflow/events/:id/hours-export` | 活动管理权限；私有、禁缓存的真实xlsx附件 |
| 下载前校验 | `HEAD /api/volunteer/workflow/events/:id/hours-export` | 同等活动管理权限与来源校验；无正文，不触发写入 |

审批、发布、名单确认、签到核验、时长核对/批准/入账，以及停点、报名失败和请假审批均在管理子路由。参数与允许状态以 `workflow-api.js` 为准。尚未部署的目录、编辑或归档接口不在本轮线上基线契约中。

批量签到请求为 `{items:[{id:报名行ID,hours:{serviceHours,trainingHours,travelHours,work,expectedDigest}}]}`；修改现有明细时必须传 `expectedDigest`。批量审核使用 `{items:[{id:明细行ID,expectedDigest}]}`，退回使用 `{reason,expectedDigest}`。身份及角色均来自服务端会话。响应含 `succeeded`、`failed`、`results`，每个结果含 `id`、`ok` 及成功记录或受控错误说明；批准和导出不自动同步个人累计时长。


献血车月度复核：`hours-review`、`members`、`export-preview`、`hours-export` 和 `export.xlsx` 的 GET/HEAD 下载可带 `month=YYYY-MM`（HEAD 仅下载接口）。省略月份保持单活动范围。`hours-edit` / `hours-approve` 的 JSON body 可带同样的 `month`；跨月或非献血活动使用月度参数会拒绝。编辑 items 每项为 `{id, expectedDigest, details}`，details 仅接受 `serviceHours, trainingHours, travelHours, work, location, dates, remark`。月份按原场次日期判定，手改正式工作日期不会改变台账归属月份。服务明细和身份资料仅向有 events 权限的管理员返回。
