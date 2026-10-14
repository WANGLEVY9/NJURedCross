# 合成领域与基础设施回归

`infrastructure.test.mjs` 使用 Node 原生测试框架、临时目录、回环 HTTP 服务和合成 Token 验证基础设施行为。邮件使用内存流，SDK 不认证，不访问外网或学生资料。

```bash
npm run test:infrastructure
npm test
```

领域回归保留在 `scripts/test-*.mjs`，以避免改变既有运维路径。新基础设施行为测试放在此目录，领域测试按变更范围组织，禁止导入会启动真实服务的 `server.js`。

`npm run test:node` 运行全部 Node 套件；`npm test` 还包含既有权限、身份和资料脚本。测试数以实际输出为准。

SMTP/TLS 夹具覆盖证书身份与信任链、超时、取消和并发隔离；所有连接限制在回环。跨引擎测试通过 `npm run test:browser:cross` 执行。HTTP 层覆盖率门槛通过 `npm run test:coverage` 验证。真实发布包的隔离启动检查通过 `npm run test:release -- <archive>` 执行。详情与 CI 矩阵见 [测试指南](../docs/TESTING.md)。
