# PR #26 查询范围审查

审查范围为本 PR 修改的活动目录及其调用的草稿、名单、邮件状态、活动信息与详情接口。先合并 main 已有的 NJUTable 定向读取优化，保留前端类别配色、进度和岗位数量修复。

## 第一阶段：SQLite 草稿定位

原服务在已知草稿 ID 或创建请求键时调用 `SELECT data FROM activity_workspace_drafts`，再用 JavaScript 筛选；提交与失败重试也会重复读取全部草稿。

修复为两个必需的存储查询：

- `readById(id)`：参数化 `WHERE id=?`，使用既有主键索引。
- `readByRequest(ownerId,requestId)`：参数化 `WHERE owner_id=? AND request_id=?`，使用既有唯一联合索引。

打开、保存、预览、复制、创建重试、删除与提交核对均使用定向查询。权限复核、版本比较、唯一请求语义和幂等提交保持原样；没有静默回退为全表读取。目录列表的读取另行审查，未将单记录定位与列表需求混为一谈。

合成回归覆盖无权限读取、过期版本、多连接并发、重复创建、复制与提交核对；65 项通过。新增用例让全量读取直接抛错，确认单记录路径仍可执行；SQLite `EXPLAIN QUERY PLAN` 显示主键／请求键使用 `SEARCH ... USING INDEX`，并确认无关损坏数据不会被加载解析。

本轮沿用已有索引，SQLite 文件结构和远程表结构保持不变。所有验证使用临时或内存数据，没有读取或写入真实业务数据。

## 第二阶段：报名结果邮件状态

单活动与批量邮件状态接口原先调用 `overview()`，加载所有活动的报名和时长明细后再筛选；发送记录又按页遍历整个邮件表。

现在复用本次权限校验的活动元数据，按请求中的活动 ID 查询报名子表；只按相应的邮件幂等键查询邮件表，并只投影类型、通道、状态、发送时间和幂等键。查询值转义、每批 100 个条件、每页 1000 行，保持分页上限与完整性检查；SQL 错误不回退为全表读取。无 SQL 接口的内存／旧适配器仍有完整分页兼容路径，生产 SQL 路径由回归明确限制不得调用 `listRows`。

保持逐活动权限断言、名单当前结果过滤、SMTP 成功证据优先、未知状态和输出隐私白名单。NJUTable 自动生成的献血车场次不在存储活动行中，仅这类虚拟场次仍使用现有目录元数据投影来解析 ID，不因此读取全量报名或时长明细。

`node --test tests/result-mail-status.test.mjs tests/activity-lazy-read.test.mjs`：12 项通过。覆盖精准子表、SQL 条件与引号、分批和分页、失败／截断停止及只读权限；全部使用合成数据。本轮不修改远程表索引，是否存在／实际命中索引需由维护者在隔离环境查看 NJUTable 的查询执行情况，不能仅凭添加 `WHERE` 就宣称已命中索引。

## 第三阶段：选中活动的信息与编辑资格

普通活动的只读信息不再重新生成整个活动目录，直接复用当前权限元数据定位项目，并使用原有隐私白名单。普通多场次项目的控制信息按 `活动组ID` 条件读取；无关普通项目和献血车源表不参与所选普通活动的详情查询。

编辑资格判断原先调用 `read()`，读取六张流程表。现在只查询当前项目的签到与时长明细，保留已有证据禁改、指定主席鉴权、活动开始时间限制及查询失败时禁止编辑的行为。实际保存仍执行原有权威证据复核，不以展示缓存代替写入判定。

`node --test tests/activity-lazy-read.test.mjs tests/organization-authority.test.mjs tests/workspace-workflow-bridge.test.mjs`：28 项通过，覆盖跨类别只读权限、项目范围、无关源表禁读、无权限／证据存在／查询异常禁改，以及发布后编辑保留既有报名身份的回归。

## 第四阶段：草稿列表候选范围

草稿列表原先读取全部草稿 JSON 后逐条鉴权。现在通过服务端可信名册生成候选范围：本人创建的活动加上已核实地区的草稿；全局身份查询全部未删除草稿。候选集合仍逐条执行原有权限校验，地区范围只用于减少读取，不作为授权依据；名册不完整或已撤权时保留本人草稿的既有可见性。

SQLite 自动增加未删除草稿的 owner／region 局部索引。按本人和地区分开查询后去重，保留原列表顺序和负责人交接规则，排除软删除记录；没有修改业务表结构或写入远程表。首次打开本地状态库会建立索引，需要在实际部署时对状态库按原运维流程备份；回滚代码可保留索引，数据内容不变。

