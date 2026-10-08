# 内容投稿 v2 · Box 云存储双备份架构（四大模块）

v2 起，投稿模块的文件不再全量存 SeaTable，改为**「Table 存元数据 + NJU Box 存文件实体」双备份架构**：SeaTable 行是可查询的目录（谁传的、传到哪、什么状态），NJU Box（Seafile 企业版，box.nju.edu.cn）是文件本体，50MB 以上的大文件不再丢失、下载不再出现格式报错。本页是表结构、Box 对接、四大模块与 HTTP API 的唯一说明；行映射见 `lib/attachment/store.js`，Box 客户端见 `lib/attachment/box.js`，路由见 `lib/attachment/api.js` / `media.js` / `showcase.js`，Schema 脚本见 `scripts/apply-submission-v2-schema.mjs`。

## 模块总览（v2 边界）

| 模块 | 入口 | 署名规则 | 文件去向（Box） |
| --- | --- | --- | --- |
| 文字稿件（绑定劳务费） | `/submit?kind=article` | 强制实名：姓名/学号取自身份库，姓名只读 | `/内容投稿/{附件ID}/` |
| 文创设计（与稿件平级） | `/submit?kind=design` | 笔名 + 对外匿名，不绑实名与薪酬 | 同上（共用槽位与表） |
| 影像模块 | `/photos` | 归属上传人账号 | `/影像素材/{活动名}/` |
| 宣传展示（纯展示） | `/showcase` | 展示条目无署名 | `/宣传展示/{分组}/` |

课程反馈投稿模块已于 v2 **彻底移除**（后端路由、表源汇总、前端入口与文案全部清理）；文编审核、美编招募、复审、定发布日期等流转页一律不做，仅保留用户提交环节前端与控制台既有审核抽屉。

## NJU Box 对接（`lib/attachment/box.js`）

NJU Box 即 Seafile 企业版，走 Web API `/api2/`，鉴权头 `Authorization: Token <hex>`。零第三方依赖（全局 fetch + FormData），全部函数支持 `config.njuboxFetch` 测试注入。

| 函数 | 语义 |
| --- | --- |
| `boxStatus(config)` | 纯配置检查（token + repoId 双全才算 configured），返回 `dirs` 三目录布局 |
| `ensureDir(config, repoId, path)` | 逐级建目录（父目录不存在会 404，故逐级；已存在 400 容忍） |
| `uploadBuffer(config, { repoId, dir, relativePath, filename, buffer, contentType })` | 先取 upload-link（**参数名是 `p` 不是 `path`**），目标目录 404 时自动 `ensureDir` 补建并重试一次；`relative_path` 由 Seafile 自动建层 |
| `listDir(config, repoId, dir)` | 列目录，404 → null |
| `fileLink(config, repoId, path)` | 下载直链（`?reuse=1`），每次现取新鲜 seafhttp 链接 |
| `renameFile` / `deleteFile` / `deleteDir` | 更名（form body `operation=rename`）/ 删除（幂等，404 视为已删） |
| `checksum` | 服务端 SHA-256 复核 |

错误模型：`NjuboxStorageNotConfigured`（503，触发前端降级）与 `NjuboxStorageError`（上游非 2xx → 502，`code: 'njubox_not_found'` 等）。

### `.env` 配置（六项）

| 变量 | 说明 |
| --- | --- |
| `NJUBOX_SERVER_URL` | 默认 `https://box.nju.edu.cn` |
| `NJUBOX_API_TOKEN` | Seafile Web API 令牌（`POST /api2/auth-token/` 用统一身份账密换取；账号密码本身不入库） |
| `NJUBOX_REPO_ID` | 目标资料库 ID（后续公用库搭建/换库只改此项，无硬编码路径） |
| `NJUBOX_SUBMISSIONS_DIR` / `NJUBOX_MEDIA_DIR` / `NJUBOX_SHOWCASE_DIR` | 三大目录根，默认 `/内容投稿`、`/影像素材`、`/宣传展示` |

未配置（token/repoId 缺失）时投稿模块退回"贴链接"模式、影像库显示"直传暂未开放"提示，其余功能不受影响（对齐 `lib/events/njubox.js` 降级先例）。

## 表契约（SeaTable）

**投稿附件表**（v1 既有 13 列，语义微调）：`存储提供商` 写 `njubox`；`Bucket` = Box 库 ID；`对象Key` = Box 完整路径（`/内容投稿/ATT-…/文件名`）。读侧按 provider 分派——`njubox` 走 `box.fileLink` 现取直链，历史 `aliyun-oss` 行仍走 `oss.signedUrl` 兼容。

