# 南京大学红十字会平台

一个面向真实使用的校内公共服务平台，由两个界面共享同一套数据与权限体系：

| 模式 | 入口 | 面向谁 | 能做什么 |
| --- | --- | --- | --- |
| **公众服务门户** | `/` | 全体同学 | 浏览并报名活动、申请物资借用、投递宣传内容、加入温暖连接、查询自己的记录 |
| **运营管理控制台** | `/console` | 物资／活动／志愿服务／内容审核负责同学 | 待办队列、审批、出入库、现场签到核验、内容审核与发布排期、数据核对、审计与系统状态 |

业务数据由校内自部署的 SeaTable 承载。浏览器永远不接触 SeaTable 凭据：所有数据访问都经由本服务端完成，并在返回前做字段白名单与脱敏。

---

## 快速开始

需要 Node.js 20.6+（使用内置 `--env-file` 与 `fetch`）。

```bash
npm install
cp .env.example .env     # 填入 SeaTable Token、会话密钥与账号配置
npm run check            # 语法与模块检查
npm start                # 默认 http://localhost:3000
npm run smoke:public     # 服务启动后执行公众端只读冒烟检查
npm run smoke:auth       # 服务启动后执行账号与权限边界检查
```

- 公众端：<http://localhost:3000/>
- 管理端：<http://localhost:3000/console>（需 `platform_admin` 账号）

`smoke:public` 只读取页面、静态资源与公众 GET 接口，并检查 CSP、点击劫持保护、404 语义和未登录管理接口边界；不会提交表单或写入 SeaTable。可用 `SMOKE_BASE_URL=https://staging.example.cn npm run smoke:public` 检查预发布实例。

`smoke:auth` 校验六个账号能否登录、两类角色的界面隔离、未登录与缺 CSRF 的门户写入被拒、以及个人中心不串号。默认不写入任何数据；加 `--write` 会额外写入两条投稿以证明跨账号隔离，并在结束时自行回收（含审计行）。

另有两套针对身份与活动运维的冒烟（`BASE_URL=http://127.0.0.1:3200` 指定实例）：`npm run smoke:identity` 覆盖注册、邮箱验证码、身份码签发与发码限频；`npm run smoke:events` 覆盖报名通知生成/发布、njubox 附件引用与未配置 Token 时的上传拒绝。两套都会在结束时回收全部测试行。

若出现 `EADDRINUSE :::3000`，说明已有实例在运行，直接刷新页面即可；也可以 `PORT=3001 npm start`。

---

## 账号与权限

平台有两类账号、两个界面，共用一套登录机制。账号存于 SeaTable 主 Base 的**平台账号表**，口令以 `scrypt` 哈希存储；启动时若账号表不可达或为空，退回 `.platform-accounts.json` 文件（**已加入 `.gitignore`，口令为明文，切勿提交**）作为种子与兜底。执行 `npm run accounts:apply -- --apply --confirm=APPLY-NJU-RC-ACCOUNT-TABLES` 建表并迁移。

学生可自助注册：`/register` 使用 `@smail.nju.edu.cn` / `@nju.edu.cn` 邮箱 + 一次性验证码（10 分钟有效、60 秒发码冷却）+ 自设密码，验证通过后签发唯一身份码 `RC-M-XXXXXXXX`。

| 角色 | 登录入口 | 能做什么 |
| --- | --- | --- |
| `platform_admin` | `/console/login` | 控制台全部功能（审批、出入库、签到核验、内容审核与排期、数据中心）；同时也能使用公众端 |
| `member` | `/login` | 公众端：浏览、报名、物资借用、投稿、温暖连接登记，以及查看个人中心 |

权限边界：

- **浏览保持公开**——活动列表与详情、物资说明、温暖连接介绍无需登录，访客可以先看再决定参加。
- **提交需要登录**——报名、物资借用、投稿、温暖连接登记都需要账号身份；未登录时这些页面不渲染表单，而是给出登录入口。
- **个人中心只看自己**——`/me` 由服务端用会话用户名筛选记录，不接受任何调用方传入的标识。物资借用申请表没有账号列，因此不在个人中心内（页面对此有说明）。
- 本地测试口令下限为 6 位，生产环境为 16 位；可用 `PLATFORM_ACCOUNT_MIN_PASSWORD_LENGTH` 调整，但不能低于 6。学校统一身份认证（CAS）对接仍在排期中，当前以邮箱验证代替。

---

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

## 前端架构

无构建工具、无外部运行时依赖，直接以原生 ES Module 提供服务；服务端 CSP 为 `script-src 'self'; style-src 'self'`，因此代码中**不存在内联样式与内联脚本**，所有动态样式都通过 CSSOM（`style.setProperty`）或 SVG 表现属性写入。

