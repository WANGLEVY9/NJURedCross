# 物资中心本地整合交接

2026-10-08：在 `feature/materials-center` 已上传版本 `f68ae66` 上创建独立 `codex/materials-integration` 分支，保留同学的广场与四个入口，迁入此前管理、扫码台账、报销预处理与活动汇总。未向远端推送、未创建 PR、未部署。

## 数据边界

- `npm run preview:materials` 只读加载真实物资四表，然后克隆到独立内存。借用、入库、审核、活动资料补充和 PDF 都只修改本次服务内存，重启清空。
- 志愿服务试验板只读“登记审批”，用于活动名称、日期、地点及来源 ID；不读取报名人员、账号密钥库，不发送邮件。
- API 读取失败明确提示。页面不再调用 `public/app/core/mock.js`；目录失败停止提交，活动失败/为空不补造活动。
- 本地会话明确标注为模拟身份。真实凭据只在忽略的 `.env.materials-local`；客户端无 SeaTable Token。
- 新接口挂载于本地预览服务，**尚未作为生产服务器的持久化接口发布**。不能把前端接通理解为线上已经具备保存报销和入库请求的能力；持久化适配与上线在后续另行推进。

## 页面

| 用途 | 路径 |
| --- | --- |
| 四项服务广场 | `/materials` |
| 借用申请 | `/materials/borrow` |
| 报销上传与个人进度 | `/materials/reimburse`（旧 `/reimbursements` 保留别名） |
| 用户采购/捐赠登记与个人进度 | `/materials/inbound` |
| 管理台账、审批、借还 | `/console/materials` |
| 扫码登记 | `/console/materials/intake` |
| 入库申请实物核对 | `/console/materials/inbound` |
| 报销材料人工审核 | `/console/reimbursements` |
| 活动汇总表与材料包 | `/console/reimbursements/summary` |

场地借用保留说明页，暂不开发预约。

## 借用与入库接口

`GET /api/public/materials/catalog` 返回数组：`{ id, assetCode, name, unit, remaining, location }`。仅投影物资字段，不暴露申请人；停用物资不提供给新的申请；同名物资通过储位区分。`id` 为物资表原行 ID，`assetCode` 为现有类别码 `NJU-RC-<行ID>`，不采用名称作为关联键。

`POST /api/public/materials/requests` 在既有申请字段之外传 `materialId`、`assetCode` 和 `idempotencyKey`，数量须为正整数。本地服务重新核对 ID/码与库存，并从目录生成物资名称，不能信任客户端名称；生成申请只进入待审批，不扣库存。审批后出库须与原申请物资及件数一致，仍需照片。原有不带类别码的历史申请保留原核对方式。

`POST /api/public/materials/inbound`：`{ materialId, assetCode, quantity, source, location, note, idempotencyKey }`。`source` 仅“采购”或“捐赠”。返回 `code`、状态标签和 `record`；库存尚未变化。

- `GET /api/public/materials/inbound` 仅返回本账号登记。
- `GET /api/preview/materials/inbound` 需管理权限，返回审核队列。
- `POST /api/preview/materials/inbound/:id/review`：`{ action: "approve" | "reject", revision, physicalChecked, note }`。通过前必须确认实物、件数和储位；拒绝必填说明。
- 审核通过以固定操作键 `inbound:<登记ID>` 写入共用入库流水，一次记账。重复审核、版本冲突、已停用等情况拒绝；拒绝不改变库存。
- 登记中的 `location` 表示本批实物存放位置，并留在申请与流水中。物资中心/柜号/层数仍通过已有管理资料编辑，不将用户自由文本直接覆盖结构化储位。
- 借用归还必须通过原借用单扫码归还，不允许混入普通采购/捐赠登记。

## 报销接口

复用 `/api/preview/reimbursements` 的私有上传、合并、OCR 提示、个人查询、人工审核和活动汇总。页面支持多份 PDF 上传、调序、合并预览和保留原件。

提交体为既有 `{ name, purpose, amount, bundleId, idempotencyKey }` 加：

```json
{
  "activityId": "applications:<登记审批原行ID>",
  "expenseDate": "2026-10-08",
  "voucherNote": "凭证与明细的对应说明",
  "expenseItems": [{ "label": "支出项目", "amount": "12.30", "note": "用途" }]
}
```

金额使用十进制字符串，客户端自动合计、服务端用分校验明细与总额。最多 50 项；日期与凭证说明随版本保存，退回补充后回填，不丢失。文件须先上传成属于本账号的 `bundleId`，不能仅提交文件名。审核查看原件、明细与凭证说明；通过只是材料审核完成，不表示付款。

活动来源目前没有“活动项目表”。只读定义使用 `applications:<原行ID>` 命名空间，确保来源稳定、同名活动不混淆；名称不会自动推断成正式活动中心 ID。本地管理员可补齐人数、目的、经费卡号等报销表资料，后续与活动中心负责同学确认 canonical ID 映射和活动可选口径。

## 暂保留的会员问题

按用户决定，借用/入库暂沿用 `memberCode`，本地服务也检查这个临时规则。现有后端邮箱验证即生成该码，**不能证明红会正式会员资格**。已记录，待初步开发结束后与负责人讨论真实资格来源、普通已验证用户是否允许申请、例外权限及正式后端校验。此次不新增会员字段或擅自修改判断。

## 验证

新增 `tests/materials-portal.test.mjs` 验证稳定物资 ID、类别码/数量核对、重复提交与库存一次记账、普通入库与借用归还分开、个人记录隔离、会话/CSRF/审核权限、活动 GET 分页及隐私投影、金额和凭证说明重提保留。

浏览器实际验证：真实目录借用提交；采购登记→实物核对→本地库存一次增加；两份合成 PDF→两页合并→两项金额 0.10+0.20=0.30→人工审核→活动表与材料包生成；目录 503 时停止提交。1440 像素桌面、390/320 像素手机主要页面无横向溢出，无页面脚本错误。合成文件及测试申请仅在联调端口内存中，默认展示实例重新加载干净快照。

凭据、浏览器截图、PDF 和测试输出不进入源码提交。
