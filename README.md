<div align="center">

<img src="public/assets/nju-red-cross-emblem.jpg" width="96" height="96" alt="南京大学红十字会徽标" />

# NJURedCross

### 南京大学红十字会 · 校园公益开源共建平台

**让每一次参与，都有回应。**

连接志愿者、活动负责人和校园伙伴，以公开协作建设校园公益服务。

Campus volunteering, built together. Native JavaScript · Node.js · SeaTable.

[体验平台](https://www.njuredcross.cn) · [快速开始](#快速开始) · [功能地图](#功能地图) · [参与共建](#参与共建) · [社区讨论](https://github.com/WANGLEVY9/NJURedCross/discussions) · [文档](docs/README.md)

[![Project verification](https://github.com/WANGLEVY9/NJURedCross/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/WANGLEVY9/NJURedCross/actions/workflows/ci.yml)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-253d72)](LICENSE)
[![CI: Node.js 22 / 24 / 26](https://img.shields.io/badge/CI%20Node.js-22%20%2F%2024%20%2F%2026-417e38)](.github/workflows/ci.yml)
[![Contributions welcome](https://img.shields.io/badge/community-contributions%20welcome-b61f3b)](CONTRIBUTING.md)

</div>

## 为什么开源

NJURedCross 是南京大学红十字会成员、学生开发者和社区志愿者共同建设的校园公益平台。活动发现、报名审核、志愿服务、物资借用、内容协作、同伴互动与管理运营都在同一套代码里持续迭代；我们把代码、设计决策、验证方式和协作规则公开出来，让每一次改进都能被学习、复用和审查。

项目欢迎代码贡献，也欢迎产品建议、交互设计、测试、文档、无障碍与可访问性改进。即使没有生产数据权限，也能用合成数据复现界面、修复问题或补齐回归。项目仍处于持续迭代的 **Beta 阶段**：线上业务由运营者配置独立 NJUTable / SeaTable、身份、邮件及附件服务；仓库不附带真实账号、Token、照片或业务表。

| 你可以这样参与 | 从哪里开始 |
| --- | --- |
| 了解用户场景、交流想法 | [Discussions](https://github.com/WANGLEVY9/NJURedCross/discussions) · [路线图](ROADMAP.md) |
| 找一个适合上手的改进 | [开放 Issue](https://github.com/WANGLEVY9/NJURedCross/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22%2C%22help%20wanted%22) · [路线图](ROADMAP.md) |
| 报告问题或提出方案 | [Issue 模板](https://github.com/WANGLEVY9/NJURedCross/issues/new/choose) |
| 提交代码、文档或界面改进 | [贡献指南](CONTRIBUTING.md) · [开发约定](docs/DEVELOPMENT.md) |
| 了解维护与决策方式 | [项目治理](GOVERNANCE.md) · [行为准则](CODE_OF_CONDUCT.md) |
| 私密报告安全问题 | [安全政策](SECURITY.md) |

社区不要求额外 CLA，贡献沿用 [MPL-2.0](LICENSE)；学校和平台业务数据按各自授权管理。完整署名规则见 [CONTRIBUTORS](CONTRIBUTORS.md)。

## 界面预览

### 线上实况

以下两张图来自 **2026-11-22 的已登录线上页面**，用于展示当前真实上线形态。管理端截图已裁掉顶栏中的登录邮箱；页面中的统计与待办属于真实运营数据，开源仓库不保存其账号、个人资料或明细导出。线上截图不作为贡献者的无凭据复现材料。

| 活动广场 | 管理端运营总览 |
| --- | --- |
| ![线上活动广场：真实活动筛选与近期活动](docs/assets/events-live-preview.png) | ![线上运营总览：待办分布与运营健康](docs/assets/console-overview-live-preview.png) |

### 本地合成复现

以下截图来自本地合成演示环境，使用内存数据，不含真实账号与业务记录；可用 `npm run preview:workflow` 和 `npm run screenshots` 复现。它们适合作为贡献者检查页面布局、交互与回归的基线。

### 官网首页

公益主视觉、实时活动统计、千纸鹤寄语与五专题共享导航；手机端自动收敛为底部标签栏。

| 桌面 | 手机 |
| --- | --- |
| ![官网首页：公益主视觉、活动统计与千纸鹤寄语](docs/assets/home-preview.png) | ![手机首页：轮播、统计与底部标签栏](docs/assets/mobile-home-preview.png) |

### 活动广场

组合类别、地区、校区、状态筛选与关键词搜索，发现活动并完成报名、结果查询与现场签到。

| 桌面 | 手机 |
| --- | --- |
| ![活动广场：专题分类、组合筛选与近期活动](docs/assets/events-preview.png) | ![手机活动广场：分类入口与活动列表](docs/assets/mobile-events-preview.png) |

<details>
<summary><strong>查看献血车日历、其余公众端页面与管理端</strong></summary>

### 献血车报名日历

按周次、服务点位和剩余名额查找班次，支持舒展/紧凑两种视图。

![献血车报名日历：周视图、点位与名额筛选](docs/assets/calendar-preview.png)

### 宣传广场

投稿专栏、影像作品、任务申领与宣传展示四个独立板块，署名或匿名提交，经人工审核后展示。

![宣传广场：投稿专栏、影像作品、任务申领与宣传展示](docs/assets/outreach-preview.png)

### 内建广场

生日祝福与早安晚安·同行计划：自愿加入、按校区时段与兴趣匹配同伴，内容经审核后转达。

![内建广场：生日祝福与早安晚安同行计划](docs/assets/community-preview.png)

### 物资广场

急救箱、血压计、宣传展架等物资面向校内班级、社团和公益活动开放借用：填写申请 → 管理员审批 → 现场领取与归还留档。

![物资广场：物资借用三步流程](docs/assets/materials-preview.png)

### 会员中心

个人资料、参与记录、志愿时长（服务/培训/交通分列）、我的技能与温暖连接，一处查看全部参与痕迹。

![会员中心：志愿时长与活动报名进度](docs/assets/member-preview.png)

### 管理端 · 运营总览

集中展示待办摘要、活动健康、库存与在办，以及待办分布；合成数据不含真实运营指标。

![管理端运营总览：待办队列与活动运营](docs/assets/console-overview-preview.png)

### 管理端 · 活动管理

统一的审批发布、名单确认、签到核验与时长审核工作区，支持批量录取、成功邮件编辑与 Excel 导出。

![管理端活动管理：名单确认与录取通知](docs/assets/console-events-preview.png)

### 管理端 · 物资管理

借用审批、库存台账、出入库流水与低库存预警，配合扫码定位完成现场盘点与归还核验。

![管理端物资管理：任务队列与库存台账](docs/assets/console-materials-preview.png)

### 管理端 · 内建管理与留言墙

生日祝福、早安晚安的登记审核与举报处理；红会留言墙让每一段寄语有署名、有出处、可下架。

| 内建管理 | 红会留言墙 |
| --- | --- |
| ![管理端内建管理：参加登记与人工确认](docs/assets/console-community-preview.png) | ![管理端红会留言墙：发布与下架](docs/assets/console-messages-preview.png) |

### 管理端 · 管理员中心

账号、模块权限、工作区偏好、系统状态与操作记录的集中入口。

![管理端管理员中心：账号与模块权限](docs/assets/console-admin-preview.png)

</details>

合成截图更新于 **2026-10-25**，源码基线 `7de12c8`；线上实况截图更新于 **2026-11-22**。两套素材的来源、边界和复现方法见 [截图说明](docs/SCREENSHOTS.md)。

## 功能地图

平台以公众门户、运营管理端和一组共享 HTTP/领域模块组成。前端无构建过程，桌面与手机共用原生组件和设计系统；服务端统一处理会话、CSRF、权限、请求预算与脱敏观测。

### 公众端（面向全体同学）

| 页面 | 路径 | 功能说明 |
| --- | --- | --- |
| 官网首页 | `/` | 活动轮播、实时统计（开放活动/名额/报名人次/物资品类）、千纸鹤寄语墙、专题入口 |
| 活动广场 | `/events` | 按类别/地区/校区/状态筛选活动，查看详情并报名，报名后可查询结果与请假 |
| 献血车日历 | `/workflow-events?type=blood` | 按周次与点位浏览献血车班次，显示剩余名额与报名状态 |
| 宣传广场 | `/outreach` | 投稿专栏、影像作品、任务申领、技能认证与宣传展示；支持署名或匿名 |
| 活动影像库 | `/photos` | 按部门与活动归档现场照片，提交精选申请、申请删除并查看预览 |
| 宣传展示墙 | `/showcase` | 公众号推文与已通过的文创作品按栏目/类别分节展示 |
| 任务申领 | `/tasks` | 查看宣传任务心愿清单，按技能认领并等待发布人审核 |
| 内建广场 | `/community` | 生日祝福、早安晚安·同行计划的加入、审核与匹配说明 |
| 同行广场 | `/morning/plaza` | 浏览已审核的早安晚安名片与邀约状态 |
| 物资广场 | `/materials` | 物资清单查看与借用申请；`/reimbursements` 提供报销入口 |
| 会员中心 | `/me` | 个人资料、参与记录、志愿时长、我的技能、温暖连接与账号设置 |
| 参与状态 | `/status` | 凭报名编号查询本人参与与签到记录 |
| 反馈入口 | 全站页头 | 选择活动、物资、内建、宣传或其他分类提交意见，活动类反馈关联具体活动 |
| 主题小游戏 | `/games/uno` · `/games/climate` | 南小红 UNO 人机/联机练习，以及气候与人道行动主题桌游协调工具 |
| 注册 / 登录 | `/register` · `/login` | 校园邮箱验证码注册，支持学号/姓名别名登录 |

### 管理端（面向运营与负责人，`/console`）

| 板块 | 路径 | 功能说明 |
| --- | --- | --- |
| 运营总览 | `/console/overview` | 待办事项队列、活动健康、库存与在办、通知中心 |
| 活动管理 | `/console/events` | 活动创建与审批发布、名单确认与录取通知、签到核验、时长审核与导出 |
| 活动日历 | `/console/calendar` | 按日期查看活动节奏与待办入口 |
| 宣传管理 | `/console/outreach` | 投稿审核、排期发布、影像归档与展示维护 |
| 展示与照片墙 | `/console/showcase` · `/console/gallery` | 宣传展示条目维护、影像审核与精选/删除审核 |
| 内建管理 | `/console/community` | 生日祝福与早安晚安的登记审核、举报处理 |
| 物资管理 | `/console/materials` | 借用审批、库存台账、出入库流水、扫码定位与归还核验 |
| 报销与财务 | `/console/reimbursements` | 独立授权的报销材料、汇总与台账工作区 |
| 红会留言墙 | `/console/messages` | 留言整理、发布与下架 |
| 问题反馈 | `/console/feedback` | 按范围和权限查看反馈、记录解决方案与通知状态 |
| 工作助手 | `/console/agent` | 活动筹备、推文创作与美编建议的 AI 辅助 |
| 管理员中心 / 操作日志 | `/console/admin` · `/console/audit` | 账号与模块权限、工作区偏好、系统状态、操作记录与数据维护 |

## 平台能力

公众端以活动、宣传、内建、物资四个广场和会员中心为主入口，管理端按运营职责分板块；共享身份、附件、消息、队列和审计能力支撑两端流程。

| 场景 | 参与者体验 | 运营与协作 |
| --- | --- | --- |
| 活动与献血车 | 活动目录、周日历、报名、结果查询、请假与签到 | 活动申请与发布、名单确认、签到核验、时长审核与 Excel 导出 |
| 宣传广场 | 投稿专栏、影像作品、任务申领、技能认证与宣传展示 | 多级审核、申领审批、部门/活动附件归位与展示维护 |
| 内建广场 | 生日祝福、早安晚安同行名片、兴趣筛选与留言 | 祝福与名片审核、举报处理和成员管理 |
| 物资广场 | 物资查询与借用申请 | 审批、库存、出库、归还与流水 |
| 影像与展示 | 活动照片归档、精选申请、推文/文创浏览 | 附件归档、审核链、删除审核与展示维护 |
| 会员中心 | 个人资料、本人参与记录、任务与账号设置 | 按业务权限读取本人记录 |
| 反馈与通知 | 分类提交问题、查询报名状态 | 反馈分派、解决回复、邮件与汇总通知 |
| 校园互动 | UNO 与气候主题桌游 | 轻量游戏与规则工具，不承载正式业务写入 |
| 管理平台 | 管理员中心、运营总览与红会留言墙 | 模块权限、活动/宣传/内建/物资管理、设置与系统状态 |

账号角色为 `member`、`platform_admin`、`super_admin`，管理员可按模块授权；财务和地区审批另有独立绑定。实现与配置见 [架构](docs/ARCHITECTURE.md)、[正式数据连接](docs/PRODUCTION_DATA.md)、[任务与技能](docs/TASKS_AND_SKILLS.md)、[审核工作流](docs/REVIEW_WORKFLOW_MANUAL.md) 和 [安全巡检](docs/SECURITY_INSPECTION.md)。

## 快速开始

需要 Git、npm 和 **Node.js 22.13+**，建议使用 `.nvmrc` 指定的 Node.js 24；CI 覆盖 Node.js 22、24、26。

```bash
git clone https://github.com/WANGLEVY9/NJURedCross.git
cd NJURedCross
npm ci --ignore-scripts
npm run preview
```

打开 <http://127.0.0.1:3000>。静态预览无需配置，业务请求显示未配置提示。停止服务使用 Ctrl+C。

体验合成数据下的完整业务与管理流程（含本页截图场景）：

```bash
npm run preview:workflow   # 打开 http://127.0.0.1:3121，自动进入合成管理员会话
npm run screenshots        # 可选：重新生成 docs/assets 下的本地合成截图
```

打开 <http://127.0.0.1:3121>。数据保存在内存，重启后恢复演示初始状态；该模式不连接学校数据服务或邮件服务。完整业务联调按 [运行与复现指南](docs/GETTING_STARTED.md) 配置独立测试环境。

检查代码、文档和合成业务回归：

```bash
npm run verify
npm run check:links
npm run check:security
```

浏览器回归首次安装 Chromium 后执行：

```bash
npx playwright install chromium
npm run test:browser
```

平台为原生 ES Modules / CSS，前端直接提供静态资源，无需编译。详细环境、端口和故障排查见 [运行指南](docs/GETTING_STARTED.md)。

## 使用指引

1. 新贡献者先在 [Discussions](https://github.com/WANGLEVY9/NJURedCross/discussions) 或 Issue 中确认场景与范围，再运行 [快速开始](#快速开始) 的无凭据预览。
2. 界面与交互改动请在桌面和手机视口核对键盘焦点、加载态、错误态，尽量附合成截图；权限、身份、Schema、迁移或附件改动要补对应回归。
3. 提交前至少运行 `npm run verify`、`npm run check:links`、`npm run check:security`；改动生产依赖时再运行 `npm run audit:dependencies`。
4. PR 写明触发场景、行为变化、验证命令、结果和恢复方法；不要提交 `.env`、Token、Cookie、生产日志、照片或真实业务导出。
5. 线上运营问题请走平台内反馈或 [支持指南](SUPPORT.md)，不要公开提交个人报名、借用或账号资料。

第一次贡献可以从文字修正、合成环境复现、键盘/手机布局检查或小范围回归开始，无需生产数据权限。维护者通过审核、反馈和合并帮助贡献落地；参与和署名方式见 [CONTRIBUTORS](CONTRIBUTORS.md)。

## 参与共建

项目的协作是公开的：[Issues](https://github.com/WANGLEVY9/NJURedCross/issues) 承载可复现问题和范围明确的功能，[Discussions](https://github.com/WANGLEVY9/NJURedCross/discussions) 承载使用交流与方案讨论，[Pull Requests](https://github.com/WANGLEVY9/NJURedCross/pulls) 承载可审查的变更。使用 [结构化表单](https://github.com/WANGLEVY9/NJURedCross/issues/new/choose)、[PR 模板](.github/pull_request_template.md) 和 [贡献指南](CONTRIBUTING.md) 能减少来回补充信息。

社区采用 [行为准则](CODE_OF_CONDUCT.md)，由 [项目治理](GOVERNANCE.md) 说明维护职责、评审和发布决策。安全漏洞只通过 [私密报告](SECURITY.md) 提交；行为问题也按私密渠道处理。线上业务中的个人资料由运营团队核验，GitHub 只用于软件协作。

## 技术与架构

**前端**：原生 JavaScript ES Modules、CSS、共享组件、主题与动效。

**后端**：Node.js 原生 HTTP、SeaTable SDK、Nodemailer、ExcelJS 与附件适配。

**验证**：Node 原生测试、Playwright 桌面/手机及跨浏览器回归、Python 发布安全检查。

**安全**：统一安全响应头、会话/CSRF/权限边界、分桶限流、脱敏遥测、生产依赖公告和 `npm run check:security` 源码巡检。

```text
server.js       服务组装、会话、权限与业务路由
lib/            身份、活动、宣传任务、附件、内建、邮件与 HTTP
public/         官网、会员与管理端、共享组件、样式与静态资源
scripts/        检查、预览、截图、迁移、诊断与发布工具
tests/          合成业务、浏览器、时区与发布安全回归
ops/            部署相关配置示例
docs/           架构、设计、运行与运营指南
reports/        按日期保存的核验摘要与历史记录
.github/        CI/CD、协作表单与 PR 模板
```

模块入口见 [后端](lib/README.md)、[前端](public/README.md)、[脚本](scripts/README.md) 和 [测试](tests/README.md)。

## 质量与发布

[GitHub Actions](https://github.com/WANGLEVY9/NJURedCross/actions/workflows/ci.yml) 在 main 推送、PR、手动触发和每日计划中运行。质量门禁包括 Node.js 22/24/26 × Linux/Windows 验证、源码安全巡检、发布安全、桌面/手机 Chromium、Firefox/WebKit 关键流程、三个业务时区及 HTTP 覆盖率。完整配置以 [CI 工作流](.github/workflows/ci.yml) 为准，当前测试数随代码增长，以 Actions 输出为准。

贡献者使用分支与 PR；Owner 已授权的维护可按仓库约定验证后直接推送 main。`Quality gate` 通过后，main 自动部署，服务器发布清单记录提交与运行文件哈希。发布、配置及数据迁移分别管理，操作流程见 [部署与回滚](docs/OPERATIONS.md)。

当前以单实例运行；跨表写入、跨实例协调和历史时长对账的约定集中在 [架构](docs/ARCHITECTURE.md)、[缓存与队列](docs/CACHE_AND_QUEUE.md) 与 [正式数据连接](docs/PRODUCTION_DATA.md)。

## 共建者与协作者

感谢每一位为 NJURedCross 付出时间与热心的开源伙伴。无论是代码、设计、测试、文档，还是一次建议与反馈，你的贡献都让这个项目变得更好。很高兴与你们一起，把校园公益做好。

<table>
<tr>
<td align="center"><a href="https://github.com/Anntharv"><img src="https://avatars.githubusercontent.com/u/234371240?v=4&amp;s=96" width="64" height="64" alt="Anntharv" /><br /><sub><b>Anntharv</b></sub></a></td>
<td align="center"><a href="https://github.com/centriole0413"><img src="https://avatars.githubusercontent.com/u/234552169?v=4&amp;s=96" width="64" height="64" alt="centriole0413" /><br /><sub><b>centriole0413</b></sub></a></td>
<td align="center"><a href="https://github.com/Daily-6"><img src="https://avatars.githubusercontent.com/u/240302833?v=4&amp;s=96" width="64" height="64" alt="Daily-6" /><br /><sub><b>Daily-6</b></sub></a></td>
<td align="center"><a href="https://github.com/Klein-Morett"><img src="https://avatars.githubusercontent.com/u/248385252?v=4&amp;s=96" width="64" height="64" alt="Klein-Morett" /><br /><sub><b>Klein-Morett</b></sub></a></td>
<td align="center"><a href="https://github.com/Nport-hut"><img src="https://avatars.githubusercontent.com/u/311099834?v=4&amp;s=96" width="64" height="64" alt="Nport-hut" /><br /><sub><b>Nport-hut</b></sub></a></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/pace-ys-xv"><img src="https://avatars.githubusercontent.com/u/337366607?v=4&amp;s=96" width="64" height="64" alt="pace-ys-xv" /><br /><sub><b>pace-ys-xv</b></sub></a></td>
<td align="center"><a href="https://github.com/Rouin101"><img src="https://avatars.githubusercontent.com/u/254252743?v=4&amp;s=96" width="64" height="64" alt="Rouin101" /><br /><sub><b>Rouin101</b></sub></a></td>
<td align="center"><a href="https://github.com/WANGLEVY9"><img src="https://avatars.githubusercontent.com/u/144114671?v=4&amp;s=96" width="64" height="64" alt="WANGLEVY9" /><br /><sub><b>WANGLEVY9</b></sub></a></td>
<td align="center"><a href="https://github.com/xinyue-L01"><img src="https://avatars.githubusercontent.com/u/251607349?v=4&amp;s=96" width="64" height="64" alt="xinyue-L01" /><br /><sub><b>xinyue-L01</b></sub></a></td>
<td align="center"><a href="https://github.com/zhoumiaoooooo"><img src="https://avatars.githubusercontent.com/u/275862772?v=4&amp;s=96" width="64" height="64" alt="zhoumiaoooooo" /><br /><sub><b>zhoumiaoooooo</b></sub></a></td>
</tr>
</table>

完整名单、署名方式与更新说明见 [CONTRIBUTORS](CONTRIBUTORS.md)。代码贡献记录见 [GitHub Contributors](https://github.com/WANGLEVY9/NJURedCross/graphs/contributors)。设计、测试、文档和讨论同样是项目建设的一部分。


## 文档与许可

[文档导航](docs/README.md) · [设计系统](DESIGN.md) · [测试](docs/TESTING.md) · [更新记录](CHANGELOG.md) · [项目治理](GOVERNANCE.md) · [可访问性](ACCESSIBILITY.md) · [支持](SUPPORT.md)

源码采用 [Mozilla Public License 2.0](LICENSE)。复用、贡献、第三方资源和品牌标识的说明集中在 [许可与资源](docs/LICENSING.md)；请保留正式许可与原作者通知。学校品牌、个人资料和运营服务按各自授权管理。
