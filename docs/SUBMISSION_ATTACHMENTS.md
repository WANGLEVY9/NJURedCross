# 内容投稿 v2 · Box 云存储双备份架构（四大模块）

v2 起，投稿模块的文件不再全量存 SeaTable，改为**「Table 存元数据 + NJU Box 存文件实体」双备份架构**：SeaTable 行是可查询的目录（谁传的、传到哪、什么状态），NJU Box（Seafile 企业版，box.nju.edu.cn）是文件本体，50MB 以上的大文件不再丢失、下载不再出现格式报错。本页是表结构、Box 对接、四大模块与 HTTP API 的唯一说明；行映射见 `lib/attachment/store.js`，Box 客户端见 `lib/attachment/box.js`，路由见 `lib/attachment/api.js` / `media.js` / `showcase.js`，Schema 脚本见 `scripts/apply-submission-v2-schema.mjs`。

## 模块总览（v2.2 边界）

宣传广场（`/outreach`）下辖**四个同等层级的板块**（2×2 卡片网格并列呈现，各自直达独立页面）：

| 板块 | 入口 | 署名规则 | 文件去向（Box） |
| --- | --- | --- | --- |
| 文字稿件（绑定劳务费） | `/submit?kind=article` | 强制实名：姓名/学号取自身份库，姓名只读；**联系邮箱强制取账号绑定邮箱** | `/{部门}/{活动名}/{附件ID}/` |
| 影像作品 | `/photos` | 归属上传人账号；**摄影师后缀强制取账号实名 `realName`** | `/{部门}/{活动名}/{活动名}-照片/` |
| 文创设计 | `/submit?kind=design` | 笔名 + 对外匿名，不绑实名与薪酬 | `/内容投稿/文创设计工作组/{附件ID}/`（**不选部门/活动**，2026-10-27 定案） |
| 宣传展示 | `/showcase` | 展示条目无署名（公开可见） | `/宣传展示/{分组}/` |

## v3.1 存储归位（2026-10-11 定案 · 当前生效）

> **一句话**：`平台文件存储` 库根下**先按部门分一级，再按活动名分二级**，活动目录内再分 `<活动名>-照片/` 三级；其他文件直接放二级目录，不再单建「其他资料」子目录。

```
平台文件存储（库根 /）
├── 生命中心/                    ← 一级：部门（= MEDIA_CENTERS 五中心）
│   └── 秋季急救员活动/           ← 二级：活动名称
│       ├── 秋季急救员活动-照片/   ← 三级：影像照片
│       │   ├── 现场1.jpg
│       │   └── 现场2.jpg
│       ├── 其他文件.pdf          ← 其他文件直接落二级（不再有「其他资料」子目录）
│       └── ATT-XXXX-XXXXXX/     ← 投稿附件：二级下按附件ID分子目录
│           └── 稿件.pdf
├── 博爱中心/  ├── 综事中心/  ├── 苏州分部/  └── 主席团活动/
```

- **部门名**取 `MEDIA_CENTERS` 四中心白名单（苏州分部已于 2026-10-27 移除）；缺活动名落 `未命名活动`（仅防脏数据，正常流程不会出现）。
- **文创设计投稿没有部门/活动**：前端不再渲染这两个下拉，槽位接口按 `track=design` 跳过校验，附件固定落 `/内容投稿/文创设计工作组/{附件ID}/`，与历史结构「内容投稿/文字稿件」并列（`submissionStoragePath` 以「无部门」判定该通道）。
- 影像上传的活动名必须命中活动项目表（该中心下的候选），**禁手填**；投稿表单同样**必填**「部门 + 活动名」两个下拉，且活动名自 v3.2 起也是**纯下拉、禁手填**——候选与影像模块同源（`GET /api/public/media/activities`，活动项目表按部门过滤），服务端槽位接口再按同一份白名单兜底（`lib/attachment/activities.js` 的 `assertActivityFromCatalog`），未命中返回 400 `attachment_activity_not_allowed`。
- 精选照片仍**复制**（不移动）到精选库 `e6ad3627-…`（南大红会精选图片库，2026-10-27 起启用；旧库 `37386b87-…` 有 572 个历史素材但不再写入）。**精选库结构刻意与主库不同**：只按活动名建一级文件夹 —— `/{活动名}/{文件名}`（2026-10-28 定案，精选库从空库起用，按活动聚合便于挑素材；目录由上传链路自动创建，缺活动名兜底 `未命名活动`）。
- 常量为唯一来源：`lib/attachment/store.js` 的 `mediaDepartmentDir()` / `mediaActivityDir()` / `mediaPhotoDir()` / `mediaStoragePath()` / `submissionStoragePath()`。**不要在业务代码里手拼路径。**
- 一级（部门）目录可一次性初始化并随时核对（幂等，默认只预览）：