草稿、交接、API 与存储相关合成回归 55 项通过。查询计划验证 owner 与 region 使用 `SEARCH ... USING INDEX`，并逐一比较原授权函数与索引候选列表的结果，覆盖主任、主席、全局身份、跨地区、撤权和不完整名册。

## 第五阶段：名单处理、初审、最终时长与签到详情

名单处理、进行中的初审页面、最终时长表及整表提交状态统一使用当前项目证据读取：报名、签到、时长分别定位各自子表并以活动 ID 过滤。展示接口复用本次权限校验的活动元数据；保存／提交继续在原写队列内重新取证。保留原始证据形状，避免把展示摘要混入已保存的审核哈希。最终时长邮件后台寻找待发任务时只加载活动元数据，处理单任务时再查对应项目。

签到详情按报名行主键定位报名、按报名行 ID 定位网站签到；旧表按已验证格式的学号查询。学号无效时显示无法关联的说明，不遍历旧表。活动目录资料接口传递同一请求的权限活动快照，避免选中活动后又重新读取整个目录。

相关名单、初审、最终时长、整表提交、签到及交接回归通过，最终全量验证记录见文末。页面样式与既有按钮语义保持原样。

## 审查边界与后续工作

本次审查沿 PR 活动管理页面的请求链执行，覆盖草稿列表／编辑、活动目录／信息／详情、报名邮件状态、名单处理、初审、最终时长和签到详情。目录与权限机制仍需要全局活动元数据；自动生成的献血车目录仍按既有源表投影解析虚拟场次。旧的全站统计、会员端全局聚合、其他业务模块和未纳入这些页面请求链的遗留写入流程需要分别审查，不能把本次结果解释为全站已经没有全表查询。

生产 SQL 路径使用条件查询；无 SQL 适配器保留内存／旧客户端兼容分页。SQLite 索引可在临时库验证命中，NJUTable 索引和线上延迟尚需维护者在隔离测试环境验证。本轮没有连接或修改真实业务表，没有发送业务邮件。

## 阶段提交与最终验证

业务修复分别保留在 `877271c`（草稿单条定位）、`54bdb0a`（邮件状态）、`c9ee388`（活动详情）、`cb09b17`（草稿列表）和 `5ec61e7`（名单／时长／签到证据）。预览服务同步接入可信的列表候选范围，供交接演示和浏览器回归使用。

- Windows、Node 24.15、本地合成／临时数据环境。
- 最终 `npm run verify` 退出码 0：Node 套件 2441 项通过、0 失败、0 跳过，项目扫描、lint、权限、身份与资料检查均通过。
- `npm run check:links`：通过，扫描 1028 个模块；`git diff --check`：通过。
- Edge 桌面与手机合成浏览器回归 26 项通过、0 失败、0 跳过，覆盖 1／2／16 岗位计数、草稿创建／恢复／复制／交接提交、历史报名结果处理、报名阶段权限与失败原因、活动信息编辑、项目岗位切换、最终时长预览／导出／下载。

测试入口保留仓库的 `desktop-chromium`／`mobile-chromium` 项目名，因为合成预置活动名称按这两个项目名生成；浏览器通道仍为本机 Edge。首次使用 `desktop-edge`／`mobile-edge` 名称时缺少对应时长夹具，另发现预览服务尚缺列表候选范围；补齐预览服务并使用正确项目名后，完整 26 项重跑通过。临时测试配置内容如下（放在仓库 `reports/` 下，不作为产品代码提交）：

```js
import edge from '../playwright.edge.config.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export default {...edge,testDir:root+'tests/browser',outputDir:root+'test-results',
 webServer:{...edge.webServer,cwd:root},
 projects:edge.projects.map(project=>({...project,name:project.name.replace('-edge','-chromium')}))};
```

```powershell
$env:PLAYWRIGHT_PREVIEW_PORT='3125'
npx playwright test --config=reports/pr26-query-edge.config.mjs tests/browser/activity-directory-count.spec.mjs tests/browser/activity-draft-workspace-v2.spec.mjs --grep 'directory|new activity requires|copy creates|saved grouped draft|final hours page|real grouped registration|registration workspace protects|regional chair can edit|historical registration decisions' --reporter=line
```

Windows 测试结束时关闭本次测试创建的预览进程以完成退出，未关闭用户原有预览服务。GitHub 跨平台完整矩阵以更新后的 PR 检查为准；本 PR 尚未合并，生产部署留待合并后的发布流程验证。
