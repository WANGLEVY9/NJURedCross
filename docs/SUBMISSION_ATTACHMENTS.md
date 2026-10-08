# 内容投稿附件 · 表契约与应用

内容投稿模块（文字稿件 / 影像作品 / 文创设计 / 课程反馈）的文件直传能力由两部分承载：**「投稿附件表」保存元数据与状态，文件本体存放于阿里云 OSS 私有 Bucket**。本页是表结构、生命周期与应用流程的唯一说明；行映射代码见 `lib/attachment/store.js`，HTTP 域路由见 `lib/attachment/api.js`，Schema 脚本见 `scripts/apply-submission-attachment-schema.mjs`。

## 表结构（投稿附件表，13 列全 text）

| 列 | 语义 | 示例 |
| --- | --- | --- |
| 附件ID | `ATT-{时间36}-{随机}`，主键，服务端生成，不可猜测 | `ATT-M2XQZG-A1B2C3` |
| 投稿ID | 关联「宣传投稿表·投稿ID」；申请槽位时为空，投稿提交时回填 | `SUB-M2XQZH-9F8E7D` |
| 文件名 | 净化后的原始文件名（展示用） | `献血车现场-03.jpg` |
| MIME类型 | 服务端探测结果，非浏览器声明 | `image/jpeg` |
| 大小 | 字节数（字符串落表，仓库惯例） | `2048000` |
| 校验和 | SHA-256 hex（小写）；上传后复核 | `e3b0c442…` |
| 存储提供商 | `aliyun-oss`（预留多供应商扩展） | `aliyun-oss` |
| Bucket | 存储桶名 | `nju-rc-submissions` |
| 对象Key | `<prefix>/<附件ID>/<安全文件名>`，prefix 默认 `submissions` | `submissions/ATT-…/献血车现场-03.jpg` |
| 上传状态 | 待上传 / 已上传 / 校验失败 / 已删除 | `已上传` |
| 上传人 | 账号引用（businessAccountRef），仅本人可删/可绑定 | `251880207@smail.nju.edu.cn` |
| 上传时间 | ISO 时间 | `2026-10-05T12:00:00.000Z` |
| 绑定时间 | 投稿提交时写入 | `2026-10-05T12:05:00.000Z` |

## 生命周期与状态机

```
申请槽位 → 待上传 → (中转上传+校验) → 已上传 → (投稿提交) → 回填投稿ID+绑定时间
                └──────────────→ 校验失败（可重试）
任意未绑定状态 ──→ 已删除（本人删除，同步删 OSS 对象）
未绑定且 7 天未提交 ──→ 运维脚本清理（先 dry-run）
```

- 「宣传投稿表」既有的「附件引用」列（历史恒空）自此启用：值为 JSON 数组文本，如 `["ATT-…","ATT-…"]`；历史行空值语义为"无附件"，读侧统一按空数组兜底（`parseAttachmentRefs`）
- 跨表一致性采用"先附件后投稿"顺序写入，不引入事务假设（与 [架构](ARCHITECTURE.md) 已知限制一致）

## 应用流程

```bash
cp .env.example .env       # 填入 SEATABLE_API_TOKEN（先在测试 Base 验证）
npm run attachments:dry-run   # 预览：打印计划，不写入
npm run attachments:apply     # 写入需确认短语 APPLY-NJU-RC-SUBMISSION-ATTACHMENT-TABLE
```

安全模型与其他 Schema 脚本一致：目标表已存在则拒绝写入；apply 后回读元数据验证。**先测试 Base 验证，再业务 Base 应用**；本脚本不改既有表结构。

## 对象存储对接（阿里云 OSS）

文件读写由 `lib/attachment/oss.js` 承载：**OSS V4 签名（OSS4-HMAC-SHA256）零第三方依赖实现**，仅用 `node:crypto` 与全局 fetch，适配器形态对齐 `lib/events/njubox.js`。上传走**服务端流式中转**（路线 A）：浏览器只与 njuredcross.cn 通信，由服务端代为写入 OSS，前端 CSP（`connect-src 'self'`）零改动。

