# 任务与技能模块（v3.1）

> 适用版本：NJU RedCross 平台 v3.1（分支 `feature/v3-changes`）
> 最后更新：2026-10-11
> 代码位置：数据契约 `lib/attachment/store.js`（第 244–330 行）、路由与校验 `lib/attachment/tasks.js`、前端 `/tasks` 页与「我的」页技能面板

本页讲清三件事：**任务怎么发和申领（含管理员审核）**、**技能认证怎么填和审**、**表结构与接口契约**。

---

## 0. v3.1 改了什么（2026-10-11 用户定案）

| # | 变更 | 旧行为 | 新行为 |
| --- | --- | --- | --- |
| 1 | 技能名称输入方式 | 手填自由文本 | **8 项下拉选择**；选「其他」才需手填 |
| 2 | 常用软件 | 无 | **13 项多选**；选「其他」需手填 |
| 3 | 往期作品链接 | 一律选填 | 技能名为**「绘图与二创」时必填** |
| 4 | 任务发布 | 只有类型 + 星级 | 追加**技能要求（技能名称 + 所需星级）**，且为必填 |
| 5 | 任务申领 | 申领即到手 | **提交后进入「申领审核中」，管理员审核通过才真正接单**；驳回则任务重新开放 |

---

## 1. 任务流程

### 1.1 状态机

```
                  发布
                   │
                   ▼
              ┌─────────┐   某人申领    ┌──────────────┐  管理员通过  ┌─────────┐
              │ 待认领   │ ───────────▶ │ 申领审核中    │ ──────────▶ │ 已认领   │
              └─────────┘              └──────────────┘             └─────────┘
                   ▲                          │
                   └──────────────────────────┘
                        管理员驳回（清空认领人）

              已关闭 ← 人工收口（不再接受申领）
```

- `TASK_STATUS`：`待认领` / `申领审核中` / `已认领` / `已关闭`。
- `CLAIM_STATUS`（申领记录自身状态）：`待审核` → `已通过` / `已驳回`。
- **未审核通过前 `任务表.认领人` 保持为空**；只有 `approve` 才写认领人与认领时间。驳回时任务回到 `待认领` 并清空认领人，可再次申领。
- 申领审核是**排他**的：任务一旦进入 `申领审核中`，其他人再申领会得到 409 `task_not_open`（不做多人竞标）。

### 1.2 发布（控制台，需 console 权限 + CSRF）

`POST /api/console/tasks`

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `title` | ✅ | ≤ 60 字，错误码 `task_title_required` / `task_title_too_long` |
| `description` | 选填 | ≤ 400 字，`task_desc_too_long` |
| `type` | 选填 | 白名单 `文字撰写 / 摄影摄像 / 平面设计 / 推文排版 / 现场执行 / 其他`，默认第一项；非法 `task_type_invalid` |
| `stars` | ✅ | 发布人自评 1–5 星，`task_stars_required` |
| `skillRequirement` | ✅ | 必须来自 8 项技能字典；`task_skill_required` / `task_skill_invalid` |
| `skillRequirementOther` | 选「其他」时 ✅ | ≤ 30 字，手填值最终写入 `技能要求` |
| `skillStars` | ✅ | 所需技能星级 1–5，`task_skill_stars_required` |

> 任务星级（`stars`）是**发布人自评**，只用于排序与提示，不做硬性门槛；真正用于「这个任务要什么技能、要几星」的是 `技能要求` + `要求星级` 两列。

### 1.3 申领（门户，登录 + CSRF，`task` 桶 20/小时）

```
POST /api/public/tasks/:id/claim   { note?: string }
→ 201 { claim: { id, taskId, status: '待审核', at, note }, mailed, message }
```

- 任务不存在 → 404 `task_not_found`；状态不是 `待认领` → 409 `task_not_open`。
- 落表：任务申领表新增一行（`状态 = 待审核`），任务表状态改 `申领审核中`；并发邮件提醒（未配 SMTP 时静默跳过，`mailed=false`）。
- `GET /api/public/tasks/mine` 返回本人全部申领（含 `status` 与任务详情），前端页签文案为「**我申领的**」。

### 1.4 审核（控制台）

```
GET  /api/console/tasks/claims
→ { pending: [...], reviewed: [...], statuses: { pending, approved, rejected } }
   每条 claim 附带 task 详情（标题/星级/技能要求）

POST /api/console/tasks/claims/:id/review   { decision: 'approve' | 'reject', note? }
```

| 规则 | 错误码 |
| --- | --- |
| `decision` 必须是 `approve` / `reject` | 400 `claim_decision_invalid` |
| 驳回必须写原因 | 400 `claim_note_required` |
| 申领不存在 | 404 `claim_not_found` |
| 已处理过的申领不能再审 | 409 `claim_already_reviewed` |

审核通过 → 申领 `已通过` + 任务 `已认领` + 写认领人/时间；驳回 → 申领 `已驳回` + 任务回到 `待认领`。两端都写审计（`task.claim.approve` / `task.claim.reject`）。

---

## 2. 技能认证流程

### 2.1 字典（唯一来源 `lib/attachment/store.js`）

**技能名称 `SKILL_NAMES`（8 项，单选）**
`图片处理` · `公众号排版` · `海报设计` · `绘图与二创` · `板写与 logo 设计` · `动画与 live 2D` · `3D建模` · `其他`

