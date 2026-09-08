# 南京大学红十字会管理平台 × SeaTable

这是一个无构建工具的 Node.js 平台原型，用官方 `seatable-api` JavaScript SDK 连接南京大学本地部署的 SeaTable，并提供：

- 工作台：真实显示已接入表数，以及物资、借用和值班的聚合计数
- 组织与成员、物资中心、活动与值班、志愿服务：以现有 SeaTable 表为数据底座的业务页面壳层
- 表格中心：选择表格、预览行、筛选、刷新，以及受本地显式解锁保护的 CRUD
- 系统设置：说明当前 API 连接和正式上线前需要补齐的身份、权限与审计能力

平台现在包含本地管理员鉴权：未登录时，SeaTable metadata 与行数据接口均不会返回；登录后以 `HttpOnly`、`SameSite=Strict` 会话 Cookie 维持会话，所有写操作还必须携带会话绑定的 CSRF Token。涉及成员的联系方式、学号、审核人标识等字段在页面中默认脱敏展示。

底层 API 路由包括：

- `GET /api/health`：API Token 授权、读取 Base metadata 和数据表
- `GET /api/rows`：读取表格行
- `POST /api/rows`：追加一行
- `PUT /api/rows/:rowId`：更新一行
- `DELETE /api/rows/:rowId`：删除一行
- `GET /api/materials/overview`：物资运营汇总、待审批、逾期和建议阈值预警
- `GET /api/materials/inventory/:id/qr`：生成受保护的库存二维码 SVG 标签
- `GET /api/materials/scan?code=...`：扫码后定位库存物资
- `POST /api/materials/applications`：创建一条“待审批”借用申请
- `POST /api/materials/applications/:id/approve`：审批通过
- `POST /api/materials/applications/:id/reject`：拒绝申请并要求理由
- `POST /api/materials/applications/:id/checkout`：绑定资产码后出库并写入流水
- `POST /api/materials/applications/:id/return`：登记归还并更新归还数量与状态
- `POST /api/materials/transactions`：登记入库、手工出库、归还、盘点调整或报损

借出出库需要上传现场照片；归还可上传归还照片。SeaTable 中已新增 `物资管理.物资出库照片` image 列，原有 `物资归还照片` 继续用于归还留痕。逾期邮件需要在 `.env` 中配置 `SMTP_*` 和 `MATERIALS_REMINDER_FROM`，未配置时不会发送。

## 运行

需要 Node.js 20.6+（使用 Node 内置 `--env-file` 和 `fetch`）。

```bash
npm install
cp .env.example .env
```

编辑 `.env`：

```dotenv
SEATABLE_SERVER_URL=https://table.nju.edu.cn
SEATABLE_API_TOKEN=你的API_TOKEN
# 可选：填写截图中 Base 对应的表名；不填则网页自动显示全部表
SEATABLE_TABLE=
PORT=3000
PLATFORM_ADMIN_USERNAME=admin
PLATFORM_ADMIN_PASSWORD=请改成一条长且唯一的密码
PLATFORM_SESSION_SECRET=请填入至少32个字符的随机密钥
PLATFORM_SESSION_TTL_HOURS=8
```

启动：

```bash
npm run check
npm start
```

打开 http://localhost:3000 并使用本机 `.admin-accounts.json` 中的管理员账号登录。`.env` 的 `PLATFORM_ADMIN_ACCOUNTS_FILE=.admin-accounts.json` 已启用多账号模式；不设置该变量时，平台会回退到单账号的 `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD`。首次连接会先使用 API Token 换取短期 Base Token，再读取 metadata；行数据的键必须是 SeaTable 中真实的列名。截图里的 Base UUID 会由授权响应自动取得，因此不需要在页面中重复配置。

如果执行 `npm start` 时看到 `EADDRINUSE :::3000`，说明示例已经有一个实例在运行。此时直接打开或刷新 http://localhost:3000 即可，不要重复启动；也可以改用其他端口：`PORT=3001 npm start`。

## 鉴权与安全边界

API Token 只存在服务端 `.env`，前端只请求本地 `/api/*`。`.env` 已被 `.gitignore` 排除，切勿把真实 Token 写入源码或提交到 Git。由于 Token 已出现在聊天截图中，测试完成后建议在 SeaTable 中撤销并重新生成一个 Token。

- `GET /api/auth/session` 只用于确认是否已登录；所有 SeaTable 代理接口均要求有效会话。
- `POST /api/auth/login` 有每 IP 5 次 / 15 分钟的失败限制；成功后按对应账号签发 8 小时（可配置）的签名会话。
- `POST`、`PUT`、`DELETE` 除管理员角色外，必须通过 `X-CSRF-Token` 校验；前端不会保存 SeaTable Token。
- 服务端发送 CSP、拒绝嵌入、禁止嗅探 MIME 与 `no-referrer` 等基础安全响应头；页面不再依赖外部字体资源。

这个版本是可在本机或受控内网运行的“单管理员”原型，不是南京大学统一身份认证。接入校方 SSO 前，需要校方提供明确的 CAS/OAuth/OIDC 服务地址、客户端登记信息、回调地址、用户属性与角色映射规则；这些参数不可凭空假设。

目前可配置多个本地管理员，但所有账号仍拥有同一 `platform_admin` 写入权限。生产部署前应将密码改为不可逆哈希、迁移账号资料到受保护的数据库或身份提供方，并按表与操作实施最小权限。具体建设顺序见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)。

## 物资模块与二维码

物资中心现已使用 `物资管理` 和 `工位物资表` 的真实字段，展示待审批、借出中、逾期和库存阈值预警。阈值目前是平台侧建议值：`max(3, 初始数量 × 20%)`，不会回写或改变 SeaTable 表结构。

`物资配置表` 和 `物资流水表` 已在当前 Base 中建立。配置表已依据现有 100 条库存记录初始化；流水表保持为空，因为旧数据只有数量汇总，没有可迁移的逐笔事件。

二维码由本地服务生成 SVG，编码的是不透明库存资产码（如 `NJU-RC-<库存行ID>`），不含姓名、学号、用途或其他个人信息。扫码查询也要求已登录会话。物资流程数据映射、状态机和下一步实现边界见 [MATERIALS_MODULE.md](./MATERIALS_MODULE.md)；按完成度划分的缺口见 [MATERIALS_GAP_ANALYSIS.md](./MATERIALS_GAP_ANALYSIS.md)。

## API 调用依据

实现对应 SeaTable 官方文档中的 `Base.auth()`、`getMetadata()`、`listRows()`、`appendRow()`、`updateRow()` 和 `deleteRow()`。官方文档也说明：表格 API Token 用于授权 Base，行数据使用列名作为 JSON key。