配置（`.env`，详见 `.env.example`）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET` | 是 | RAM 子账号凭证，建议只授权单个 Bucket |
| `ALIYUN_OSS_BUCKET` | 是 | 私有 Bucket 名 |
| `ALIYUN_OSS_REGION` | 否 | 默认 `oss-cn-nanjing`；`cn-nanjing` 写法亦可 |
| `ALIYUN_OSS_ENDPOINT` | 否 | 覆盖 endpoint（不含 Bucket 前缀），如 ECS 内网地址 |
| `ALIYUN_OSS_UPLOAD_PREFIX` | 否 | 对象 Key 前缀，默认 `submissions/` |
| `ALIYUN_OSS_LINK_TTL_SECONDS` | 否 | 预签名下载链接有效期，默认 900，上限 604800 |

模块面（`lib/attachment/oss.js` 导出）：

- `ossStatus(config)`——纯配置检查，凭证缺失返回 `configured:false` 不崩溃
- `probeBucket(config)`——ListObjectsV2 真实探测，区分凭证（403）/ Bucket（404）/ 网络错误
- `putObject(config, { key, buffer, contentType })`——中转上传，返回 etag / SHA-256 / 字节数 / Bucket
- `deleteObject` / `objectExists`——删除（幂等）与 HEAD 探测
- `signedUrl(config, key, { expiresIn })`——V4 presigned GET 链接（审核端下载/预览）
- `buildObjectKey` / `sanitizeFilename`——Key 布局与文件名清洗（防路径穿越）
- `OssNotConfigured`（503，对齐 `NjuboxNotConfigured`）/ `OssRequestError`（上游非 2xx → 502，原始状态保留在 `ossStatus` 字段）

Key 布局 `<prefix>/<附件ID>/<安全文件名>`：附件 ID 本身含时间戳与随机段（不可猜测、天然唯一），同一槽位重传同 Key 覆盖即重试语义；保留原文件名让审核端直链下载时名称可读。文件名经 `sanitizeFilename` 取末段、去控制字符、去首部点号、限长 120 且保扩展名。

## HTTP API（`lib/attachment/api.js`）

门户侧（登录 + CSRF；槽位申请按账号 20/小时、投稿仍走 `submissions` 分桶）：

| 方法与路径 | 行为 | 关键裁决 |
| --- | --- | --- |
| `POST /api/public/attachments` | 申请槽位，返回 `待上传` 记录与配置公告 | 文件名/类型/大小预检（415/413/400）；未绑定槽位超 10 个拒绝（429） |
| `GET /api/public/attachments/mine` | 本账号附件 + `config` 公告 | 不回显 Bucket / 对象Key 等存储坐标 |
| `POST /api/public/attachments/:id` | multipart 上传（undici `Response.formData()` 解析，零依赖） | 归属（403）/ 状态（409）/ OSS 未配置（503 `aliyun_oss_not_configured`）；成功后复核 SHA-256 回写 |
| `DELETE /api/public/attachments/:id` | 删除未绑定附件 | 已绑定（409）；软删除 + 同步删 OSS 对象 |

审核侧（控制台守卫 + `outreach` 权限范围）：`GET /api/outreach/public-submissions/:id/attachments` 返回审核视图（含校验和、上传人、绑定时间）、每次现算的 `signedUrl` 下载链接表与 `storageConfigured` 状态。

投稿提交（`POST /api/public/submissions`）扩展：`attachmentIds` 数组经 `validateAttachmentBinding` 裁决（不存在 400 / 非本人 403 / 已绑定 409 / 未上传完成 400），通过后**先写投稿行、再回填附件的投稿ID与绑定时间**；「宣传投稿表·附件引用」列同步写入 JSON 数组文本，控制台列表与个人中心回读 `attachmentCount`。

## 前端呈现

- **投稿页三步工作台**（`public/app/portal/pages/submit.js`）：类型卡 → 内容 → 附件与提交。附件区按 `config.storageConfigured` 渲染拖拽上传区或降级提示；上传走 XHR 保留进度回调（CSP 维持 `connect-src 'self'`）；上传中/失败/待上传/已上传四态可重试可移除；草稿 800ms 防抖暂存 localStorage，刷新后连同服务端槽位一并恢复
- **控制台审核区**（`public/app/console/pages/outreach.js`）：公众投稿审核抽屉内嵌懒加载附件区（骨架屏 + 错误重试），展示文件名、类型、大小、上传时间与 SHA-256 摘要；图片附件可灯箱预览（`ui/overlay.js` 的 `openLightbox`），全部附件提供签名链接下载
- **CSP 调整**：`img-src` 放行 `https:`（正文渲染恒为 textContent 无注入面，唯一远程图片消费方是控制台灯箱）；下载链接为签名 URL 点击导航，不受 connect-src 约束

## 降级与边界

- 阿里云 OSS 未配置（`.env` 凭证为空）时，投稿模块自动退回"贴链接"模式，文字投稿不受影响（对齐 `lib/events/njubox.js` 的未配置降级先例）
- 附件元数据查询在 Node 层做两表关联（附件表按 `投稿ID` 过滤后与投稿合并），不依赖 SeaTable 链接列
- 归属校验：附件仅上传人本人可删除/绑定；绑定后随投稿锁定，删除走投稿撤回流程

## 合成回归

`tests/submission-attachments.test.mjs` 覆盖：表契约稳定性、编号唯一性、行映射往返与旧列兜底、「附件引用」编解码的脏值容错。`tests/attachment-oss.test.mjs` 覆盖：OSS 未配置降级（503）、Key 布局与路径穿越防护、文件名清洗、V4 签名确定性与结构、presigned URL 参数、mock fetch 验证 PUT/DELETE/HEAD/探测行为、上游失败映射。`tests/attachment-api.test.mjs` 覆盖：槽位申请的类型矩阵与配额、mine 过滤、上传的归属/状态/降级/成功回写（mock fetch 断言 PUT 目标与中文文件名编码）、删除的 403/409/成功、绑定校验全分支、审核端点过滤与签名链接。运行：`node --test tests/submission-attachments.test.mjs tests/attachment-oss.test.mjs tests/attachment-api.test.mjs`（含于 `npm test`）。