**常用软件 `SKILL_SOFTWARES`（13 项，多选）**
`Procreate` · `画世界 pro` · `天生会画` · `PS` · `AI` · `Canva` · `秀米` · `Tinkercad` · `Blender` · `3Dmax` · `AE` · `Live2D Cubism Editor` · `其他`

- 选「其他」时前端显示手填框，手填值**并入提交数组**（服务端会丢掉占位值 `其他` 本身，只留实际值）。
- 技能名为 `绘图与二创`（`SKILL_PORTFOLIO_REQUIRED_FOR`）时，**往期作品提交链接必填**。
- 常用软件列在表里以 **JSON 数组文本**存储（`formatSkillSoftwares` / `parseSkillSoftwares` 负责编解码，历史脏值按顿号/逗号兜底切分）。

### 2.2 提交（门户，登录 + CSRF，`skill` 桶 **10 次/小时**）

`POST /api/portal/skills`

| 字段 | 必填 | 规则与错误码 |
| --- | --- | --- |
| `name` | ✅ | 必须来自 8 项字典；空 `skill_name_required`，字典外 `skill_name_invalid` |
| `nameOther` | 选「其他」时 ✅ | 空 → `skill_name_other_required`，≤ 30 字 |
| `softwares[]` | ✅ | 至少 1 项，否则 `skill_softwares_required`；单项 ≤ 40 字 `skill_software_too_long`；**自动去重** |
| `description` | ✅ | 10–300 字：`skill_desc_required` / `skill_desc_too_short` / `skill_desc_too_long` |
| `selfStars` | ✅ | 1–5 星，`skill_stars_required` |
| `proof` | 条件必填 | 技能名 = `绘图与二创` 时必填，`skill_portfolio_required` |

- 同名技能已有**待审核**记录 → 409 `skill_pending_exists`。
- `GET /api/portal/skills` 返回 `{ skills, names, softwares, other, portfolioRequiredFor, stars }`——前端下拉/多选/条件必填全部由服务端字典驱动。
- 审核通过后，最终星级写回**平台账号表.技能星级**，该值随 `GET /api/public/tasks` 的 `myStars` 下发（用于任务匹配提示）。

### 2.3 审核（控制台）

```
GET  /api/console/skills      → { queue: [待审核...], reviewed: [...], levels }
POST /api/console/skills/:id/review   { decision: 'approve', level: 1-5 } | { decision: 'reject', note }
```

通过必须给最终星级（400 `skill_level_required`），驳回必须写原因（400 `skill_note_required`），重复审核 409 `skill_already_reviewed`。控制台「宣传广场 → 技能审核」页签展示 `常用软件` 列与详情。

---

## 3. 表结构（SeaTable）

**任务表**（12 列）
`任务ID` · `标题` · `说明` · `类型` · `星级要求` · `发布人` · `状态` · `发布时间` · `认领人` · `认领时间` · **`技能要求`** · **`要求星级`**

**任务申领表**（9 列）
`申领ID` · `任务ID` · `申领人` · `状态` · `时间` · `说明` · **`审核人`** · **`审核时间`** · **`审核意见`**

**成员技能表**（11 列）
`技能ID` · `账号` · `技能名` · `说明` · `证明文件` · `自评星级` · `状态` · `审核人` · `审核意见` · `提交时间` · **`常用软件`**

> 加粗为 v3.1 新增列。Schema 变更通过 `npm run v3:dry-run` / `npm run v3:apply`（`scripts/apply-v3-schema.mjs`）落库，脚本自带「建表后再判存在、加列前重读列」的双重幂等保护。

---

## 4. 前端呈现

| 位置 | 说明 |
| --- | --- |
| `/tasks`（`portal/pages/task-claim.js`） | 三个页签：心愿清单 / 发布任务 / **我申领的**。发布表单含「技能要求」下拉 + 「其他」手填框 + 「所需星级」；任务卡片显示技能 chip 与三态状态标签；申领前提示「提交后需管理员审核」 |
| 「我的」页技能面板（`portal/pages/me-skills.js`） | 技能名下拉（选「其他」出现手填框）→ 常用软件 13 项多选框（选「其他」出现手填框）→ 选「绘图与二创」时作品链接标签自动追加「必填」→ 说明 / 自评星级 / 提交 |
| 控制台「宣传广场」 | 页签新增 **「任务审核」**（待审核表 + 已处理表 + 详情抽屉 + 通过/驳回）；「技能审核」表新增**常用软件**列 |

---

## 5. 回归与端到端

- 单测：`tests/v3-tasks.test.mjs`（字典 / 列契约 / 状态机 / 三处校验 / 编解码），全量 `node --test tests/*.test.mjs` 468 项。
- 端到端：`E2E_BASE=http://127.0.0.1:3210 npm run smoke:v3-tasks` —— **37 项 0 失败**，覆盖发布校验（含技能要求「其他」手填）、申领 → 审核通过 / 驳回后再申领、技能下拉与软件多选、条件必填、越权与无 CSRF 拦截、记录清理。
- ⚠️ 技能提交限流 **10 次/小时**（进程内存计数）。同一进程内重复跑冒烟脚本会撞 429，重启服务即可复位；这也是脚本里刻意把技能提交压到 8 次以内的原因。