**影像素材表**（12 列）：照片ID（`PHO-…`）/ 活动名（须命中活动项目表）/ 文件名 / MIME类型 / 大小 / 校验和 / 存储提供商 / 库ID / 文件路径 / 留用状态（待定/留用/弃用/已删除）/ 上传人 / 上传时间。

**宣传投稿表**（既有 + 4 列）：文创类别 / 美编人（预留）/ 作品标题（预留）/ 学号（实名轨回填）。双轨写入：`article`（`SUB-` 前缀，姓名/学号强制取身份库、对外署名=实名、403 `identity_incomplete` 兜底）与 `design`（`DSN-` 前缀，联系人/联系邮箱/学号一律空、对外署名=笔名，`投稿人引用` 仅内部审计）。

**宣传展示表**（9 列）：条目ID（`SHW-…`）/ 分组 / 标题 / 链接 / 封面路径 / 库ID / 排序 / 来源（手动导入/公众号抓取）/ 创建时间。

```bash
npm run attachments-v2:dry-run   # 预览 4 列 + 2 新表计划
npm run attachments-v2:apply     # 确认短语 APPLY-NJU-RC-SUBMISSION-V2-SCHEMA
```

## HTTP API

投稿附件（登录 + CSRF，槽位 20/小时）：`POST /api/public/attachments`（槽位）→ `POST /api/public/attachments/:id`（multipart 中转上传 → Box）→ `GET …/mine`（门户视图不含存储坐标）→ `DELETE …/:id`（未绑定本人；物理删 Box 文件 + 顺手清空附件专属目录）。投稿提交（`POST /api/public/submissions/article` | `/design`）带 `attachmentIds` 先写投稿行、再回填绑定。

影像模块（登录 + CSRF，`media` 桶 20/小时）：

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/public/media/activities` | 活动项目表去重出的活动名单（影像降级方案的"从活动广场选活动名"） |
| `GET /api/public/media[?activity=]` | 我的照片（门户视图） |
| `POST /api/public/media` | multipart `activity` + `files` 多值；一次 ≤12 张、单张 ≤20MB、仅图片；表写失败回滚 Box 文件 |
| `GET /api/public/media/:id/link` | 现取下载直链 |
| `PATCH /api/public/media/:id` | `{keep}`：待定/留用/弃用 |
| `DELETE /api/public/media/:id` | 删 Box 文件 + 表状态（本人） |
| `POST /api/public/media/batch-rename` | `{ids}`：`<活动名>_<三位序号>.<ext>`；同活动冲突自动顺延、跨活动 400 拒绝 |

展示板块（**公开无登录**）：`GET /api/public/showcase` 返回 `{groups:[{name,items}],total}`，条目含 `coverUrl`（指向本服务）；`GET /api/public/showcase/covers/:id` 302 到 Box 新鲜直链（`cache-control: no-store`），浏览器 `<img>` 直接加载（CSP `img-src https:` 已放行）。**双数据源**共用一张表：手动导入走 `scripts/import-showcase.mjs`（条目数组 JSON，封面可本地路径或 URL，按标题+链接查重），公众号抓取走 `{mode:'wechat', urls}` 输入经 `lib/attachment/showcase-source.js`（og:title/og:image 提取）。

## 前端呈现

- **投稿页**（`submit.js`）：双类型卡（实名·绑定劳务费 / 笔名·对外匿名角标）、identity-card 只读实名块（缺实名给警告且服务端兜底 403）、文创七类含"卡牌"（兼容历史 UNO 口径）、三步工作台 + 底部提交条 + localStorage 草稿
- **影像库**（`photos.js`）：活动下拉 + 拖拽上传（XHR 进度）+ 照片网格（选择/查看/留用/下载/删除）+ 留用筛选 + 批量自动更名（确认对话框，跨活动提示）
- **展示墙**（`showcase.js`）：分组长方形卡片（封面 + 标题 + 外链），沿用活动广场卡片视觉语言；封面加载失败自动降级为图标占位；数据源无感知（两源同构渲染）
- **导航**：主导航新增「宣传展示」；宣传广场卡片直达 `/submit?kind=` 与 `/photos`

## 回归测试

`node --test tests/*.test.mjs`（137 项全绿）：`tests/submission-v2.test.mjs` 覆盖 box.js 契约（逐级建目录/404 重试/表单语义/幂等删除）、store 行映射与清洗、media 全端点（含批量更名顺延与跨活动拒绝）、showcase 分组排序与 302/404、公众号解析；`tests/attachment-api.test.mjs` 已切 Box 语义（upload-link 参数 `p`、对象 Key 布局、双 provider 读分派）。端到端实测（测试 Base + 真实 Box）：登录→影像上传/直链下载/留用/更名/删除、双轨投稿（含匿名落表与注入忽略验证）、附件槽位→上传→清理、展示导入→分组→封面 302，17/17 通过后测试数据已全部清理。
