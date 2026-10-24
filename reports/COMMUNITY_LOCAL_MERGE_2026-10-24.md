# 内建分支本地合入 main

日期：2026-10-24（Asia/Shanghai）。目标为本地 `main`，主线基线 `0f3e277`，来源 `feature/community-workflow-ui` 的 `e30dec8`。

## 合并范围

- 内建早安晚安名片、好友邀约、反馈报备、已发布名片资料修订审核及生日祝福定向查询。
- 共享入口只加入内建路由、接口、配置、会员中心入口及对应说明和回归。
- `server.js` 导入冲突保留双方所需导入；主线活动、邮件、排班导入完整保留。
- 排除来源分支的本地 SeaTable 模拟脚本 `.gitignore` 规则。
- 生产 `PUBLIC_BASE_URL` 必填条件限定在启用早安晚安时，保持未启用该功能的服务启动行为。
- 对主线比较，`lib/events`、`lib/identity`、`lib/attachment`、`lib/materials`、`lib/http`、`lib/mail`、依赖及锁文件均无修改。共享文件的差异逐段核对为内建接入。

## 本地验证

- `npm run verify` 的文件检查通过：1045 个 JavaScript 文件及 166 个 Markdown 文档；lint、权限、身份、资料检查通过。
- 全项目 Node 回归：2477 项，2476 通过、1 失败。失败位于既有 `tests/web-assets.test.mjs:208`，Windows 创建文件符号链接报 `EPERM`；延续此前记录的环境限制。
- 最终内建定向回归：109 项全部通过，包含新增的功能关闭时启动兼容及功能开启时邮件来源配置校验。
- `npm run lint`、`npm run check:links` 和 `git diff --check` 通过。
- Edge 桌面/手机两份内建 spec：日志记录 31 项通过、3 项按项目配置跳过。用例结束后清理进程持续未退出，停止该运行；该次运行未正常生成最终报告，按用例日志记录，不记为正常完成的全绿运行。

交付为本地 main 的合并提交。未推送远程、未部署、未操作生产数据或真实邮件。