```bash
npm run box:dirs         # 预览：检查五部门 + 展示根是否存在
npm run box:dirs:apply   # 实际创建缺失项（确认短语 BOOTSTRAP-BOX-DIRS）
```

落地现状（2026-10-11 已执行）：主库根下 `生命中心 / 博爱中心 / 综事中心 / 苏州分部 / 主席团活动 / 宣传展示` 六个一级目录均已存在。v3 早期的空目录 `内容投稿`、`影像素材` 仍留在根下（**已无代码写入**），如需清理请人工确认后再删。
- 历史结构（`/内容投稿/<分类>/…`、`/影像素材/<活动名>-<中心>/…`）已不再写入，仅保留常量 `STORAGE_ROOTS_LEGACY` / `SUBMISSION_SUBDIRS` / `MEDIA_OTHER_DIR` 用于识别旧数据；删除逻辑会「重算落点比对」，落点不一致时只删文件、绝不删二级活动目录。

> v2.2 变更要点：① **宣传展示升级为与文字稿件/影像作品/文创设计并列的第四个独立板块**（2×2 卡片同级入口，展示墙内容不再内嵌于广场首页，独立成页 `/showcase`）；② **修复影像作品页无法打开**——`photos.js` 误从 `core/store.js` 导入 `getSessionState`（该函数实为 `core/api.js` 导出），非法具名导入导致整模块加载即抛 `SyntaxError`、页面显示"无法加载"，现改从 `api.js` 导入。
>
> v2.1 变更要点（承接）：① 主导航由 6 项收敛为 5 项；② 影像上传引入**固定五中心**替代原"服务队"概念；③ 活动名改为**下拉联动 + 可手填**；④ 摄影师后缀强制取账号实名；⑤ 影像页新增**按用户自身的文件夹视图**；⑥ 文字稿件联系邮箱**强绑定账号**，前端只读展示、服务端忽略请求体 email。

课程反馈投稿模块已于 v2 **彻底移除**（后端路由、表源汇总、前端入口与文案全部清理）；文编审核、美编招募、复审、定发布日期等流转页一律不做，仅保留用户提交环节前端与控制台既有审核抽屉。

## NJU Box 对接（`lib/attachment/box.js`）

NJU Box 即 Seafile 企业版，走 Web API。**v3 起改用「资料库级令牌」接入**（旧「账号级 Token + `/api2/repos/{repoId}/…`」已废弃）：

- 鉴权头 `Authorization: Bearer <资料库令牌>`；端点前缀 `/api/v2.1/via-repo-token/…`；**令牌自带库身份，任何请求都不再携带 `repoId`**。
- 2026-10-10 踩坑记录：此前三串令牌在 `/api2/` 前缀下全部报 `Invalid token`，根因就是把资料库令牌当账号令牌用。
- 目录端点：`GET/POST/DELETE {P}/dir/?path=/路径`（**mkdir 对已存在目录不报错，而是静默建出「名字 (1)」兄弟目录**，所以调用前必须先列目录判存在）；上传直链 `GET {P}/upload-link/?path=/目录&replace=1`；下载直链 `GET {P}/download-link/?path=/文件`；更名/删除 `{P}/file/?path=…`。接口样例见 `tests/njubox-api-example/`。

