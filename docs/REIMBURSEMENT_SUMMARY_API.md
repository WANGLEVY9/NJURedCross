# 活动报销汇总：用户端对接约定 v1

2026-10-12：默认本地服务已采用 [二级审核流程](REIMBURSEMENT_WORKFLOW_API.md)，仅本版初审、复审均通过的申请进入汇总。旧一级审核通过记录不能自动视为复审通过。旧提交仍可接收，但缺少可靠项目或材料类型关联时须退回补充，不能绕过新的送审校验。生成汇总与待打款独立，不登记付款。

2026-10-07。本轮只做管理端，用户端的活动关联与逐项支出明细由另一位同学实现，后续按本约定适配。当前接口仅存在于本地预览，不是已部署的生产 API。没有新增远端表或改动库中记录；全部活动、材料和汇总保存在私有内存，重启清空。

## 最小对接范围

申请必须关联稳定的 `activityId`，不能按活动名称自动归并；同名活动可能是不同活动。当前由管理员维护本地活动资料，后续可将活动中心的稳定 ID 通过适配器映射到这里。需要沟通 ID 来源和活动读取方式，不要求另一位同学采用本模块的页面实现。

用户提交申请时，在现有提交字段上增加 `activityId` 和 `expenseItems`。每次申请的明细合计须等于该次申请金额。金额传十进制字符串，内部按整数分运算；不通过 OCR 自动生成支出明细。

2026-10-10：支持银行卡字段的环境在配置接口返回 `bankAccount: { minLength: 16, maxLength: 19 }`。用户端提交与补充重提须填写本人 `bankAccount`，按字符串传输和保存，须为 16–19 位半角数字，不含任何空白，不自动去除空格。服务端同样校验已提供的号码；旧接口缺省字段继续兼容。申请人自己的详情与审核人详情显示号码，其他账号不能读取。本轮仅作格式校验，不校验银行或账户归属，不登记付款；该字段不进入活动费报销表的经费卡号。

旧提交同时不包含这两个字段时仍然接受，可正常审核，但不参与活动汇总。只传其中一个字段会拒绝。已通过审核的旧申请不能靠猜测补活动或明细；补录流程需另行确定。

## 活动选项

`GET /api/preview/reimbursements/activities`

服务层向普通申请人只返回 `id/name/date/location`；管理员可读完整活动资料。当前预览用模拟管理员会话兼任两端，不代表实际用户权限配置。

```json
{
  "ok": true,
  "protocolVersion": 1,
  "activities": [{ "id": "event-001", "name": "活动名称", "date": "2026-10-07", "location": "活动地点" }]
}
```

管理员 `POST .../activities` 维护 `name/date/location/participantCount/description/unitName/fundAccount`。创建可指定稳定 ID，否则由服务生成；修改须带 `id/revision`，版本冲突返回 409。可先保存名称，生成表格前必须补齐全部活动字段。没有默认真实经费账号。

2026-10-10：报销表预览和新生成 PDF 的“经费卡号”统一为 `4301011309001041656`，不采用活动资料中的 `fundAccount`。仅用于报销表模板，不改申请或活动记录；已生成并保存的历史 PDF 保持原版本。

补充材料按同一申请内的补充材料顺序单独编号，从 `01` 开始，发票不占补充材料序号。已缓存的旧文件名在材料列表及原件下载时按该规则显示，不修改原件字节。

## 用户提交示例

材料预处理继续使用 `POST /api/preview/reimbursements/bundles`，分类上传原件后取得 `bundle.id`；原件与材料归属逻辑不变。然后：

`POST /api/preview/reimbursements`

```json
{
  "name": "申请人姓名",
  "purpose": "本次采购用途",
  "amount": "200.00",
  "bundleId": "预处理返回的材料包ID",
  "idempotencyKey": "本次操作的唯一标识",
  "activityId": "event-001",
  "expenseItems": [
    { "label": "便利贴", "amount": "120.00", "note": "互动环节" },
    { "label": "打印", "amount": "80.00", "note": "活动材料" }
  ]
}
```

