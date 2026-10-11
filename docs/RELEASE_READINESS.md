# 发布准备

发布前的自查清单与范围说明。以仓库当前能力为基线：不为了目录外观引入微服务或前端构建链。

## 开源分发

- 许可为 [MPL-2.0](../LICENSE)。第三方依赖、图片、品牌与业务数据的授权范围分别核对。
- `private: true` 防止误发布 npm 包，不影响 Git 仓库公开开发。
- 公开发布前检查拟发布树与历史中是否包含 Token、密码、学生信息、备份或内部业务导出。`scripts/package-release.py` 只打包已跟踪的运行源码。
- 源码开放不等于学校数据服务对公众开放：外部贡献者使用合成测试与预览，正式维护者在有授权的环境复现业务。

## 发布前自查表

| 项目 | 门槛 | 当前状态 |
| --- | --- | --- |
| 可复现开发 | lockfile 安装、`npm run verify`、文档入口 | CI 覆盖 Node 22/24 × Linux/Windows |
| 身份安全 | 私有 Base、scrypt 口令哈希、权限与字段拒绝路径 | 合成回归覆盖；目标环境集成核验 |
| 依赖升级 | 公告审计、API 兼容、外部服务回归 | `npm run audit:dependencies`；重大升级需集成验证 |
| 数据一致性 | 并发、跨表故障、重复请求、重放 | 试点有绝对汇总恢复回归；跨表按最终一致处理 |
| 运行可靠性 | 容量、监控、恢复演练、故障响应 | 由服务负责人制定并验收 |
| 资料治理 | 最小采集、授权、撤回、保留、访问审批 | 字段白名单已实现；组织流程另行核验 |
| 共创治理 | reviewer、版本计划、变更日志、漏洞接收 | 模板见 [CONTRIBUTING](../CONTRIBUTING.md) 与 [SECURITY](../SECURITY.md) |
| 商业发行 | 服务条款、支持责任、依赖与品牌核查 | 由相应负责人确认范围 |

## 优先级

先把 `server.js` 中剩余的业务路由按域抽取，补集成测试，再评估数据库事务与多实例方案。

## 参考

- [GitHub 社区文件指南](https://docs.github.com/en/enterprise-cloud%40latest/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file) —— 文档入口与模板
- [GitHub 工作流说明](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows) —— CI 组织
- [Node.js 发布周期](https://github.com/nodejs/Release) —— 版本范围

线上范围与试点剩余项见 [线上部署现状](PRODUCTION_BASELINE.md) 与 [试点说明](WORKFLOW.md)。