```text
public/
  index.html                应用外壳（环境层、overlay 根、toast 根）
  assets/                   品牌标记与噪点纹理
  styles/
    tokens.css              设计令牌唯一来源（双表面：portal / console）
    base.css                Reset、字体层级原语、环境视觉层
    components.css          共享组件层
    portal.css              公众门户布局
    admin.css               控制台工作区布局
  app/
    main.js                 引导、路由表、会话守卫、渲染管线
    core/                   dom / router / api / store / motion / format / toast / keys
    ui/                     primitives · overlay · palette · chart · table
    portal/                 公众端外壳与页面
    console/                管理端外壳、共享区域工具与页面
```

### 设计系统要点

- **令牌先行**：颜色、字体、间距（4px 基数）、圆角、层级（Level 0–4）与动效时长全部集中在 `tokens.css`，组件不写死颜色。公众端为暖纸质浅色，管理端为中性深色工作区，语义变量同名。
- **克制的主色**：主色只承担关键操作、Focus、Active 与数据高亮；页面结构主要依靠排版、留白、分隔线与表面层次建立。
- **状态三重表达**：所有状态同时使用颜色、文字与图标（必要时加脉冲动效），不依赖颜色单独传达信息。
- **Card 不是默认容器**：只有具备独立语义、状态与交互时才使用面板；其余用 `wsregion` / `section-head` / 分隔线 / 表面层建立结构。
- **完整状态覆盖**：每个数据区域都实现 default / loading（骨架屏）/ empty（含主操作）/ error（原因 + 重试 + 技术细节）。

### 交互与动效

- **命令面板**：`⌘K` / `Ctrl K`（`/` 亦可）打开，支持模糊搜索、分组、最近使用与键盘导航；命令源由当前外壳注册，因此始终与当前界面能力一致。
- **快捷键**：`⌘K` 搜索 · `⌘I` 通知中心 · `⌘B` 折叠导航 · `⌘⇧D` 切换信息密度 · `Esc` 关闭当前面板／Inspector · `↑↓` 列表导航 · `Enter` 确认。快捷键可枚举，并在 Tooltip 与系统设置中展示。
- **Inspector 优先**：在列表中选中对象时右侧滑出详情，而不是跳转页面；窄屏自动改为覆盖式面板。
- **Drawer / Sheet / Modal 分工**：上下文创建与编辑用抽屉（窄屏自动降级为底部 Sheet），仅不可逆确认使用模态（支持输入短语二次确认）。
- **上下文菜单**：列表行支持右键菜单，动作按对象状态启用或禁用。
- **Motion System**：`transform` / `opacity` 驱动，时长集中在 90–620ms；包含页面淡入位移、FLIP 布局过渡（筛选与排序）、共享元素扩展（活动卡片 → 详情）、Spring 抽屉与开关、磁吸主按钮、面板 Spotlight 跟随、Hero 视差与数字滚动计数。全部遵循 `prefers-reduced-motion`。
- **写入前预览**：入库/出库/归还/盘点会先显示 `18 → 15` 形式的库存变化与阈值影响；报名会先说明「直接确认」或「候补第 N 位」。
- **结果凭证**：写入成功后返回业务编号、时间、操作摘要与后续动作；报名与代报名额外返回可下载的签到二维码。

### 数据可视化

图表全部为自研 SVG，不使用图表库默认皮肤：坐标轴与网格刻意弱化，数据承担视觉重量，支持十字准线、交互 Tooltip、图例开关与入场动画。趋势曲线只使用真实事件（活动报名/签到/取消、物资出入库流水）按 Asia/Shanghai 逐日聚合；没有事件时显示空状态而不是伪造曲线。

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
| `POST /api/public/warmth/interest` | 登记温暖连接参加意愿（需明确同意） | ✓ |
| `GET /api/portal/me` | 个人中心：本账号的报名、投稿、温暖连接记录 | ✓ |

公众端写接口按**来源地址 + 动作分桶**限流（默认每小时 12 次，报名与借用更严格），要求明确同意确认，并且只接受 `PUBLIC_EMAIL_DOMAINS` 中的邮箱域名。响应不回显他人个人信息。

未登录调用写接口或 `/api/portal/me` 返回 `401` 且 `code=login_required`；缺少 CSRF 令牌返回 `403` 且 `code=csrf_failed`。

活动是否对公众可见的判定：状态属于 `报名中` / `进行中` / `已结束`，且公开范围不包含 `不公开`、`仅管理员`、`内部限定`。

### 管理端（需 `platform_admin`，写操作另需 CSRF）

`/api/auth/*` · `/api/health` · `/api/notifications/overview` · `/api/audit/recent` ·
`/api/materials/*`（总览、扫码、二维码、申请、审批、出库、归还、流水）·
`/api/events/*`（总览、创建、场次、发布/关闭、报名、取消、签到）·
`/api/volunteer/overview` · `/api/outreach/*`（总览、审核、排期、结果、公众投稿审核）·
`/api/community/*`（总览、匹配预览、投稿池、同意与退出、公众端参加登记确认）·
`/api/rows`（受保护的表级 CRUD）

物资与活动总览额外返回 `series`：按 Asia/Shanghai 逐日聚合的真实事件序列，供趋势图使用。

---

## 安全边界

