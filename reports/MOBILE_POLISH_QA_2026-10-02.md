# 移动端布局优化与验收（2026-10-02）

已同步到 https://njuredcross.cn。修改前校验线上文件哈希，修改后与本地哈希逐一匹配；线上服务保持 active。

## 本次改动

- `public/app/portal/shell.js`：紧凑顶部、手机导航图标、登录态短标签、普通用户隐藏管理菜单、ARIA 展开状态、Tab/Esc 与焦点恢复、跳转和点击正文收起菜单。
- `public/styles/portal.css`：导航提前折叠；保持品牌一行；安全区适配；手机表单输入高度 48px/字号 16px；网格可收缩；长邮箱换行；首页文字宽度和活动区布局；两列页脚。
- `public/app/portal/pages/me.js`：将个人资料和参与记录放入有边距的内容容器。
- `public/app/portal/pages/{login,register,reset-password,verify-email}.js`：触屏/窄屏不自动聚焦；桌面聚焦防止自动滚动。校验失败的主动焦点指引保留。

## 已执行检查

- `npm run check` 通过；`git diff --check` 通过。
- `SMOKE_BASE_URL=https://njuredcross.cn npm run smoke:public` 通过，包含静态资源、公开接口、404 和未登录 401 边界。
- 线上注册页测试宽度：320、360、390、430、768、900、1280、1440px。所有宽度均为 scrollWidth == clientWidth，无整页横向溢出。品牌标题保持一行，窄屏折叠菜单，1280/1440px 显示完整桌面导航。
- 本地预览使用 GET-only 公开 API：320px 下检查首页、活动、物资、投稿、温暖连接、状态、登录、忘记密码、说明页；个人中心未登录跳转至登录。所有检查页面无整页横向溢出。
- 本地合成账号个人中心：320px，无溢出；资料卡左边距 16px，输入高度 48px。未写入真实账号资料。
- 手机菜单：Tab 从菜单按钮进入活动入口；Esc 关闭并恢复按钮焦点；点击入口跳转后关闭菜单。本地与线上注册页均验证 Tab/Esc。
- 线上 390px 注册页重新加载：焦点为 BODY、scrollY=0，无自动聚焦。
- 已目视检查手机注册页、展开导航、活动页、首页、合成资料页，以及桌面注册页。线上首页实际加载 4 个统计区块后，仍无横向溢出。
- 预览活动页与线上注册页采集的浏览器 error 日志为空。

## 截图

- `mobile-register-live-20261002.png`：线上手机注册首屏。
- `mobile-register-full-live-20261002.png`：线上注册页完整页面。
- `mobile-navigation-live-20261002.png`：线上手机导航展开。
- `mobile-home-live-20261002.png`：线上手机首页。

## 发布与边界

线上备份：`/opt/njuredcross-config-backups/mobile-polish-20261002-135717`。只同步上述 7 个前端文件，未修改鉴权后端、数据库或 API Token。本轮未发送邮件、注册真实账号或修改真实个人资料。

验收使用 Codex 浏览器视口模拟；未用 iOS Safari/Android 实机验证软键盘、刘海安全区、系统大字体或屏幕阅读器。不存在完整 WCAG 合规验收结论。
