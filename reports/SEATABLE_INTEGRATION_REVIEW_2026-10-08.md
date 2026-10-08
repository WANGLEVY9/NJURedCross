# SeaTable 接口模块审查报告

日期：2026-10-08  
仓库：`C:\Users\ys xv\Desktop\redcross`  
分支：`feature-birthday-blessings`  
HEAD：`5fb6059 fix(community): 修复生日祝福预览校区显示`

## 1. 审查范围

本次检查覆盖：

- `lib/seatable-auth.js`
- `server.js` 中的 SeaTable Base 初始化、鉴权、分页读取、写入、错误映射、锁和上传
- `lib/production-schema.js`
- `scripts/apply-state-schema.mjs`
- `scripts/apply-warmth-lock-schema.mjs`
- `scripts/apply-account-schema.mjs`
- `scripts/apply-event-schema.mjs`
- `scripts/apply-notice-schema.mjs`
- `scripts/clean-test-rows.mjs`
- `scripts/audit-data-accuracy.mjs`
- `scripts/preview-profile-schema.mjs`
- `scripts/preview-permission-schema.mjs`
- `.env.example`
- `tests/infrastructure.test.mjs`

## 2. find-skills 搜索结果

没有找到 SeaTable 专用 skill。最接近的候选：

| Skill | 安装量 | 判断 |
| --- | ---: | --- |
| `addyosmani/agent-skills@api-and-interface-design` | 48K | 通用 API / 接口设计，可借鉴，但与 SeaTable SDK 细节无关 |
| `wshobson/agents@api-design-principles` | 29.4K | 通用 API 设计原则，参考价值有限 |
| `usestrix/strix@api-security-testing` | 8.8K | 侧重 API 安全测试，可作后续补充 |
| `claude-office-skills/skills@airtable-automation` | 5.7K | 最接近表格 SaaS 自动化，但不是 SeaTable，且不适合直接套用 |

本轮未安装第三方 skill，直接复用本地 `security-and-hardening` 的检查框架，因为其覆盖面更贴合本项目的鉴权、密钥、外部服务、PII 和供应链风险。`analyze-project` 面向深度学习仓库，本轮判定不适用。

## 3. 已运行的检查

全部通过：

```text
npm run test:infrastructure
5/5 passed

npm run check
Checked 156 JavaScript modules and 64 Markdown documents; 0 errors

npm run lint
eslint . --max-warnings=0

npm run verify
119/119 tests passed
```

未能完成：

```text
npm audit --omit=dev --json
```

当前 npm registry 使用 `registry.npmmirror.com`，该镜像未实现 audit 接口，返回 404。因此本轮不能确认 SeaTable SDK 依赖树是否存在新的公开漏洞。

## 4. 主要发现

### P1：迁移和清理脚本没有绑定目标 Base UUID

多个会直接创建或删除 SeaTable 表的脚本只调用 `base.auth()`，没有把 `base.dtableUuid` 与配置中的 Base UUID 做比较。

涉及：

- `scripts/apply-state-schema.mjs:29`
- `scripts/apply-warmth-lock-schema.mjs:19`
- `scripts/apply-account-schema.mjs:37`
- `scripts/apply-event-schema.mjs:14`
- `scripts/apply-notice-schema.mjs:28`
- `scripts/clean-test-rows.mjs:37`

风险：

- Token 若对应了错误 Base，脚本会在错误 Base 中建表或删行。
- `clean-test-rows.mjs --purge` 风险最高，因为它执行批量删除。
- 仅靠确认短语不能防止“确认正确但 Token 指向错误 Base”。

建议：

- 统一增加 `assertBaseUuid(base, expectedUuid, label)`。
- 写脚本必须同时满足：
  - `SEATABLE_BUSINESS_BASE_UUID` 已配置；
  - `base.dtableUuid === SEATABLE_BUSINESS_BASE_UUID`；
  - 存在 `--apply`；
  - 确认短语正确。
- 删除类脚本还应要求第二次显式确认，例如 `--confirm-base=<短UUID>`。

### P1：生产 Base UUID 校验依赖 `NODE_ENV=production`

`server.js:96-99` 只有在 `isProduction` 为真时才校验业务 Base UUID。而 `.env.example` 默认是：

