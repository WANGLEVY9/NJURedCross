# 安全巡检与风险代码门禁

平台的安全防线由三层组成：代码级固定检查、发布前质量门禁、上线后的只读观测。本文说明如何运行、怎样解读结果，以及哪些风险仍需人工审查。

## 固定检查

```bash
npm run check:security
npm run check
npm run lint
npm audit --omit=dev --audit-level=high
```

`check:security` 扫描 `server.js`、`lib/`、`public/app/`、`docs/` 与根目录安全文档，覆盖四类已知高危模式：

| 规则 | 阻断内容 | 设计意图 |
| --- | --- | --- |
| `dangerous-dom` | `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write` | 平台正文通过 `h()` 与 `textContent` 渲染，新增原始 HTML 写入必须有审核过的净化方案 |
| `dynamic-code` | `eval()`、`new Function()` | 避免运营数据或外部响应进入代码执行路径 |
| `dangerous-url-literal` | `href`/`src` 直接写 `javascript:`、`data:` 等字面量 | 外链协议必须显式校验 |
| `secret-literal` | 长随机 Token/口令字面量 | 真实凭据只放在服务器私有 `.env`，示例值使用 `synthetic-` 或 `replace-with-` 前缀 |

共享元素工厂是唯一被列入例外的原始 HTML 入口；例外集中写在脚本顶部，新增或放宽例外会改变检查结果并需要代码审查。检查器不加载 `.env`、不联网、不写业务数据。

CI 在六组 Node/OS 验证 job 中运行 `check:security`，与模块/文档检查、命名导入、遥测边界、Lint、权限/身份回归和生产依赖公告一同进入 `Quality gate`。任一阶段失败都不会部署。依赖公告只按生产依赖判定；开发依赖的公告不能代表线上运行时风险。

## 运行时边界

- 所有 API 与静态响应统一携带 CSP、`nosniff`、`DENY` 帧策略、`no-referrer` 和权限策略；JSON 始终 `no-store`。
- HTTPS 站点在反向代理补发 HSTS；本地 HTTP 预览不写 HSTS，避免预览环境被强制升级。
- 会话 Cookie 为 `HttpOnly`、`SameSite=Lax`，生产附加 `Secure`；所有写请求要求会话和 CSRF，管理端按模块权限二次裁决。
- 公开写接口分桶限流，登录按账号与来源地址双重限制；影像、投稿与展示外链只接受普通 http(s) 地址。
- 私有身份、业务、志愿报表和财务凭据相互隔离，生产 `.env`、数据库、照片与部署私钥不进入发布包。
- 结构化日志只记录脱敏路由、状态、耗时和关联号；浏览器上报不可信，不参与业务决策。

## 人工审查重点

自动扫描不能证明业务逻辑正确。以下变更仍需在 PR 或维护提交说明中给出验证：

1. 新增或改动登录、验证码、重置、会话撤销、角色/权限与本人归属判断。
2. 新增外部 HTTP 目标、重定向、文件下载路径或把表字段渲染为链接/图片。
3. 引入新依赖、原生模块或后台任务；确认最小权限、超时、取消与失败语义。
4. 修改 CSP、Cookie、Nginx、systemd、部署接收器或日志保留策略。
5. 任何触及个人资料、照片、邮件收件人、导出文件或审计记录的数据投影。

发生凭据暴露时按 [安全政策](../SECURITY.md) 立即轮换凭据、检查访问审计并评估影响范围；代码回滚不撤销已经发生的外部访问。
