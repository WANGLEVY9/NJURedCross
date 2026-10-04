# 南京大学红十字会平台

面向校园公共服务与内部运营的 Node.js 网站：公众门户、运营控制台及志愿活动试点共用服务端身份与权限体系，业务数据由 SeaTable 承载。当前为 **功能 Beta**，持续接受代码、文档和合成回归贡献。

本次源码同步基于 **2026-10-04 实际服务器文件快照**，不是仅以服务器 Git HEAD 推断部署版本。线上状态、代码一致性、历史验收与未完成项见 [线上基线](docs/PRODUCTION_BASELINE.md)。

## 功能入口与状态

| 入口 | 能力 | 当前边界 |
| --- | --- | --- |
| `/`、`/events` | 公众服务、活动浏览与报名 | 业务容量由服务端判定 |
| `/materials`、`/submit`、`/warmth` | 物资借用、内容投稿、温暖连接 | 提交需账号，审核和执行由负责人完成 |
| `/login`、`/register`、`/me` | 学号补全校园邮箱、验证、个人资料和本人记录 | 不是学校 CAS；备用完整邮箱/姓名/管理账号登录仍保留 |
| `/console/*` | 白天主题控制台，物资、活动、志愿、宣传、数据和审计 | 管理角色、权限范围与写请求 CSRF 均由服务端检查 |
| `/workflow-events`、`/console/workflow` | 试点报名、献血车模板排班、请假、照片核验、时长核对/批准和入账 | 仅指定测试副本，六张独立表；正式历史累计未迁移 |

照片、凭据和私有身份数据不通过公众静态目录提供。前端是原生 ES Modules 与 CSS，不需要构建工具；后端使用原生 HTTP、SeaTable SDK、Nodemailer 与 QRCode。源码保留 [MPL-2.0](LICENSE)，`private: true` 防止误发布 npm 包。

## 无凭据启动

需要 **Node.js 22.13+** 和 npm；`.nvmrc` 默认 24，当前线上为 22.23.2。先按 lockfile 安装：

```bash
npm ci --ignore-scripts
npm run verify
npm run preview
```

打开 <http://127.0.0.1:3000>。普通 preview 仅提供界面、匿名会话和业务未配置提示，不加载 `.env`、不登录真实账号、不开启真实业务 API。

试点界面另有合成演示：

```bash
npm run preview:workflow
```

打开 <http://127.0.0.1:3121/console/workflow> 或 <http://127.0.0.1:3121/workflow-events>。使用内存数据、合成账号和固定测试时钟，不访问 SeaTable 或 SMTP；不具备真实鉴权验收意义。

## 完整业务环境

```bash
cp .env.example .env
# 按运行指南填入独立测试环境的凭据、Base UUID 和会话密钥
npm start
```

已有 `.env` 时不要覆盖。完整功能需要实际底表、账号和外部服务授权；源码不附真实业务记录、验证码、账号文件或生产配置。详见 [运行与复现](docs/GETTING_STARTED.md)、[试点流程](docs/WORKFLOW.md) 和 [部署维护](docs/OPERATIONS.md)。

`.env.example` 的 `PLATFORM_TEST_WORKFLOW=false` 默认关闭试点。启用还必须符合代码规定的测试副本 UUID；不能更换为正式 Base 后继续写入。正式迁移须先解决旧周期脚本、唯一入账写入者及历史对账。

## 开发命令

| 命令 | 用途 | 数据访问 |
| --- | --- | --- |
| `npm run check` / `npm run lint` | 模块语法、相对导入、文档链接与 ESLint | 本地 |
| `npm test` / `npm run verify` | 权限、身份、资料与 Node 回归；verify 还执行检查/lint | 合成数据 |
| `npm run test:node` | 所有 Node 原生测试 | 临时目录、回环 HTTP 与内存夹具 |
| `npm run test:infrastructure` | HTTP、认证与依赖基础设施专项 | 合成数据 |
| `npm run dev` | 加载 `.env` 并监视后端 | 配置的数据源 |
| `npm run smoke:public` | 公众页面、资源、公开 API 与匿名权限边界 | 在线只读 |
| `npm run workflow:schema:preview` | 检查试点所需表/字段 | 指定测试副本，只预览 |
| `npm run audit:dependencies` | 依赖公告审计 | npm registry |

旧身份/活动冒烟和真实测试副本联调可能发码或写行，不属于默认验证。先阅读 [脚本目录](scripts/README.md) 和 [测试指南](docs/TESTING.md)。

## 目录与共创

```text
server.js        应用组装、会话/权限与部分业务路由
lib/             身份、HTTP、活动流程、邮件与数据适配
public/          双界面外壳、页面、共享组件及设计系统
scripts/         检查、预览、Schema 与受控运维工具
tests/           合成领域/HTTP/故障恢复回归
docs/            持续维护的运行、架构、API 与运营指南
reports/         日期性验证摘要；原始截图/记录保留本地
.github/         CI 与 Issue/PR 模板
```

阅读 [架构](docs/ARCHITECTURE.md)、[文档导航](docs/README.md)、[贡献指南](CONTRIBUTING.md) 和 [安全说明](SECURITY.md)。提交小范围变更，写明触发场景、测试、配置/Schema 影响与恢复方式。CI 覆盖 Node 22/24、Linux/Windows，不自动部署。变更历史见 [CHANGELOG](CHANGELOG.md)。

## 已知限制

- 单进程锁、限流、会话撤销和队列不能保证多实例协调；跨表恢复不等于数据库事务。
- 试点照片需人工核验，未实现日期真实性自动鉴定；照片目录必须纳入受保护备份。
- 试点时长与旧历史累计独立展示；十列录入表目前是草稿预览，未交付真实 xlsx 上传。
- 学校统一认证、正式历史迁移、入账调整、多实例、容量与恢复演练仍需独立验收。
- 代码许可不提供品牌授权或业务数据访问权；公开记录与截图须脱敏。

发布门槛见 [发布准备](docs/RELEASE_READINESS.md)。
