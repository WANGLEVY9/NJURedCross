# 合成领域与基础设施回归

`infrastructure.test.mjs` 使用 Node 原生测试框架、临时目录、回环 HTTP 服务和合成 Token 验证基础设施行为。邮件使用内存流，SDK 不认证，不访问外网或学生资料。

```bash
npm run test:infrastructure
npm test
```

领域回归保留在 `scripts/test-*.mjs`，以避免改变既有运维路径。新基础设施行为测试放在此目录，领域测试按变更范围组织，禁止导入会启动真实服务的 `server.js`。

`npm run test:node`运行全部Node套件，当前42项，覆盖事件队列/容量、上游失败会话保留、验证码同时间排序、报名与签到关联、十列导出、审批与半成功恢复、献血车/照片。`test:infrastructure`仅运行基础设施文件；`npm test`包含21项权限、103项身份与28项资料检查。
