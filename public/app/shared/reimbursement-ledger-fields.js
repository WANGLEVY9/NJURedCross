export const LEDGER_COLUMNS = Object.freeze([
  ['code', '申请编号'], ['applicant', '申请人'], ['activity', '活动'], ['purpose', '事由'], ['amount', '申请金额（元）'],
  ['status', '处理状态'], ['expenseDate', '活动日期'], ['submittedAt', '提交时间'], ['initialReviewer', '初审人员'],
  ['finalReviewer', '复审人员'], ['paidDate', '实际打款日期'], ['paidAmount', '已登记打款金额（元）'], ['paymentReference', '打款凭证编号'],
].map(([key, label]) => Object.freeze({ key, label })));
export const ITEM_LEDGER_COLUMNS = Object.freeze([...LEDGER_COLUMNS,
  ...[['itemActivity', '条目所属活动'], ['activityCategory', '活动类别'], ['approvedAmount', '终审核定金额（元）'], ['payableAmount', '条目实际可支付金额（元）'], ['itemPaidAmount', '条目实际打款金额（元）'], ['differenceReason', '差额原因'],
    ['expenseCategory', '报销类别'], ['expenseLabel', '支出项目'], ['expenseAmount', '支出金额（元）'], ['expenseNote', '项目备注'],
    ['invoiceFiles', '对应发票原件'], ['buyerName', '购买方名称'], ['buyerTaxId', '购买方识别号'], ['sellerName', '开票方名称'],
    ['invoiceNumber', '发票号码'], ['invoiceDate', '开票日期'], ['invoiceAmount', '发票价税合计（识别结果）']]
    .map(([key, label]) => Object.freeze({ key, label }))]);