- `activityId` 最多 160 字符，须存在于可选活动资料中。
- `expenseItems` 每次 1–50 项；`label` 必填，最多 100 字符；`note` 可省略或为空，最多 300 字符。
- 每项金额大于 0，最多两位小数；不接受浮点数字、负数、科学计数法或额外未知明细字段。
- 所属账号由会话确定，不能通过请求体指定。上传包须属于当前账号。
- 请求成功返回 `request.id/revision/activityId/expenseItems`；返回明细以 `amountCents` 表示整数分，并附本次版本中的明细 ID。
- 退回补充沿用 `POST .../requests/:id/resubmit`，上传新材料并重新传活动与完整明细，产生新的 `revision`。
- 同一操作标识与相同内容重试只产生一份申请；改内容必须更换标识。

## 管理端选取、预览与生成

`GET /api/preview/reimbursements` 返回供审核人查看的申请，新增 `summaryEligibility = { eligible, reason, summaryId }`。

可选条件为：人工审核通过、活动关联和明细完整、明细金额一致、当前版本未纳入汇总。每次最多 20 笔、合计最多 200 项支出；只能选同一活动。没有付款状态，本功能不自动将审核通过解释为已付款。

`POST /api/preview/reimbursements/summaries/preview` 用于预览，`POST .../summaries` 用于正式生成本地记录；共同请求体：

```json
{
  "activityId": "event-001",
  "activityRevision": 1,
  "selections": [{ "requestId": "申请ID", "revision": 1 }],
  "mergeSameItems": true,
  "form": { "handlerName": "经办人", "handlerPhone": "联系电话", "fillDate": "2026-10-07" },
  "idempotencyKey": "本次生成的唯一标识",
  "duplicateMaterialsConfirmed": false
}
```

`mergeSameItems=true` 只合并名称和备注同时相同的支出，保留每行 `origins`（申请 ID、编号、版本、明细 ID、金额分）。不同备注保持分行。预览不占用申请，生成时再次校验活动与申请版本。

如果原件 SHA-256 相同的材料出现在多笔申请中，返回 `duplicateMaterials` 提示人工核对。生成时须显式传 `duplicateMaterialsConfirmed=true`；这只能发现字节相同的文件，不能发现重新扫描、重新编码或不同 PDF 中的同一张发票（单纯改文件名仍会被发现）。

生成成功返回 `summary`，包含活动与经办信息快照、所选版本、支出行、总金额分和金额大写、页码映射、`formUrl/packetUrl`。首次返回 201；相同标识和请求重试返回 200 且 `duplicate=true`。申请在生成成功后才标记已纳入；失败可重试，不留下半份汇总。新批次可汇总该活动后续未纳入的申请。

`GET .../summaries` 查看历史，`GET .../summaries/:id` 查看记录，`GET .../:id/form` 下载表格，`GET .../:id/packet` 下载表格加附件。汇总记录与下载只对审核人开放，文件禁止缓存。访问和写请求继续使用本地会话与 CSRF；未来生产需对接真实财务审核权限和持久化事务。

## PDF 与模板边界

发票下载名采用“报销人-报销类别-报销条目-发票.pdf”，不带序号；补充材料仍保留序号。审核页默认展示六项结果及抬头、红章结果，仅在排队、处理中或失败时显示处理状态，移除固定的解释段落。旧自动文件名在页面与下载时兼容显示新名称，原始文件及存储记录不改。

表格用代码绘制，嵌入中文字体，按内容换行及续页，计算金额大写。二级流程的完整包先放表格，再按所选申请顺序及申请中的支出项目顺序，复制本版初审生成并经复审通过的项目合并 PDF；每个项目内部为发票 → 订单及付款 → 其他材料，整份申请共用材料最后单列且只附一次。订单及付款单独下载件不再次附入，防止重复页。缺少当前版本派生件时拒绝生成，不能回退到原始整份合并件或自动重新生成。仅显式旧协议兼容模式保留整份材料顺序。

