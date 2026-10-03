# 南京大学红十字会平台

校园公共服务门户与内部运营控制台，共享 Node.js 服务端、权限体系和 SeaTable 数据核心。当前定位为持续共创的功能 Beta；功能实现、自动化测试和真实业务验收分别记录。

| 界面 | 入口 | 主要能力 |
| --- | --- | --- |
| 公众门户 | `/` | 活动、物资借用、投稿、温暖连接与个人记录 |
| 运营控制台 | `/console` | 审批、库存流水、活动签到、内容审核、数据与审计 |

技术栈：Node.js 原生 HTTP、JavaScript ES Modules、原生浏览器模块与 CSS、SeaTable SDK、Nodemailer、QRCode。前端无需打包；数据库凭据只在服务端使用。源码沿用 [MPL-2.0](LICENSE)，`private: true` 用于避免误发布到 npm。

## 从这里开始

安装 Node.js **22.13+**；项目默认 `.nvmrc` 为 24，CI 配置覆盖 22/24 与 Linux/Windows。使用 lockfile 安装：

```bash
npm ci --ignore-scripts
npm run verify
npm run preview
```

打开 <http://127.0.0.1:3000>。`preview` 仅提供界面、匿名会话和业务未配置提示，不读取 `.env`，不连接 SeaTable，不支持登录或表单提交。需要真实功能时按 [完整运行指南](docs/GETTING_STARTED.md) 配置独立测试 Base、私有身份 Base 和账号。

```bash
cp .env.example .env
# 按运行指南填写测试环境凭据与会话密钥
npm start
```

已有 `.env` 时无需重新复制。源码不包含业务数据、个人信息或生产账号，完整业务复现需要具备相应的数据源访问权与表结构。离线测试使用内存中的合成数据。

## 开发与验证

| 命令 | 用途 | 环境 |
| --- | --- | --- |
| `npm run preview` | 界面预览，API 返回未配置提示 | 无凭据 |
| `npm run check` | 全模块语法、相对导入与 Markdown 本地链接检查 | 无凭据 |
| `npm run lint` | ESLint 正确性规则 | 无凭据 |
| `npm test` | 权限、身份、资料映射、HTTP 与依赖兼容性回归 | 合成数据，无外部服务 |
| `npm run verify` | 统一提交前检查 | 无凭据 |
| `npm run audit:dependencies` | npm 依赖公告审计 | 需要 registry 网络 |
| `npm run dev` | 加载 `.env`，监视后端变更 | 独立测试环境 |
| `npm run smoke:public` | 页面、资源与公开接口冒烟 | 已运行的完整实例 |

账号冒烟、身份/活动冒烟、建表与清理脚本有各自的配置和写入边界；执行前阅读 [脚本目录说明](scripts/README.md) 与 [测试指南](docs/TESTING.md)。

## 项目组织

```text
server.js             应用组装、会话守卫与尚待逐步抽取的业务路由
lib/                  身份、活动、邮件、权限、SeaTable 认证、HTTP 公共模块
public/               原生 ES Module 前端、双界面页面与设计系统
scripts/              检查、合成测试、只读预览与显式执行的运维工具
tests/                Node.js 原生测试框架基础设施回归
docs/                 持续维护的开发、架构、运行与发布文档
reports/              按日期保存的历史 QA 证据与报告源代码
.github/              CI、问题模板与 PR 模板
```

[代码架构](docs/ARCHITECTURE.md) 说明模块依赖与业务边界；各代码目录 README 说明文件职责和扩展入口。根目录现有专项计划保留原路径，在 [文档索引](docs/README.md) 中区分持续指南与历史方案。

## 参与共创

变更记录见 [CHANGELOG](CHANGELOG.md)。阅读 [贡献指南](CONTRIBUTING.md)、[协作公约](CODE_OF_CONDUCT.md) 和 [安全说明](SECURITY.md)。通过小范围 PR 提交修改，附验证命令和结果；涉及表结构、权限或个人信息的修改说明影响与回滚方式。CI 验证代码，不自动部署。

## 当前限制与发布边界

- 库存、注册和资料映射的锁、限流与部分会话状态在单进程内；多实例部署需先设计共享状态、唯一约束或事务。
- 业务路由仍较多集中在 `server.js`，后续按物资、宣传与温暖连接分批抽取，保持 API 和数据契约稳定。
- 学校统一身份认证需要校方服务与授权；SMTP、NJUBox、真实资料同步需在目标环境单独验收。
- 业务写入与审计并非跨表事务；故障重放、监控、备份恢复和容量测试是发布前的独立事项。
- 品牌标记、第三方依赖与业务数据的使用范围需分别核对；代码许可不代表可访问或再分发个人数据。

详见 [发布准备](docs/RELEASE_READINESS.md)、[部署与回滚](docs/OPERATIONS.md) 和 [本轮审查记录](reports/ENGINEERING_REVIEW_2026-10-03.md)。
