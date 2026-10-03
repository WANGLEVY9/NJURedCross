# 基础设施回归

`infrastructure.test.mjs` 使用 Node 原生测试框架、临时目录、回环 HTTP 服务和合成 Token 验证基础设施行为。邮件使用内存流，SDK 不认证，不访问外网或学生资料。

```bash
npm run test:infrastructure
npm test
```

领域回归保留在 `scripts/test-*.mjs`，以避免改变既有运维路径。新基础设施行为测试放在此目录，领域测试按变更范围组织，禁止导入会启动真实服务的 `server.js`。
