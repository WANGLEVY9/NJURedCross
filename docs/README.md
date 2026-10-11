# 文档导航

## 持续维护的指南

**运行与架构**

- [运行与复现](GETTING_STARTED.md)：离线测试、界面预览、完整业务环境。
- [代码架构](ARCHITECTURE.md)：模块、依赖、数据与权限边界。
- [正式数据连接](PRODUCTION_DATA.md)：活动、献血车与独立存储表的现行说明。
- [页面与 API](API.md)：主要接口与会话/权限边界。
- [前端设计系统](FRONTEND_DESIGN.md)：组件、动效和数据图表约定。
- [开发约定](DEVELOPMENT.md)：模块命名、代码风格与变更流程。

**验证与运维**

- [测试指南](TESTING.md)：测试套件与真实系统冒烟边界。
- [部署与回滚](OPERATIONS.md)：发布流程、CI/CD、验证与故障处理。
- [线上部署现状](PRODUCTION_BASELINE.md)：运行拓扑、核对方式与数据边界。
- [发布准备](RELEASE_READINESS.md)：开源分发与发布前自查表。

**业务模块**

- [志愿活动流程](WORKFLOW.md)：试点流程与正式数据迁移条件。
- [早安晚安](MORNING.md)：同行名片、审核、留言、举报与生产配置。
- [页面加载与数据刷新](PAGE_LOADING_PERFORMANCE.md)：缓存范围与刷新时效。

**协作**

- [共建团队](../CONTRIBUTORS.md)：完整协作者名单、贡献署名与维护方式。
- [贡献](../CONTRIBUTING.md) · [安全](../SECURITY.md) · [协作](../CODE_OF_CONDUCT.md)。

## 模块说明

[后端](../lib/README.md) · [前端](../public/README.md) · [脚本](../scripts/README.md) · [测试](../tests/README.md) · [历史报告](../reports/README.md)。

## 专项设计

| 文档 | 用途 |
| --- | --- |
| [MATERIALS_MODULE](../MATERIALS_MODULE.md) | 物资映射与状态机 |
| [LOGIN_REGISTRATION_FLOW](../LOGIN_REGISTRATION_FLOW.md) | 登录注册流程设计 |
| [VOLUNTEER_PROFILE_MAPPING](../VOLUNTEER_PROFILE_MAPPING.md) | 资料映射约束与专项实现 |

## 历史归档

2026-09 阶段的底表快照、整改方案与工作清单已归档，仅供追溯，其中的结论需结合当前代码核对：

| 文档 | 用途 |
| --- | --- |
| [PLATFORM_ARCHITECTURE](../reports/archive/PLATFORM_ARCHITECTURE.md) | 2026-09 底表连通说明 |
| [PROJECT_WORKLIST](../reports/archive/PROJECT_WORKLIST_2026-09-19.md) | 2026-09-19 工作清单 |
| [MATERIALS_GAP_ANALYSIS](../reports/archive/MATERIALS_GAP_ANALYSIS.md) | 物资模块历史缺口 |
| [DEVELOPMENT_PLAN](../reports/archive/DEVELOPMENT_PLAN.md) | 阶段建设计划 |
| [REMEDIATION_DESIGN_PLAN](../reports/archive/REMEDIATION_DESIGN_PLAN.md) | 历史整改设计 |
| [OUTREACH_COMMUNITY_DEVELOPMENT_PLAN](../reports/archive/OUTREACH_COMMUNITY_DEVELOPMENT_PLAN.md) | 宣传和温暖连接方案 |

新增日期性证据放 `reports/`；长期有效的操作说明放 `docs/`。修改指南时同步验证命令和本地链接。
