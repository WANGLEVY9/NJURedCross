# 后端模块

模块由 `server.js` 注入上下文并调用，不能反向导入入口。当前业务总览、库存、宣传和温暖连接仍在入口文件中，抽取顺序见 [架构](../docs/ARCHITECTURE.md)。

| 模块 | 内容 |
| --- | --- |
| `http/response.js`、`http/static.js` | 统一响应、安全头与静态目录隔离 |
| `seatable-auth.js` | 访问 Token 生命周期与并发认证 |
| `permissions.js` | 控制台角色范围、账号状态与路径映射 |
| `identity/store.js` | 账号列契约、scrypt、账号读取与更新 |
| `identity/api.js` | 邮箱验证、注册/重置/资料路由与绑定 |
| `identity/volunteer-profile.js` | 稳定匹配、字段白名单与待同步恢复 |
| `events/api.js` | 通知和附件的 HTTP 路由 |
| `events/notice.js` | 通知纯函数与持久化行构造 |
| `events/njubox.js` | 附件接口与外部服务适配 |
| `mailer.js` | 邮件通道、幂等检查与记录 |

涉及身份改动运行身份、资料和权限测试；涉及连接/响应改动运行基础设施测试。`npm run verify` 覆盖全套。新模块明确输入输出，数据服务通过参数注入；不在模块加载时发送业务请求。
