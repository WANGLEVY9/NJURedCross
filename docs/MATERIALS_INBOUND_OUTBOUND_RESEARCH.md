# 物资出入库调研（D2）

> 本文档只做调研、不改代码，结论直接指导 D1（二维码标签 + 编号兼容）与后续 D3/E9 的编码方案。
> 落点均来自当前代码事实：`lib/materials/service.js`、`lib/materials/local-movements.js`、`lib/materials/production-workflow.js`、`lib/materials/management-api.js`、`lib/materials/public-api.js`、`server.js` 的物资路由段。

## 一、现有流程 vs 实际作业：差异清单

现有系统围绕 6 类操作闭环（`service.js` 的 `operations` 数组）：

| 操作 | 现有入口 | 触发链路 | 实际作业可能缺的环节 |
|---|---|---|---|
| 入库 | `POST /api/materials/transactions`（库存登记）、`local-movements.js` 方向「入库」 | 新物资首次入库 / 采购、捐赠、调拨补货 | 缺「入库单」留痕：采购/捐赠来源只有一段 `reference` 文本，无单据编号、无采购人/供应商字段 |
| 出库 | 同上，方向「出库」 | 领用、消耗的直接出库 | 缺「领用单」：`destination` 只有文本去向，无领用人实名/学号/用途分类，无法与活动或部门对账 |
| 归还 | `POST /api/materials/applications/:id/return`（借出归还）+ 公众端 `public-api.js` 的归还登记 | 借出 → 归还 → 结清 | 归还需现场照片留痕，但「损耗数量」与「物品缺失」只在申请单上标记，无独立报损单 |
| 盘点增加 / 盘点减少 | `local-movements.js` 方向「入库/出库」的盘点类 | 盘点差额登记 | 缺「盘点单」：无盘点批次号、无盘点人/复核人、无盘点时间窗口，无法追溯某次盘点覆盖了哪些物资 |
| 报损 | 同上 | 损坏/失效登记 | 缺「报损单」：报损无审批，任何有 `canReview` 权限者可直接登记，无报损原因分级、无资产处置去向 |

**核心结论**：借出→出库→归还→报损的**库存数量闭环**已经完备（`service.js` 的 `applicationAction` + `transaction` 幂等、锁、同步都在），缺的是**单据层**——每个操作只有「流水记录」没有「业务单据」，导致溯源只能看流水、不能看单据。

## 二、缺哪些单据

对照现有路由（`management-api.js` 的 `matched` 列表：`overview / schema / scan / flows / movements / inventory / returns / inbound`）：

| 单据 | 现状 | 缺口 |
|---|---|---|
| 入库单 | 只有 `物资流水表` 一行「入库 + reference」 | 无采购/捐赠来源结构化字段、无单据编号 |
| 出库单 / 领用单 | 只有「出库 + destination」 | 无领用人/部门/活动关联 |
| 借用单（已有） | `物资管理` 表 + `REQ-${_id}` 编号 | 相对完整（`applicationSummary` 已有申请人/用途/周期/状态） |
| 归还单 | 借用单内联 + 公众端归还登记（`production-workflow.js` 的 `record` kind `return`） | 归还登记走独立的 `store`（SQLite 协调库），与 `物资流水表` 是两套，需在 `review` 时合成 |
| 盘点单 | 无 | 完全缺失 |
| 报损单 | 无 | 完全缺失 |

**缺口优先级**（建议）：盘点单 > 报损单 > 入库/出库单据。盘点与报损是「资产是否真实存在」的底线，最需要单据化留痕。

## 三、编号是否要重排

**结论：资产码不重排，流水编号保持不变。**

- 资产编码 = `materialCode(row) = NJU-RC-${row._id}`（`service.js:16`），由 SeaTable 行 `_id` 派生，天然稳定唯一。
- 扫码校验 `scan()` 只认 `/^NJU-RC-[A-Za-z0-9_-]+$/`（`service.js:211`），QR 端点编码的也是这个资产码（`server.js:5807-5814`）。
- 流水编号 = `TX-${randomBytes(7).toString('hex')}`（`service.js:170`），是**随机流水号**，与资产码无关，仅作流水行唯一标识。

**「能不能改、改了旧码怎么办」的分析**：

1. **资产码能不能改**：技术上能（只改 `materialCode()` 一处），但**不建议**。资产码已被三处强关联：① 已打印/分发的二维码内容；② `物资流水表.资产编码` 的历史行；③ `物资配置表.资产编码` 的预警配置。改了资产码，历史流水与预警配置全部对不上，必须补一张「旧码→新码」迁移映射表，代价远大于收益。
2. **流水编号能不能改**：可以改格式（如改成更可读的 `TX-YYYYMMDD-序号`），但历史流水编号已在 `幂等键`、审计、`申请单ID` 关联中被引用，改了同样要做映射。当前随机 hex 已满足唯一性，**不建议改**。
3. **旧码兼容**：若历史上存在非 `NJU-RC-` 前缀的资产编码，扫码/标签查询会 400/404。兼容做法 = 扫码时先按 `NJU-RC-` 前缀匹配，匹配不到再回退按 `_id` / `资产编码` 列精确匹配（见 D1·编号兼容）。

> 待「M1」决策会确认；本调研默认结论 = 不重排。若 M1 另作决定，仅改 `materialCode()` + 加旧码映射列即可，其余不动。

## 四、D1 / D3 拆解建议

### D1 · 二维码批量标签（拆两小步）

1. **标签打印**（纯前端 + 现成 QR 接口）：控制台库存台账「打印标签」入口 → `dataTable` 批量勾选 → A4 多标签拼版 → `window.print()`。二维码复用 `GET /api/materials/inventory/:id/qr`，但需把编码内容从「裸资产码」改为「详情深链 URL」，并补一个扫码落点页，才能实现「扫码直达详情」。
2. **编号兼容**：只补旧码容错（上节第 3 点），不重写编号规则。

### D3 · 场地借用 v1（拆三小步）

1. **清单 + 时段**：新增「场地表」，公众端/控制台渲染可借场地与时段。
2. **申请 + 审批**：新增「场地借用申请表」，状态机 `待审批 → 审批通过 → 已结束`（拒绝分支 `审批不通过`），复用 `service.js` 的 `withLocks` + frozen 状态机模板。
3. **冲突 + 日历**：同场地同时段唯一有效申请（复用 `lib/events/workspace-live-edit.js:53` 的重叠公式），审批后占用时段进日历。

> 参考既有文档（不复制）：`docs/MATERIALS_MANAGEMENT.md`、`MATERIALS_MODULE.md`、`docs/MATERIALS_CENTER_INTEGRATION.md`、`reports/archive/MATERIALS_GAP_ANALYSIS.md`。
