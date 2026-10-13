# 合成领域与基础设施回归

`infrastructure.test.mjs` 使用 Node 原生测试框架、临时目录、回环 HTTP 服务和合成 Token 验证基础设施行为。邮件使用内存流，SDK 不认证，不访问外网或学生资料。

```bash
npm run test:infrastructure
npm test
```

领域回归保留在 `scripts/test-*.mjs`，以避免改变既有运维路径。新基础设施行为测试放在此目录，领域测试按变更范围组织，禁止导入会启动真实服务的 `server.js`。

`npm run test:node`运行全部Node套件，覆盖事件队列/容量、上游失败会话保留、验证码同时间排序、报名与签到关联、十列导出、审批与半成功恢复、献血车/照片，以及物资管理。`test:infrastructure`仅运行基础设施文件；`test:materials`仅运行物资服务、本地生命周期、页面模型及合成预览HTTP回归。`npm test`另包含权限、身份与资料检查，数量以实际输出为准。

`materials-lifecycle.test.mjs` 验证本地新增库存单计、部分失败回退、停用/恢复幂等，以及停用后允许原申请归还但拒绝新增出库。预览 HTTP 套件验证新接口沿用会话、CSRF 和来源限制；这些合成回归不证明真实底表存在停用状态字段。

`materials-source.test.mjs` 验证只读查看器的物资 Base 校验、表白名单、上游错误脱敏和禁止写入，不实际认证或访问 API。

`materials-movements.test.mjs` 验证统一出入库登记、采购与归还分流、照片留痕、重复提交、库存不足、错误资产和超额归还、损耗结算，以及只读 API 分页到本地副本的隔离边界。假 API 只接受 GET，副本写入后断言源记录未变、没有新 API 请求；本地 HTTP 路径验证会话、CSRF、来源限制和明确的本地写入标记。测试不使用真实凭据。

`reimbursements.test.mjs` 验证本地 PDF 合并与原件保留、购买方字段提示、金额分值精度、账号隔离、提交幂等、退回补充、审核版本和人工核对要求；HTTP 测试通过隔离工作线程处理合成 PDF，测试不会向外部服务上传材料。报销功能目前只有本地适配器，不证明生产附件存储或审核人权限已配置。

`reimbursements-analysis.test.mjs` 验证本地 OCR 与疑似红章提示、原件页码映射、权限与缓存隔离、重复请求、失败后重试和识别不修改审核状态。真实 OCR 测试使用 `fixtures/reimbursement-ocr-synthetic.png` 自制测试发票图片，在运行时嵌入无文字层 PDF；没有真实发票或个人资料。测试从本地依赖加载中文模型，材料不上传。合成样例通过不代表真实票据准确率。

`reimbursement-summary.test.mjs` 覆盖活动/明细对接协议、多人合并与来源、金额大写、活动和申请版本、重复材料确认、并发幂等、生成失败回退、材料限额及私有下载。中文 PDF 实测默认使用 Windows 本机仿宋，其他平台需设置 `REIMBURSEMENT_FONT_PATH`；无可用字体时只有该项明确跳过，其余契约与 HTTP 回归照常执行。

`npm run test:node` 运行全部 Node 套件；`npm test` 还包含既有权限、身份和资料脚本。测试数以实际输出为准。

SMTP/TLS 夹具覆盖证书身份与信任链、超时、取消和并发隔离；所有连接限制在回环。跨引擎测试通过 `npm run test:browser:cross` 执行。HTTP 层覆盖率门槛通过 `npm run test:coverage` 验证。真实发布包的隔离启动检查通过 `npm run test:release -- <archive>` 执行。详情与 CI 矩阵见 [测试指南](../docs/TESTING.md)。
