# 邮箱验证修改密码：实现与验收（2026-10-02）

已部署到 https://njuredcross.cn/change-password 。登录后在个人中心点击“修改密码”。

## 功能

- 邮箱由服务器读取当前账号的已验证校园邮箱，前端只读展示，调用方不能指定邮箱、账号或角色。
- 专用验证码用途为 `change:<账号ID>`，与注册、忘记密码分离，使用既有私有验证码表，无需建表或迁移数据。
- 会话、同源、CSRF 校验；10 分钟有效、最多 5 次错误、60 秒重发间隔、邮箱每小时 5 次共用限额；重发使该用途旧码失效。
- 新密码 8～72 位，包含大小写字母、数字和特殊符号，且须不同于原密码。服务端保留 scrypt 哈希，绝不存明文。
- 使用邮箱锁串行化改密与找回流程；重新读取私有账号并校验当前会话，防止并发重复消费。
- 修改成功清除当前 Cookie，使全部旧会话失效；发送安全通知。通知发送失败仍明确返回已修改状态。
- 普通用户和管理员均须已有已验证校园邮箱。管理员改密不改变角色或权限；未验证邮箱账号需要联系负责人。

## 检查证据

- `npm run test:identity`：95/95 通过，无真实数据库写入及邮件。新增覆盖未登录、CSRF、异源、篡改目标、未验证邮箱、冷却、用途隔离、复杂度、同密码、过期、5 次错误、SMTP 失败、并发、一次性、两台设备旧会话失效、新旧密码真实登录函数验证、管理员权限保留与通知失败。
- `npm run test:permissions`：17/17 通过。
- `npm run check` 和 `git diff --check`：通过。
- 本地合成账号：从个人中心点击改密入口；只读邮箱、模拟发码/倒计时、空验证码提示及焦点正常；320/390/900/1440px 下 scrollWidth == clientWidth。
- 只读线上私有 Base 元数据：UUID 与服务端配置匹配，验证码“用途”列为 text，写入次数为 0。
- 线上 `smoke:public`：通过。
- 线上两项改密 POST 接口无会话请求均为 401/login_required。
- 线上 /change-password 无会话访问转到 /login?next=%2Fchange-password。
- 线上注册配置 enabled=true，既有 SMTP 可用配置保留。
- 线上新页面、main.js、core/api.js 响应字节哈希与本次暂存部署源一致。

## 改动与发布

- 后端 `lib/identity/api.js`。
- 前端 `public/app/core/api.js`、`public/app/main.js`、`public/app/portal/pages/me.js`、新 `public/app/portal/pages/change-password.js`。
- 测试 `scripts/test-identity-flow.mjs` 与说明 `LOGIN_REGISTRATION_FLOW.md` 仅保存本地。
- main.js/core/api.js 从线上基线做最小插入，保留线上与本地之间已有差异；未覆盖 server.js、环境变量或其他模块。
- 原文件备份 `/opt/njuredcross-config-backups/change-password-20261002-141611`。服务重启后 active。

## 验收边界

`change-password-mobile-synthetic-20261002.png` 是本地合成账号界面预览，邮箱并非真实用户资料。界面测试仅模拟发码，没有实际发信；未在浏览器输入新密码、修改任何真实账号密码，未使用实机或屏幕阅读器完成验收。本人真实收码与新密码提交仍待用户操作。