预览与生成记录增加 `materialsOrder: request-expense-invoice-order-payment-other`、`materialGroups`；每组含申请、材料版本、材料包、项目 ID、组类型、名称及页数，不返回 PDF 字节。生成后 `attachments` 含各组的材料包页码，以及原件索引、SHA-256、原文件名、原件页码和在材料包中的页码，目录可据此对应原件。Word 原件以空页码保留，另附下载，不制造空 PDF 页。保留已有材料容量、重复材料确认、版本和并发校验，生成失败不占用申请。原件字节不改，签字和公章栏留空。合并不声称保留原件电子签名有效性。

当前版式根据截图重建，尚未取得正式空白 PDF/Word 模板。字段、行距和版式仍需用原模板核对，不能宣称已获学校格式验收。Windows 默认使用本机仿宋 TTF；其他环境须配置 `REIMBURSEMENT_FONT_PATH` 为具有使用权限的中文 TTF/OTF，不将 Windows 字体复制进源码。缺字体或字体无法显示字符会明确拒绝生成。

完整材料包上限 300 页、100 MB；生成任务最长 30 秒。本轮私有内存总容量仍为 500 MB，最多 30 份汇总。没有持久化、付款登记、撤销汇总或邮件通知；未来持久化适配器须保留版本校验、申请占用和生成失败回退的原子性。

## 本地查看

2026-10-09 材料分类扩展：上传 `POST /api/preview/reimbursements/bundles` 支持文件字段 `invoices`（发票）、`supporting`（补充材料），并附 JSON 字符串字段 `manifest`，按文件出现顺序提供 `[{"expenseItemId":"对应支出项目ID"}, {"expenseItemId":""}]`。两组文件共用原有数量、字节和页数上限；不允许混用旧 `files` 字段和分类字段。旧 `files` 协议仍单独可用，归类为 `legacy`。

2026-10-10 上传能力 `materialUploads.version=3`：`invoices` 仅 PDF；`supportingFormats` 包含 `pdf/doc/docx/jpg/jpeg/png`，校验文件内容而非只信扩展名或浏览器 MIME。图片进入连续 PDF 预览，Word 原件标记 `preview=original-only`、`pages=0`、`startPage/endPage=null`，必须下载原件核对。仅有 Word 时 `pageCount=0`、`mergedUrl=null`。原件下载返回真实 Content-Type 并保留扩展名，合并下载返回按申请命名的 `mergedName`；原字节不变。汇总中的 `unmergedAttachments` 保留 Word 名称、哈希及私有下载链接，生成的汇总 PDF 提醒分别保存 Word 原件。

提交的 `expenseItems` 可选提供 `id`（不重复的稳定字符串）和 `category`（报销类别）；旧客户端缺省 ID 时仍按原顺序生成 `1/2/...`。每份新发票须引用本次申请中的有效项目，补充材料可不引用；绑定校验和自动下载命名在提交服务中完成。返回材料目录含 `kind`、`expenseItemId`、`originalName`、下载名和原有 SHA-256。下载名不改变原件字节。活动汇总仅合并类别、项目、备注均相同的明细；未提供类别的旧明细保持原语义。

分析结果新增 `invoice.fields`，键为 `buyerName/buyerTaxId/sellerName/invoiceNumber/invoiceDate/totalAmount`；每项含 `value/state/method/confidence/evidence`，状态为 `extracted/unknown/conflict`。识别号与号码是字符串，日期规范为 `YYYY-MM-DD`，金额为两位小数的价税合计字符串。辅助检查不影响审核状态或申请金额。支持材料不进入发票识别队列，但仍保留合并页码和下载。

正常开发沿用 `npm run preview:materials`，真实物资仅只读获取，报销只在内存演示。独立完整闭环运行 `npm run preview:reimbursement-summary`，打开 `http://127.0.0.1:3135/console/reimbursements/summary`；使用明确标注的合成活动、三名申请人和四笔已审核申请，不加载凭据或连接远端。