| 函数 | 语义 |
| --- | --- |
| `boxStatus(config, libraryId?)` | 纯配置检查（令牌存在即 `configured`），返回 `{ provider, library, libraryName, dirs }` |
| `boxLibrariesStatus(config)` | 主库 + 精选库双状态（主库决定能否直传，精选库决定能否「复制到素材库」） |
| `ensureDir(config, dirPath)` | 逐级建目录（**幂等**：先列目录判存在，避免「名字 (1)」重名目录；相对路径直接拒绝） |
| `uploadBuffer(config, { dir, relativePath?, filename, buffer, contentType, libraryId? })` | 先 `ensureDir` 再取 upload-link（**目标目录不存在会 404，故必须先建**），multipart POST 到一次性直链，返回 `{ fileId, path, dir }` |
| `listDir(config, dirPath, { type?, libraryId? })` | 列目录；**目录不存在返回 `null`**（不抛错） |
| `dirExists(config, dirPath, libraryId?)` | 目录存在性探测 |
| `fileLink(config, filePath, libraryId?)` | 下载直链（现取现用，带时效） |
| `copyBetweenLibraries(config, { sourcePath, targetDir, filename })` | 读主库直链 → 写精选库，**原库文件不删** |
| `renameFile` / `deleteFile` / `deleteDir` | 更名（form body `operation=rename`）/ 删除文件 / 删除目录（**Seafile 允许删非空目录**，幂等性由调用方保证） |
| `checksum` | 服务端 SHA-256 复核 |

错误模型：`NjuboxStorageNotConfigured`（503，触发前端降级）与 `NjuboxStorageError`（上游非 2xx → 502，`code: 'njubox_not_found'` 等）。

### `.env` 配置

| 变量 | 说明 |
| --- | --- |
| `NJUBOX_SERVER_URL` | 默认 `https://box.nju.edu.cn` |
| `NJUBOX_MAIN_TOKEN` | 主库「平台文件存储」**资料库令牌**（投稿附件 / 影像素材 / 展示封面全落这里） |
| `NJUBOX_PICKS_TOKEN` | 精选库「南大红会精选图片库」**资料库令牌**（精选照片复制目标；留空则精选申请会被驳回） |
| `NJUBOX_SHOWCASE_DIR` | 展示封面的固定根，默认 `/宣传展示`（v3.1 起**唯一**仍在用的固定根） |
| ~~`NJUBOX_SUBMISSIONS_DIR`~~ / ~~`NJUBOX_MEDIA_DIR`~~ | **v3.1 起废弃**（影像与投稿已按「部门 → 活动」动态归位），仅保留用于识别历史路径 |

未配置令牌时投稿模块退回"贴链接"模式、影像库显示"直传暂未开放"提示，其余功能不受影响（对齐 `lib/events/njubox.js` 降级先例）。

## 表契约（SeaTable）

**投稿附件表**（v3.1 起 **15 列**）：新增 **`中心`**、**`活动名`** 两列（申请槽位时写入，用于上传时拼 Box 路径）。`存储提供商` 写 `njubox`；`Bucket` = 逻辑库名（`main`）；`对象Key` = Box 完整路径（`/{部门}/{活动名}/{附件ID}/{文件名}`）。缺部门 → 400 `attachment_center_invalid`；缺活动 → 400 `attachment_activity_missing`；活动不在活动项目表该部门候选内 → 400 `attachment_activity_not_allowed`（v3.2 起服务端强制，前端下拉 + 服务端白名单双保险）。读侧按 provider 分派——`njubox` 走 `box.fileLink` 现取直链，历史 `aliyun-oss` 行仍走 `oss.signedUrl` 兼容。

**影像素材表**（v3.1 起 **24 列**）：照片ID（`PHO-…`）/ **中心** / 活动名（下拉候选来自活动项目表，**v3 起禁手填**）/ **摄影师**（上传人账号实名，服务端强制）/ 文件名 / MIME类型 / 大小 / 校验和 / 存储提供商 / 库ID / 文件路径（主库 `/{部门}/{活动名}/{活动名}-照片/{文件名}`；精选库副本 `/{活动名}/{文件名}`）/ 留用状态（待定/留用/弃用/已删除）/ 上传人 / 上传时间 + **精选 6 列**（精选状态/精选申请时间/精选确认人/精选确认时间/精选库路径/精选库ID）+ **删除审核 4 列**（删除申请状态/删除理由/删除审核人/删除审核时间）。

**固定五中心**（`MEDIA_CENTERS`，`lib/attachment/store.js`）：生命中心 / 博爱中心 / 综事中心 / 苏州分部 / 主席团活动。上传必选其一，非法值 400 `media_center_invalid`；`normalizeMediaCenter()` 只接受枚举内值。

