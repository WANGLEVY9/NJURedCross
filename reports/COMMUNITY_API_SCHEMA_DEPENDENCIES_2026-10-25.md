# 本地 main：API、表结构与运行依赖核查

日期：2026-10-25。基线：本地合并提交 `9ea33b2`，测试适配提交 `e5fa1e4`。本次验证合并后的工作树与后续修复；未推送、未部署、未修改生产表结构或业务数据。

## 结论与修复

| 范围 | 发现 | 本地处理与验证 |
| --- | --- | --- |
| API 路由 | `POST /api/morning/cards`、`GET /api/morning/favorites/:id` 等不支持的请求被误当成广场列表，甚至创建当天快照 | 只匹配明确支持的路径和方法；其余交回主路由；测试确保不访问业务库和快照 |
| API 输入 | 非法 URL 编码或异常名片编号缺少明确的参数错误响应 | 返回 400 `invalid_card_id`，在远程读取和本地存储操作前拒绝 |
| 收藏依赖 | 空收藏读取、取消收藏也先连接 SeaTable | 将这两类操作改为先处理本地 SQLite，不额外依赖 SeaTable 行读取；全局模块门禁仍有效 |
| 广场响应 | `stats.sort` 仍宣称按发布时间排序 | 改为 `daily_random`，与每日随机快照一致 |
| 表结构门禁 | 生日、早安晚安只核对字段名，错误的日期/数字列仍被标为就绪 | 同时验证规定字段为 `text`；缺失/未知/错误类型均不可用；额外自定义列不受影响 |
| 本地安装 | 已安装 `nodemailer@10.0.13` 与 package/lockfile 要求的 `10.2.1` 不一致 | 已按现有清单同步，`npm ls --omit=dev --depth=0` 无缺失或版本冲突；package/lockfile 无修改 |
| npm 审计 | 本机默认 npmmirror 不提供安全审计 API | 使用官方 npm registry 完成审计，生产依赖已知漏洞为 0 |
| 本地检查 | ESLint 扫描私有 `.write-state` 临时演示代码 | 将整个运行状态目录加入全局忽略，常规 `npm run lint` 通过 |

## API 验证边界

- 服务端注册了前端调用的名片列表/详情、收藏列表/增删、报名、资料修订审核、邀约及反馈接口；收藏写入沿用登录与 CSRF 门禁。
- 已有回归覆盖已发布他人名片限制、私人字段投影、本人及他人账号隔离、审核版本竞争、邀约有效期/归属和审核权限。
- 在全新生产依赖目录启动完整 `server.js`，以仅回环监听的合成 SeaTable 代替外部服务，完成 12 项 HTTP 检查；验证未登录 401、缺 CSRF 403、未发布目标 404、移除收藏成功，以及不支持请求不再返回广场成功结果。
- 全新目录同时验证 sharp、canvas、二维码、XLSX 实际编码以及启动创建 SQLite；没有读取生产 Token 或发送真实邮件。
- HTTP 启动验证使用空合成业务库；正向收藏、邀约、修订和多账号数据行为由对应业务回归覆盖，不等同于生产端到端验收。

## 必需表结构与持久化

早安晚安需要 6 张 SeaTable 子表，所有声明字段均为 `text`：

| 表 | 字段数 |
| --- | ---: |
| 早安晚安名片表 | 20 |
| 早安晚安邀约表 | 19 |
| 早安晚安名片修订表 | 21 |
| 早安晚安评论表（历史） | 19 |
| 早安晚安兴趣标签表 | 6 |
| 早安晚安黑名单表 | 12 |

生日升级需要参加、投稿、祝福库、投递、举报、黑名单、操作锁共 7 张表，精确字段以 `lib/production-schema.js` 与 `lib/community/birthday-rollout.js` 为准。现有参加/投稿表保留，迁移仅按脚本许可补表补列，不自动改变既有字段类型。

