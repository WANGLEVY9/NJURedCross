# 安全政策 · Security Policy

## 维护范围

安全修复以当前 `main` 为维护基线。项目处于 Beta 阶段，目前没有带版本号的稳定发行系列；运行自己的部署时，请跟进 main 和 [更新记录](CHANGELOG.md)。运营配置与依赖也需按 [运维指南](docs/OPERATIONS.md) 定期维护。

## 私密报告

本仓库已启用 GitHub 私密漏洞报告。请通过 [GitHub Security Advisories](https://github.com/WANGLEVY9/NJURedCross/security/advisories) 的 **Report a vulnerability** 入口提交。若无法使用该入口，联系 [@WANGLEVY9](https://github.com/WANGLEVY9) 的已有组织内部渠道或 GitHub 主页公布的联系方式。尚无私密联系方式时，可公开请求接收渠道，仅说明需要安全联系，不发布漏洞细节。

报告包含：受影响提交和组件、使用合成数据的复现步骤、预期/实际结果、影响范围、必要的脱敏日志及修复建议。请使用自己的隔离测试环境和测试账号，保持验证规模可控；发现他人资料可访问时，停止读取并报告访问路径。

将真实 Token、Cookie、口令、验证码、学号、手机号、照片和数据导出留在受保护渠道，避免放入公开 Issue、PR 或截图。GitHub 私密报告机制的使用方式见 [官方说明](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)。

## 处理与披露

维护者会核对报告、评估影响，与报告者协商复现和修复验证，必要时通过私有协作修复。修复通过检查并完成受影响部署验证后，协调公告及披露时间；致谢方式尊重报告者意愿。当前由志愿维护者处理，不设固定响应时限或漏洞赏金计划。

若发现凭据泄露，运营者应及时撤销并轮换凭据，检查访问与审计记录，核对影响范围及必要恢复措施。

## 安全工程与运营

CI 覆盖权限、身份、HTTP 边界、依赖公告与发布安全。生产验收包括 TLS、会话与权限、邮件/数据服务、受保护照片存储、备份恢复和发布哈希，统一见 [OPERATIONS](docs/OPERATIONS.md)。账号角色与模块授权见 [架构](docs/ARCHITECTURE.md)。

凭据使用未跟踪的 `.env`，身份与业务 Base 分开配置，生产邮件走 SMTP。开发和合成回归使用隔离环境；志愿工作流写入遵循指定测试 UUID 门禁及 [数据连接约定](docs/PRODUCTION_DATA.md)。