**宣传投稿表**（既有 + 4 列）：文创类别 / 美编人（预留）/ 作品标题（预留）/ 学号（实名轨回填）。双轨写入：`article`（`SUB-` 前缀，姓名/学号强制取身份库、对外署名=实名、**联系邮箱强制取 `account.email`**、403 `identity_incomplete` 兜底、缺邮箱 403 `email_missing`）与 `design`（`DSN-` 前缀，联系人/联系邮箱/学号一律空、对外署名=笔名，`投稿人引用` 仅内部审计）。

**宣传展示表**（9 列）：条目ID（`SHW-…`）/ 分组 / 标题 / 链接 / 封面路径 / 库ID / 排序 / 来源（手动导入/公众号抓取）/ 创建时间。

Schema 变更（v3 统一收口到 `scripts/apply-v3-schema.mjs`，带 dry-run 与备份）：

```bash
npm run v3:dry-run    # 预览加列/建表计划（含 v3.1 的四张表改动）
npm run v3:apply      # 确认短语 APPLY-NJU-RC-V3-SCHEMA
```

## HTTP API

投稿附件（登录 + CSRF，槽位 20/小时）：`POST /api/public/attachments`（槽位，**必带 `center` + `activity`**）→ `POST /api/public/attachments/:id`（multipart 中转上传 → Box）→ `GET …/mine`（门户视图不含存储坐标）→ `DELETE …/:id`（未绑定本人；物理删 Box 文件 + 落点比对一致时顺手清空附件专属目录）。投稿提交（`POST /api/public/submissions/article` | `/design`，表单含必填的「部门 + 活动名」）带 `attachmentIds` 先写投稿行、再回填绑定。