```text
NODE_ENV=development
```

风险：

- 真实部署如果漏设 `NODE_ENV=production`，服务会接受任何 Token 对应的 Base。
- 可能读取或写入到错误环境，且前端不会提示。

建议：

- 对非 localhost 的 `SEATABLE_SERVER_URL`，无论 `NODE_ENV` 是什么，都要求 `SEATABLE_BUSINESS_BASE_UUID` 并强校验。
- 或者引入显式的 `PLATFORM_TARGET=local|production`，不要只依赖 `NODE_ENV`。

### P1：锁表首次不可用后会永久降级为进程锁

`server.js:1295-1311` 用一个模块级变量缓存锁表可用性：

```js
let warmthLockTableAvailable = null;
```

一旦读取失败，就设置为 `false`，后续直接使用进程锁，直到服务重启。

风险：

- 真实 SeaTable 偶发网络错误、Token 短暂失败或锁表尚未创建，都会触发永久降级。
- 多实例部署时，进程锁无法跨实例协调，生日投递、额度和幂等规则可能竞态。

建议：

- 不要永久缓存 `false`。
- 增加短 TTL，例如 30 秒后再探测。
- 区分“表不存在”和“网络故障”，后者应抛错或重试而不是静默降级。
- 生产环境可设置 `WARMTH_LOCK_REQUIRED=true`，锁表不可用时拒绝相关写操作。

### P1：持久化锁是 best-effort，不是原子锁

`server.js:1330-1387` 使用“读取状态 -> append 锁行 -> 再读排序 -> 令牌匹配”的方式。

SeaTable 没有唯一约束，也没有事务条件写入。因此：

- 两个实例可能同时 append 锁行。
- 如果 append 后的读取存在可见性延迟，两个实例都可能认为自己拿到了锁。
- 任务执行时间超过 TTL 时，没有续租，另一实例可能接管。

当前单实例场景问题不大。多实例生产前需要：

- 做真实 SeaTable 并发实测；
- 增加 heartbeat / 续租；
- 或把强一致锁移到支持唯一约束的数据库。

### P2：志愿服务 Base 的 UUID 配置没有在直接访问点校验

`server.js:37` 读取了 `SEATABLE_VOLUNTEER_BASE_UUID`，但 `server.js:212-215` 的 `getVolunteerBase()` 没有校验。

风险：

- 活动工作流路径会通过 `workflowMode()` 间接校验。
- 但志愿总览、通知和其他直接使用志愿 Base 的读取路径可能在 Token 指向错误 Base 时仍返回数据。

建议：

- `getVolunteerBase()` 中统一校验 `volunteerBaseUuid`。
- 若未配置 UUID，明确返回 `volunteer_not_configured`，不要接受任意 Base。

### P2：温暖连接读取没有统一使用完整性断言

`server.js:731-773` 有最多 5000 行的读取上限以及 `readMeta().truncated`，但活动与物资部分使用了 `assertCompleteRows()`，温暖连接不少读取路径没有。

涉及：

- `server.js:320`
- `server.js:351`
- `server.js:406`
- `server.js:417`
- `server.js:503`
- `server.js:532`
- `server.js:592`

风险：

- 投稿、祝福库、投递、举报或黑名单超过 5000 行后，接口可能把部分数据当成完整数据。
- 统计、查重、审核和投递幂等可能因此失真。

建议：

- 对影响写决策的读取统一调用 `assertCompleteRows()`。
- 对纯展示接口在响应中返回 `readMeta` 或 `truncated`。
- 对温暖祝福投递表做归档或分页聚合，不能长期依赖 5000 行全表读取。

### P2：清理脚本未覆盖新增温暖连接表

`scripts/clean-test-rows.mjs` 当前表列表仍是旧六表：

```js
const tables = ['宣传项目表', '宣传投稿表', '宣传发布任务表', '温暖连接参加表', '温暖连接投稿表', '操作审计表'];
```

未覆盖：

- `温暖祝福库表`
- `温暖祝福投递表`
- `温暖祝福举报表`
- `温暖连接黑名单表`
- `温暖连接操作锁表`

风险：