每日随机快照和心愿单不写 SeaTable，存于 `PLATFORM_WRITE_STATE_DIR/morning-plaza-daily.sqlite` 的 `morning_plaza_daily_snapshots`、`morning_plaza_favorites`。启动自动补齐 SQLite 表，回归验证旧快照保留、收藏跨重启保存及账号隔离。状态目录必须持久化、可写且位于静态目录之外；WAL 模式下采用 SQLite 备份机制或停服复制。部署源码不会替代数据库备份。

真实年级源仍由已配置的 profile/volunteer Base 中「个人主页（编辑版）」按学号和姓名匹配；选单对象年级及不公开年级的回归通过。本地合成源不能证明生产读取权限已配置正确。

## 服务器依赖要求

- `package.json` 要求 Node `>=22.13.0`，SQLite 使用 Node 内置模块，无需另外安装 sqlite npm 包。
- 使用 lockfile 安装：`npm ci --omit=dev --ignore-scripts --include=optional`。服务器不需要浏览器测试依赖。
- `sharp`、`@napi-rs/canvas` 需要对应平台的可选二进制依赖；lockfile 包含 Linux x64 GNU 的 sharp、libvips 和 canvas 包，不可用 `--omit=optional` 安装。
- 仓库的发布接收器在 package/lockfile 变更时执行生产依赖安装，后端变更时重启服务；安装失败进入代码/依赖回滚。运行状态目录独立于发布包。
- 全新安装在 Windows x64、Node 24.18.0 / npm 11.16.0 验证成功。不能据此声称生产 Linux 主机已完成安装。
- Linux 专用发布接收器/同步程序使用 `fcntl`；本机 Windows 无法运行这两组测试，Linux CI 仍需执行完整发布安全门禁。本机的源码打包安全测试 6 项通过。

## 线上尚未确认

本机没有生产 `.env` 或可信 SSH 主机记录；只读 SSH 连接因主机密钥未受信任而停止，未关闭主机校验。没有对线上作安装、重启或迁移操作，因此以下内容仍待在有可信连接的环境确认：

1. 服务器实际 Node/npm 版本、生产依赖树、运行用户对私有状态目录的权限和剩余空间。
2. 生产 SeaTable 邀约/修订表是否已创建，生日与早安晚安全部必需列的类型是否正确。
3. `WARMTH_MORNING_ENABLED`、`PUBLIC_BASE_URL`、年级资料源和 SMTP/地区协调人配置是否适合实际启用。

可在持有配置的、版本已核对的源码目录执行下列只读预览；不要添加 `--apply`：

```sh
node --version
npm --version
npm ls --omit=dev --depth=0
npm audit --omit=dev --registry=https://registry.npmjs.org
node --env-file=.env scripts/apply-morning-schema.mjs
node --env-file=.env scripts/apply-birthday-schema.mjs
```

表结构脚本校验生产源与 Base UUID，预览仅读取元数据。源码发布包不携带迁移脚本，应另行提供经过审核的同版本维护源码。

## 最终验证结果

- 常规模块/文档检查与 ESLint 通过；具名 ESM 导入检查通过（1099 模块）。
- `npm test` 中权限、身份、个人资料脚本通过；Node 测试共 2584 项，2583 通过，唯一失败为 Windows 不允许创建文件符号链接导致的 `tests/web-assets.test.mjs` `EPERM`，不是本次业务代码断言失败。未跳过或改弱该测试，整体命令仍以非零退出。
- 本次早安晚安管理端浏览器回归桌面/手机共 6 项通过；合并时公众端与生日/早安晚安浏览器回归 38 项通过、2 项预期跳过。
- 隔离全新生产依赖安装与 12 项 HTTP 启动检查通过；图片、画布、二维码、XLSX 编码与 SQLite 建库通过。
- 官方 npm 源生产依赖审计：0 漏洞；package/lockfile 未改动。全量 Linux 发布安全测试仍待 Linux 环境执行；本机可执行的打包安全测试 6 项通过。
- 核验与修复均留在本地 main，无生产数据修改或部署。
