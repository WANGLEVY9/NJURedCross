# 文档导航

## 持续维护的指南

- [线上基线](PRODUCTION_BASELINE.md)：本轮真实服务器来源与仓库关系。
- [志愿活动试点](WORKFLOW.md)：献血车、请假、照片、明细入账和正式迁移边界。

- [运行与复现](GETTING_STARTED.md)：离线测试、界面预览、完整业务环境。
- [代码架构](ARCHITECTURE.md)：组件、依赖、数据与权限边界。
- [页面与 API](API.md)：主要接口与会话/权限边界。
- [前端设计系统](FRONTEND_DESIGN.md)：组件、动效和数据图表约定。
- [开发约定](DEVELOPMENT.md)：模块命名、代码风格与变更流程。
- [测试指南](TESTING.md)：测试证据与真实系统冒烟边界。
- [部署与回滚](OPERATIONS.md)：版本、配置、迁移、验证与故障处理。
- [发布准备](RELEASE_READINESS.md)：开源分发、运营、商业化的待办与验收。
- [贡献](../CONTRIBUTING.md)、[安全](../SECURITY.md)、[协作](../CODE_OF_CONDUCT.md)。

## 模块说明

[后端](../lib/README.md) · [前端](../public/README.md) · [脚本](../scripts/README.md) · [测试](../tests/README.md) · [历史报告](../reports/README.md)。

## 专项设计与历史记录

以下文件保留既有路径，方案与历史实测需结合当前代码核对；不作为当前部署状态证明。

| 文档 | 用途 |
| --- | --- |
| [PLATFORM_ARCHITECTURE](../PLATFORM_ARCHITECTURE.md) | 原有功能及底表连通说明 |
| [VOLUNTEER_PROFILE_MAPPING](../VOLUNTEER_PROFILE_MAPPING.md) | 资料映射约束与专项实现 |
| [LOGIN_REGISTRATION_FLOW](../LOGIN_REGISTRATION_FLOW.md) | 登录注册流程设计 |
| [MATERIALS_MODULE](../MATERIALS_MODULE.md) | 物资映射与状态机 |
| [MATERIALS_GAP_ANALYSIS](../MATERIALS_GAP_ANALYSIS.md) | 物资模块历史缺口 |
| [DEVELOPMENT_PLAN](../DEVELOPMENT_PLAN.md) | 阶段建设计划 |
| [REMEDIATION_DESIGN_PLAN](../REMEDIATION_DESIGN_PLAN.md) | 历史整改设计 |
| [OUTREACH_COMMUNITY_DEVELOPMENT_PLAN](../OUTREACH_COMMUNITY_DEVELOPMENT_PLAN.md) | 宣传和温暖连接方案 |
| [PROJECT_WORKLIST](../PROJECT_WORKLIST_2026-09-19.md) | 2026-09-19 工作清单 |
| [DEPLOYMENT](../DEPLOYMENT.md) | 历史增量发布记录 |

新增日期性证据放 `reports/`；长期有效的操作说明放 `docs/`。修改指南时同步验证命令和本地链接。