- SeaTable API Token 只存在服务端 `.env`；`.env` 已被 `.gitignore` 排除。若 Token 曾出现在截图或聊天中，请在 SeaTable 侧撤销并重新生成。
- 管理端会话使用 `HttpOnly`、`SameSite=Strict` Cookie，默认 8 小时；`POST/PUT/DELETE` 必须携带与会话绑定的 `X-CSRF-Token`。前端在令牌过期时会自动刷新一次并重放请求。
- 登录失败按 IP 限制为 15 分钟 5 次。
- 服务端发送 CSP、`X-Frame-Options: DENY`、`nosniff` 与 `no-referrer`；页面不依赖任何外部字体或脚本资源。
- 审计日志记录登录、审批、出入库、签到核验、内容审核、发布结果与公众端提交的操作者、时间、对象与结果，**不保存** Token、密码或签到码明文。审计与全部业务状态都存放在 SeaTable，服务端不写入本地文件。
- 数据中心的原始行写入默认锁定，解锁需要输入确认短语且仅在当前页面有效；删除需要二次输入 `DELETE`。名称含手机号、身份证、银行卡、微信、QQ 等字样的字段在预览中始终隐藏。
- 二维码只编码不透明资产码（`NJU-RC-<行ID>`）与签到凭证摘要，不含姓名、学号、用途或数量。
- 温暖连接默认**不自动发送任何内容**：必须自愿加入、经管理员人工确认、内容经人工审核，且随时可退出。

### 尚未完成（不要当作生产能力使用）

- 学校统一身份认证：需要校方提供 CAS/OAuth/OIDC 服务地址、客户端登记与角色映射，参数不可假设。
- 账号密码仍为本地明文配置，需迁移为 `scrypt`/Argon2；角色目前只区分 `platform_admin` 与 `member` 两类，尚未按表、字段、动作拆分最小权限。
- 库存串行锁只覆盖单个 Node 进程；多进程部署需要集中式锁或数据库事务。
- 「流水已写入但申请状态同步失败」目前只标记异常说明，尚无自动重试或人工重放入口。
- 生产 SMTP、HTTPS、反向代理、备份恢复演练、监控告警与 Token 轮换。

这些项目在管理端「系统设置 → 上线清单」中如实标注为「进行中」或「未开始」。

---

## 响应式与可访问性

- 桌面优先，重点优化 1440 / 1600 / 1920。大屏通过 Inspector、上下文列与更宽的工作区承载信息，而不是无意义地拉宽内容。
- 窄屏下导航转为抽屉、Split View 转为上下堆叠、抽屉降级为底部 Sheet；公众端报名、查询与签到在移动端优先保障。
- 提供跳转到主内容的链接、可见的 `:focus-visible` 轮廓、模态焦点陷阱、`aria-live` 通知区域，以及数字使用 tabular numbers 保证对齐。

---

## 相关文档

- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) — 阶段性建设顺序与验收标准
- [PLATFORM_ARCHITECTURE.md](./PLATFORM_ARCHITECTURE.md) — 完整架构、功能与底表数据连通对应关系（含实测结果与已知问题）
- [OUTREACH_COMMUNITY_DEVELOPMENT_PLAN.md](./OUTREACH_COMMUNITY_DEVELOPMENT_PLAN.md) — 宣传、活动与温暖连接方案
- [MATERIALS_MODULE.md](./MATERIALS_MODULE.md) — 物资数据映射与状态机
- [MATERIALS_GAP_ANALYSIS.md](./MATERIALS_GAP_ANALYSIS.md) — 物资模块完成度与剩余工作

## 数据表结构脚本

```bash
npm run events:dry-run                                                 # 活动三表：只读检查
npm run events:apply -- --apply --confirm=CREATE-NJU-RC-EVENT-TABLES   # 显式确认后执行

npm run state:dry-run                                                  # 平台状态六表：只读检查
npm run state:apply -- --apply --confirm=CREATE-NJU-RC-STATE-TABLES    # 显式确认后执行
```

`state:*` 创建承载投稿、宣传审核、发布排期、温暖连接与操作审计的 6 张表。这两个脚本都默认预览模式，写入前会再次检查目标表是否已存在；发现任意目标表已存在即拒绝执行，不会覆盖或部分改写线上表。新环境按 `events` → `state` 顺序执行。

## 状态表清理

状态层落在 SeaTable 之后，端到端验证会写入真实数据行，需要配套清理工具：

```bash
npm run state:clean-preview                                            # 只读：列出含 VERIFY- 标记的测试行
npm run state:purge-preview                                            # 只读：列出 6 张状态表的全部行
npm run state:clean-preview -- --apply --confirm=DELETE-NJU-RC-TEST-ROWS   # 删除标记行
npm run state:purge-preview -- --purge --apply --confirm=PURGE-NJU-RC-STATE-TABLES  # 清空状态表（危险）
```

默认按标记前缀（`VERIFY-`）定向删除；`--purge` 清空全部行，仅用于建表初期的演练。两种模式都先 dry-run 再执行。