影像模块（登录 + CSRF，`media` 桶 20/小时）：

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/public/media/activities[?center=]` | 返回活动项目表去重出的活动名单（可按中心过滤），并同返 `centers`（固定五中心列表） |
| `GET /api/public/media[?center=&activity=]` | 我的照片（门户视图，含 `center`/`photographer`）**+ `folders[]` 文件夹聚合**（按「中心 + 活动」二维分组，含 `department`/`folderName`/`count`/`keepCount`/`totalSize`/`latestAt`） |
| `POST /api/public/media` | multipart `center`（必选项）+ `activity`（**必须命中活动项目表候选，禁手填**）+ `files` 多值；中心非法 400 `media_center_invalid`，活动不属于该中心 400 `media_activity_not_allowed`，账号缺实名 403 `media_photographer_missing`；一次 ≤12 张、单张 ≤20MB、仅图片；表写失败回滚 Box 文件 |
| `GET /api/public/media/:id/link` | 现取下载直链 |
| `PATCH /api/public/media/:id` | `{keep}`：待定/留用/弃用 |
| `DELETE /api/public/media/:id` | v3 起**不再直删**：未走审核一律 409 `media_delete_review_required`；申请走 `POST …/:id/delete-request`，控制台 `POST /api/console/media/:id/delete-review` 通过后才真删 |
| `POST /api/public/media/batch-rename` | `{ids}`：`<活动名>_<三位序号>.<ext>`；同「中心+活动」冲突自动顺延、跨活动目录 400 拒绝 |
| `POST /api/public/media/picks` / `GET …/picks` | 精选申请（3–5 张一批）与我的申请统计 |
| `POST /api/public/media/download-zip` | `{ids}` 批量打包 zip（≤30 张、≤100MB） |

展示板块（**公开无登录**）：`GET /api/public/showcase` 返回 `{groups:[{name,items}],total}`，条目含 `coverUrl`（指向本服务）；`GET /api/public/showcase/covers/:id` 302 到 Box 新鲜直链（`cache-control: no-store`），浏览器 `<img>` 直接加载（CSP `img-src https:` 已放行）。**双数据源**共用一张表：手动导入走 `scripts/import-showcase.mjs`（条目数组 JSON，封面可本地路径或 URL，按标题+链接查重），公众号抓取走 `{mode:'wechat', urls}` 输入经 `lib/attachment/showcase-source.js`（og:title/og:image 提取）。

## 前端呈现

- **宣传广场**（`outreach.js`）：顶部介绍区 + **四大板块 2×2 卡片网格**（文字稿件 / 影像作品 / 文创设计 / 宣传展示，同级并列，各自直达 `/submit?kind=article`、`/photos`、`/submit?kind=design`、`/showcase`）；本页不再内嵌展示墙内容流
- **投稿页**（`submit.js`）：双类型卡（实名·绑定劳务费 / 笔名·对外匿名角标）、identity-card 只读实名块（缺实名给警告且服务端兜底 403）、**联系邮箱只读展示（账号自动绑定，不入草稿、随请求体发送也被忽略）**、文创七类含"卡牌"（兼容历史 UNO 口径）、三步工作台 + 底部提交条 + localStorage 草稿
- **影像库**（`photos.js`）：**中心下拉（五中心必选）** + **活动名下拉联动（禁手填，候选来自活动项目表）** + **摄影师实名提示行（显示账号 `realName`，不可改）** + 拖拽上传（XHR 进度）+ **文件夹视图**（默认按「中心 + 活动」聚合为文件夹卡片，点击展开该文件夹内的照片网格，可返回；上传后自动展开对应文件夹）+ 留用筛选 + 批量自动更名（确认对话框，跨活动目录提示）。会话用户取自 `core/api.js` 的 `getSessionState`（**注意：不是 `core/store.js`**）
- **投稿页部门/活动**（`submit.js`）：内容步骤新增**必填**的「所属部门」下拉（五中心）+「活动名」输入（带 `datalist` 候选，按部门联动过滤）；缺任一项上传会被拦下并提示，附件槽位带上这两个字段以确保 Box 落点正确
- **展示墙**（`showcase-board.js` 共享渲染器 + `showcase.js` 独立页）：分组长方形卡片（封面 + 标题 + 外链），沿用活动广场卡片视觉语言；封面加载失败自动降级为图标占位；数据源无感知（手动导入 / 公众号两源同构渲染）
- **导航**（`portal/navigation.js`）：主导航 **5 项**；宣传展示作为**宣传广场内的第四板块**，`/showcase` 路径归入 `/outreach` 段落高亮

## 回归测试

`node --test tests/*.test.mjs`（**v3.1 基线 468 项全绿**）：`tests/v3-storage.test.mjs` 覆盖 Box 契约（Bearer + via-repo-token / 无 repoId / 幂等建目录 / 跨库复制 / 三级目录构造）、`tests/v3-media.test.mjs` 覆盖精选与删除审核常量与行映射、`tests/v3-data.test.mjs` 覆盖字典与目录构造函数、`tests/attachment-api.test.mjs` 覆盖槽位（部门/活动前置校验）、上传落点、删除的落点比对保护、`tests/submission-attachments.test.mjs` 覆盖 15 列契约与行映射、`tests/submission-v2.test.mjs` 覆盖 media 全端点（中心必选 / 非法中心 / 活动不在候选 / 三级路径 / 文件夹聚合）与 showcase。端到端脚本（测试 Base + 真实 Box，**全部 0 失败**）：

| 脚本 | 覆盖 | 结果 |
| --- | --- | --- |
| `scripts/smoke-v3-tasks.mjs` | 任务发布技能要求 / 申领 → 管理员审核 → 通过或驳回 / 技能下拉与软件多选 / 条件必填 | 37/37 |
| `scripts/smoke-v31-storage.mjs` | 槽位部门活动校验 / 投稿附件三级落点（**云端核对目录真实建出**）/ 删除保护 | 10/10 |
| `scripts/smoke-v3-media.mjs` | 影像三级落点（**云端核对**）+ 精选双库复制 + 删除审核 + zip | 30/30 |
| `scripts/smoke-v3-s6.mjs` | 中心-活动联动 / 展示墙双板 / 栏目字典 | 12/12 |

> 运行提示：脚本用 `E2E_BASE` 指定服务地址（如 `E2E_BASE=http://127.0.0.1:3210`），需与本地服务**同一条命令内**启动并收尾（后台进程会随回合结束被回收）。限流是**进程内存**计数（每桶 1 小时窗口），同一进程内重复跑同一脚本会撞 429，重启服务即可复位。

> **v2.2 修复专项**：`photos.js` 模块加载错误由 Node 直接复现——`SyntaxError: The requested module '../../core/store.js' does not provide an export named 'getSessionState'`；修正导入来源后同一命令返回仅 `window is not defined`（浏览器模块在 Node 下的预期表现），证明模块已可正常加载。同类问题已加静态防线：`scripts/.link-check.mjs` 逐模块比对「具名导入 ↔ 目标导出」（v3.1 全仓 212 个模块通过）。
