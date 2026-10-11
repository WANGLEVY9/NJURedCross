# 2026-10-11 开发分支合并前审查

> 历史审查快照。Owner 于 10 月 12 日确认两支身份并授权解决合并问题，后续修复与验收见 [合并实施记录](MERGE_INTEGRATION_2026-10-12.md)。下文“未合并”等表述只描述审查时状态。

## 结论与边界

两支可以在保留最新 main 界面底座的前提下整合，但现在不建议直接合入并自动发布。已在独立检出中解决诊断用冲突并运行合成检查；未修改 main、未推送、未发布 GitHub 审核评论、未写入真实业务表或发送邮件。

按请求提出时的“今天”（北京时间 2026-10-11）统计提交；本地验证延续至 10 月 12 日。审查 main：`3b4005f020fae75aba8810d89c0abb7437ff6192`。两支的 GitHub Quality gate 均通过；PR #2 当前 `dirty`，PR #8 当前 `blocked`，不能把 CI 通过等同于合并规则已满足。

| 分支 / PR | 作者身份证据 | 最新 SHA | 今日非合并提交 | 范围 |
| --- | --- | --- | --- | --- |
| `codex/attendance-hours-review` / [#2](https://github.com/WANGLEVY9/NJURedCross/pull/2) | PR 和提交账号为 xinyue-L01；与张欣慰的对应关系待 Owner 确认 | `5102ff9` | 16:17 `430e8c3`；16:24 `5102ff9` | 签到证据、逐人和月度时长复核、批量修改、Excel 导出；相对 main 41 个文件 |
| `feature/v3-changes` / [#8](https://github.com/WANGLEVY9/NJURedCross/pull/8) | Klein-Morett；提交署名 Wenjie Di，对应狄文杰 | `c9c5ae1` | 19:05 `0f0e465`；19:43 `9c88916`；19:46 `65a471b`；21:00 `8fc618f`；23:08 `4c0b820` | 投稿附件、三级存储归位、影像精选/删除审核、任务申领审核、技能与展示、多级审核；相对 main 74 个文件 |

PR #8 于 23:31 合并最新 main，保留新版留言墙。PR #2 尚未同步这部分更新。

## 必须先处理的问题

### P1：多级审核没有校验当前层级的真实审核人

PR #8 的 [server.js](https://github.com/WANGLEVY9/NJURedCross/blob/c9c5ae17fe3a406299a8042d2bc7cfc13be858cc/server.js#L4123) 将请求中的 `body.role` 写入审核轨迹。处理 `/step` 时只经过宣传模块权限和 CSRF 守卫，更新投稿之后才读取对接人目录；没有在更新前核验栏目、层级、会话身份和指定审核人的对应关系。

隔离状态机复现：同一 `same-unassigned-admin`、任意 `invented-role` 连续两次 approve 可得到第一级成功、第二级终审成功。此为模块复现与 HTTP 路由代码审查，不是生产 API 写入。

整改：从服务端目录解析当前审核人；校验其稳定账号标识；不要信任客户端 role；超管特批需单独权限、理由和审计。增加非指定审核人、同人跨级、伪造 role 的 HTTP 集成测试。

### P1：检查清单读取失败会放行审核

PR #8 [server.js](https://github.com/WANGLEVY9/NJURedCross/blob/c9c5ae17fe3a406299a8042d2bc7cfc13be858cc/server.js#L1051) 捕获全部读取异常后返回 `[]`，随后空的 `requiredChecklist` 允许 approve。`tests/v3-review.test.mjs` 还明确断言空模板兼容通过，因此现有绿色测试不能发现此业务风险。

整改：区分“明确允许无模板的历史内容”和“新审核清单缺失/上游故障”；新稿审核在模板不可用时返回明确 503，不推进、不写轨迹。覆盖缺表、网络错误、空模板及不完整勾选。

### P1（条件性上线风险）：时长表迁移门禁会阻断全部工作流写操作

PR #2 [server.js](https://github.com/WANGLEVY9/NJURedCross/blob/5102ff95dfe4953174a01bf443efdc5276048844/server.js#L255) 把八列检查放在全局 `assertWritable`，而工作流的创建、报名、取消等也调用该守卫。若时长表缺列，除了新增时长操作，既有报名等也会返回 `workflow_schema_required`。

要求的 text 列：工作内容、核对摘要、退回原因、具体工作地点、正式工作日期、备注、修订人、修订时间。

整改：将新字段门禁限定到相应时长操作，或先获批准完成目标库迁移再开放功能；自动代码发布不能隐式执行迁移。本轮用既有 SSH socket 尝试只读检查失败，返回 `Permission denied`，所以没有确认生产表当前是否缺列，也没有读取服务器 `.env`。

### P2：合并冲突及旧语录预览引用

PR #2 与 main 的冲突位于 `scripts/preview-workflow.mjs`。与 PR #8 联合整合还会冲突 `lib/README.md`。临时保留双方新增内容后仍有 `QUOTE_TABLE` 未定义，lint 失败。

诊断候选删除旧语录 seed、保留 `MESSAGE_TABLE` 和签到合成数据；文档保留两个模块说明。不得整体选用旧版文件，否则可能回退留言墙/预览接口。实际 MR 前需要把同样的冲突处理纳入可审查提交。

### P2：原生 prompt/confirm 不符合共享交互范式

PR #8 [task-claim.js](https://github.com/WANGLEVY9/NJURedCross/blob/c9c5ae17fe3a406299a8042d2bc7cfc13be858cc/public/app/portal/pages/task-claim.js#L92) 的申领备注使用 `window.prompt`；`photos.js` 的精选、更名、删除申请也使用原生弹窗。

整改：申领/删除理由用共享 Drawer + field；精选与批量更名用共享确认组件，保留加载、防重复提交、错误提示和焦点恢复。不另建主题或引入 UI 框架。

### P2：新增 schema 脚本未核验认证后的 Base UUID

`scripts/apply-v3-schema.mjs:100` 把配置 UUID 作为 `dtableName` 参数传入，但 `base.auth()` 后未比较真实 `base.dtableUuid`；确认短语只确认操作，不确认库身份。另有部分依赖表不存在时跳过加列，可能形成不完整初始化。

整改：写前验证认证所得 UUID 与明确目标一致；检查所有前置表、列类型、Box 双库和存储配置；预览列出完整依赖，失败时不把功能标记为就绪。本轮未运行实际迁移或云盘操作。

## UI 保留策略

按仓库 frontend-design 技能与 DESIGN.md / FRONTEND_DESIGN.md 审查。原生 JavaScript/CSS、NJU 字体、主题令牌、共享 button/field/table/badge/Drawer 保留；不采用开发分支整套旧页面覆盖 main。

已目视核对合并候选的手机投稿页和桌面宣传管理截图；新增页面总体沿用共享令牌，未观察到页面级横向溢出。保留 main 的首页、活动广场、侧栏、主题与留言墙三列/手机单列、装饰引号尺寸和键盘行为。新功能优先作为现有工作区分页/抽屉扩展。

## 验证证据

全部本地执行使用 Node 24；安装时宿主 Node 20 的 engine 警告不作为测试运行版本。未加载 `.env`，使用合成内存 fixture。

| 检出 | 验证结果 |
| --- | --- |
| PR #8 原始分支 | verify 通过；310 JS / 88 Markdown；544 项 Node 测试；权限 26、身份 103、资料 28 |
| main + PR #2，诊断性修复预览冲突 | verify 通过；287 JS / 87 Markdown；414 项 Node 测试；完整浏览器 194 通过、38 按配置跳过 |
| main + PR #8 + PR #2，诊断性修复两处冲突 | verify 通过；325 JS / 90 Markdown；572 项 Node 测试 |
| 联合候选的新增页面 + 导航专项 | 50 项桌面/手机浏览器测试通过；新增 12 项覆盖 /submit、/photos、/tasks、/showcase、/outreach、/console/outreach 的启动、宽度和控制台分页 |
| 联合候选完整浏览器 | 206 通过、38 按配置跳过，0 失败；包含新增 12 项页面诊断测试 |

新增页面专项使用拦截的合成 API 返回值；它验证页面和共享组件兼容，不证明真实投稿上传、云盘复制、邮件投递及多级审核业务闭环。现有 PR 的浏览器合成服务器没有提供新增附件/任务/技能/影像业务路由，CI 对旧页面的通过不能替代这些新流程的集成验收。

## 建议 MR 执行顺序

1. 确认 xinyue-L01 与张欣慰的对应关系，冻结已审查 SHA；补充分支自身 handoff 中缺失的验收项，不把数字签到码算作已完成。
2. 先处理 PR #2 与最新 main 的冲突及工作流门禁范围；补“未迁移仍可报名”的回归、时长修改→独立复核→Excel 下载的浏览器闭环。
3. 再处理 PR #8 的审核人身份、清单失败关闭、迁移 UUID 门禁和原生弹窗；新增非授权账号、缺表、重试、并发与失败路径集成测试。
4. 保留独立联合候选，验证 shared api.js、server.js、样式和导航；通过桌面/手机、主题、键盘、减弱动效及原功能回归后再接受 MR。
5. 外部表结构与双库配置先出只读预览和审批；代码发布与数据库迁移分开。main 自动部署后核对 Actions、服务器 receipt/release.json 和真实页面，再声明上线完成。

本报告与诊断测试仅存在于隔离 worktree；没有产生 main 合并提交。