- 冒烟测试和样例脚本产生的温暖连接数据不能被统一清理。
- `--purge` 不能清空完整的状态层，和文档描述不一致。

建议：

- 从 `STATE_SCHEMA` 派生清理表列表，避免手工维护漂移。
- 锁表可单独处理：只删除过期/已释放锁行，purge 模式下需明确确认。

### P2：非上游错误可能把内部错误消息返回给客户端

`lib/http/errors.js:9-13` 对 SeaTable 上游错误会返回通用消息，但对非上游错误会返回：

```js
message: error?.message || '服务暂时不可用'
```

风险：

- 某些内部错误可能包含 Base 名称、表名、路径或 SDK 细节。

建议：

- 仅对显式 `statusCode < 500` 的业务错误回显 `message`。
- 500 类未分类错误统一返回通用文案，并把详情写服务端日志。

### P2：SeaTable 调用没有显式超时和重试策略

搜索未发现 SeaTable 请求的 `timeout`、`AbortController` 或重试配置。`createSeaTableAccess()` 只处理重新鉴权，不处理单个请求超时或瞬时 5xx。

风险：

- 上游慢响应可能长期占用 Node 请求。
- 瞬时错误会直接变成用户侧 502/500。
- 部分写操作返回不确定时，需要依赖业务幂等键恢复。

建议：

- 给 SeaTable 请求配置明确超时。
- 读请求可有限重试；写请求只对幂等键保护的场景重试。
- 在真实 Base 中验证 401、403、429、5xx、超时和断网行为。

### P3：Schema 应用脚本对“部分已存在”的 Base 只能人工处理

状态、账号、活动、通知脚本在发现任意目标表已存在时都会拒绝继续创建缺失表。

这是安全的默认行为，但正式 Base 往往会部分存在，因此需要：

- 一个只读 preflight，明确列出缺失表、缺失列和类型不一致；
- 一个明确的补列迁移流程；
- 不提供“一键覆盖”选项。

## 5. 已具备的良好设计

- 浏览器不持有 SeaTable Token，所有访问经服务端代理。
- 长期服务使用短期 access token 刷新封装。
- 业务 Base、身份 Base、志愿 Base、资料 Base 已开始分离。
- Schema 创建脚本默认 dry-run，写入需要确认短语。
- 公开写接口有服务端校验、限流、CSRF 和审计。
- 活动与物资模块已使用 `assertCompleteRows()` 防止分页静默截断。
- `tests/infrastructure.test.mjs` 覆盖并发鉴权、短期 token 过期、SDK 请求和本地合成服务。

## 6. 真实 UUID / Token 到位后的预检建议

建议新增 `npm run seatable:preflight`，只读执行：

1. 校验 `SEATABLE_SERVER_URL` 可访问。
2. 鉴权并输出 `dtableUuid`，与 `.env` 中目标 UUID 比较。
3. 只读取 `getMetadata()`。
4. 校验业务 Base 必需表：
   - `温暖连接参加表`
   - `温暖连接投稿表`
   - `温暖祝福库表`
   - `温暖祝福投递表`
   - `温暖祝福举报表`
   - `温暖连接黑名单表`
   - `温暖连接操作锁表`
5. 校验必需列是否存在。
6. 对每张表只读采样 1 行，确认 Token 有读取权限。
7. 在需要时再执行单独的 `--write-probe`，仅写入带 `VERIFY-` 标记且可回收的行。
8. 输出 JSON，不打印 Token、Base 内容或个人数据。

真实 Token 到位后应依次执行：

```powershell
npm run seatable:preflight
npm run warmth-lock:dry-run
npm run state:dry-run
npm run audit:data
```

确认无误后，再考虑任何 apply 或写操作。

## 7. 建议修复顺序

1. 增加统一 Base UUID 断言，先覆盖写脚本和清理脚本。
2. 修复锁表永久降级问题。
3. 为温暖连接关键读取增加完整性断言。
4. 将清理脚本表列表从 `STATE_SCHEMA` 派生。
5. 增加 `seatable:preflight`。
6. 收紧 500 类错误返回。
7. 配置 SeaTable 请求超时与有限重试。
8. 用真实 Base 做多实例并发和故障注入测试。
