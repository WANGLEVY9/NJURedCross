# 后端模块

模块由 `server.js` 注入上下文并调用，不反向导入入口。业务总览、物资、宣传与温暖连接的路由仍在入口文件中，抽取顺序见 [架构](../docs/ARCHITECTURE.md)。

## `http/` — 传输与响应

| 模块 | 内容 |
| --- | --- |
| `response.js` | 统一 JSON 响应、CSP 与安全响应头 |
| `static.js` | 静态目录隔离、ETag、SPA 回退 |
| `errors.js` | 上游认证失败与平台会话错误的分层映射 |
| `display-reads.js` | 展示读缓存；鉴权与写入始终直连权威源 |
| `read-cache.js` | 带版本标记的短期去重缓存 |
| `paged-rows.js` | 分页读取与完整读取断言 |
| `request-body.js` | 请求体收集与体积上限 |
| `request-budget.js` | 单请求的有界读取预算 |
| `compression.js` | 响应压缩 |
| `seatable-transport.js`、`seatable-image.js` | SeaTable HTTP 传输与图片上传 |
| `external-request.js`、`smtp-request.js` | 外部服务与 SMTP 的有界请求 |

## `identity/` — 身份与资料

| 模块 | 内容 |
| --- | --- |
| `store.js` | 账号列契约、scrypt 哈希、账号读取与更新 |
| `api.js` | 邮箱验证、注册/重置/资料路由与绑定 |
| `volunteer-profile.js` | 稳定匹配、字段白名单与待同步恢复 |
| `challenges.js` | 创建时间同值下的验证码选择与歧义拒绝 |
| `password-async.js`、`password-work.js` | scrypt 计算的异步化，避免阻塞事件循环 |

## `events/` — 活动、通知与志愿试点

| 模块 | 内容 |
| --- | --- |
| `workflow.js` | 六张独立表上的活动生命周期状态机 |
| `workflow-api.js` | 试点的 HTTP 边界：会话、权限、CSRF 与本人归属 |
| `workflow-mode.js` | 环境 UUID 门禁，决定试点写入哪个 Base |
| `safety.js` | 完整读取断言与单实例写队列 |
| `blood-source.js` | 读取市血液中心排班底表，生成献血车班次 |
| `blood-roster.js` | 班次模板、时间窗口与结果状态 |
| `blood-booking.js` | 名额占用：写前重读、写后校验 |
| `wishlist.js` | 满额心愿订阅与通知 |
| `catalog.js`、`public-workflow.js` | 活动目录与公开投影，不含学生历史记录 |
| `volunteer-workflow.js` | 旧表报名/签到关联与人工核验候选 |
| `hours-export.js`、`xlsx.js` | 十列草稿预览与工作簿生成 |
| `attendance-photo.js`、`photo-validation.js`、`photo-work.js` | 私有签到照片的保存、校验与读取 |
| `api.js`、`notice.js`、`njubox.js` | 通知与附件的路由、渲染与外部存储适配 |
| `participant.js` | 请求局部的参与者视图 |

## `morning/` — 早安晚安

| 模块 | 内容 |
| --- | --- |
| `api.js`、`plaza.js` | 广场接口与展示 |
| `admin.js` | 控制台审核与成员管理 |
| `comments.js`、`tags.js` | 留言与标签 |
| `schema.js`、`rollout.js` | Schema 定义与灰度检查 |
| `shared.js`、`member.js` | 共享常量与成员解析 |

## `community/` — 留言墙与温暖祝福

| 模块 | 内容 |
| --- | --- |
| `messages.js` | 留言墙的增删改查与 HTTP 路由 |
| `birthday-rollout.js`、`birthday-schema.js` | 生日祝福的灰度开关与 Schema 检查 |
| `birthday-delivery.js` | 祝福投递配额 |

## 根目录

| 模块 | 内容 |
| --- | --- |
| `permissions.js` | 控制台角色范围、账号状态与路径映射 |
| `seatable-auth.js` | 访问 Token 生命周期与并发认证 |
| `production-schema.js` | 表与列的声明式定义 |
| `mailer.js` | 邮件通道、幂等检查与发送记录 |

## 约定

涉及身份改动运行身份、资料和权限测试；涉及连接/响应改动运行基础设施测试。`npm run verify` 覆盖全套。新模块明确输入输出，数据服务通过参数注入；不在模块加载时发送业务请求。

## `attachment/` — 内容投稿、影像与任务

| 模块 | 内容 |
| --- | --- |
| `store.js` | 投稿附件表契约、行映射与「附件引用」编解码 |
| `api.js` | 门户/审核 HTTP 域路由：会话守卫、限流与归属校验 |
| `review.js` | 多级审核链推进、退回与「审核意见 Word」生成 |
| `activities.js` | 活动字典与按中心的活动白名单校验 |
| `media.js` | 影像素材归档、批量更名与文件夹聚合 |
| `showcase.js` / `showcase-source.js` / `showcase-import.js` | 宣传展示墙双数据源与半自动导入 |
| `tasks.js` | 任务发布与申领审核 |
| `box.js` | NJU Box（Seafile）资料库令牌客户端：目录与文件读写 |
| `oss.js` | 阿里云 OSS V4 签名客户端：中转上传、删除、探测与预签名链接 |

正式旧表与新试点独立，参见 [试点边界](../docs/WORKFLOW.md)。
