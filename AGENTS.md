# 仓库工作约定

- Owner 为 WANGLEVY9。Owner 已授权目前全部 10 位贡献者（WANGLEVY9、Anntharv、centriole0413、Daily-6、Klein-Morett、xinyue-L01、Rouin101、zhoumiaoooooo、Nport-hut、pace-ys-xv）在完成相关检查后直接提交并推送 main，无需为每次修改建立 PR。PR 仍可用于需要协作审阅的修改；其他未授权开发者按 CONTRIBUTING.md 使用分支与 PR。
- 每次 main 提交通过 CI 后自动部署。任务结束前检查 Actions 部署结果、服务器发布清单与线上实际页面；如未部署成功，明确报告并处理，不以推送替代部署。
- 不强推、不删除 main。先检查最新 main，保留已有改动；工作区有不属于当前任务的修改时使用干净的独立检出，不能一并提交。
- 生产 .env、API Token、数据库、照片、账号和部署私钥不得提交源码。自动发布与数据库迁移独立；合成测试不得写入真实业务表。
- 部署流程及回滚见 docs/OPERATIONS.md。UI 工作保持现有原生 JavaScript/CSS 架构与共享组件。
