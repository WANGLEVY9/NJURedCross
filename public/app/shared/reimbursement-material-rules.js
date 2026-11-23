export const SCHOOL_TAX_ID = '12100000466007458M';
export const REIMBURSEMENT_CATEGORIES = Object.freeze(['火车票/高铁票', '机票', '物资采买', '打印材料', '打车', '快递', '住宿']);
const requirements = {
  '火车票/高铁票': ['发票'], '机票': ['发票', '高铁二等座价格证明'],
  '物资采买': ['发票', '订单截图', '付款截图'], '打印材料': ['发票', '订单截图', '付款截图'],
  '打车': ['发票', '行程单', '订单截图', '付款截图'],
  '快递': ['发票', '快递单', '快递起终点截图', '付款截图'],
  '住宿': ['发票', '人员名单', '订单截图', '付款截图'],
};
export const requiredReimbursementMaterials = (category, meeting = false) => [...new Set([...(requirements[category] || []), ...(meeting ? ['会议邀请函'] : [])])];
export const reimbursementMaterialHint = type => ({
  '发票': '上传 PDF 原件；请核对发票抬头、税号与红章。开票方与店铺名称不一致时，请附订单截图佐证交易关系。',
  '订单截图': '购物订单请完整显示订单号、收货地址、商品类别、付款金额；打车订单请显示订单号、出发地、目的地和金额。',
  '付款截图': '进入支付宝、微信或银行等付款工具的交易明细，完整显示付款金额、付款时间、付款订单号和收款人。',
  '订单和付款截图': '需同时包含完整订单信息及付款工具交易明细。PDF 或 Word 内有两张截图时，请把订单放在前面、付款放在后面。',
  '共用付款账单': '保留完整付款记录，填写本订单分摊的实付金额，并在特殊情况说明注明共用关系。其他订单请分别申请。',
  '物流截图': '请上传完整的物流信息，并分别上传订单截图和付款凭证，平台会在同一页排成三栏。',
  '行程单': '打车行程单请上传 PDF 原件，包含对应行程。',
  '高铁二等座价格证明': '提供同起终点的高铁二等座价格高于机票价格的证明截图；价格关系需审核人核实。',
  '快递单': '提供本笔快递的运单凭据。', '快递起终点截图': '清晰呈现本笔快递的寄件地、收件地和运单关联信息。',
  '人员名单': '住宿报销需提供对应住宿人员名单。', '会议邀请函': '参加会议时需提供与会议及外出事由对应的邀请函。',
}[type] || '请提供清晰、完整并可对应本笔申请的辅助材料。');

/** Versioned requirements apply to new forms, without retrospectively rejecting historical categories. */
export function reimbursementMaterialIssues(request, files) {
  if (request.materialRulesVersion !== 1) return [];
  const issues = [];
  if (request.singleOrderConfirmed !== true) issues.push('请确认本申请仅对应一笔订单；多笔订单请分次提交。');
  if (typeof request.meetingRelated !== 'boolean') issues.push('请选择本次报销是否用于参加会议。');
  if (!request.expenseItems?.length) issues.push('请填写至少一项支出明细。');
  const types = files.filter(file => file.kind === 'supporting').map(file => file.materialType);
  const shared = types.filter(type => type === '共用付款账单').length;
  if (shared) {
    if (shared !== 1 || types.some(type => ['付款截图', '订单和付款截图'].includes(type)))
      issues.push('共用付款账单请上传一份，并与本订单对照，避免重复使用其他付款截图。');
    if (!(Number.isSafeInteger(request.sharedPaymentCents) && request.sharedPaymentCents > 0)) issues.push('请填写本订单分摊的实付金额。');
    if (!request.voucherNote?.trim()) issues.push('请在特殊情况说明注明共用账单与本订单的关系。');
  }
  const ids = new Set(files.map(file => file.expenseItemId).filter(Boolean));
  const association = file => file.expenseItemId || (ids.size === 1 ? ids.values().next().value : '');
  for (const logistics of files.filter(file => file.kind === 'supporting' && file.materialType === '物流截图')) {
    const attached = files.filter(file => file.kind === 'supporting' && association(file) === association(logistics)).map(file => file.materialType);
    if (!attached.includes('订单截图') || !attached.some(type => ['付款截图', '共用付款账单'].includes(type)))
      issues.push('有物流截图的项目请关联同一支出项目，并分别上传订单截图和付款凭证。');
  }
  for (const category of new Set((request.expenseItems || []).map(item => item.category))) {
    if (!REIMBURSEMENT_CATEGORIES.includes(category)) { issues.push('请选择有效的报销类别。'); continue; }
    for (const required of requiredReimbursementMaterials(category, request.meetingRelated)) {
      const candidates = files.filter(file => required === '发票' ? file.kind === 'invoice'
        : file.kind === 'supporting' && (file.materialType === required
          || ['订单截图', '付款截图'].includes(required) && file.materialType === '订单和付款截图'
          || required === '付款截图' && file.materialType === '共用付款账单'));
      const acceptable = candidates.some(file => {
        const name = file.originalName || file.file?.name || file.name || '';
        if (['发票', '行程单'].includes(required)) return /\.pdf$/i.test(name);
        // Order and payment evidence may be delivered as .docx: the server extracts the pictures so
        // reviewers see the same content. Legacy .doc stays out because its pictures cannot be read.
        if (['订单截图', '付款截图'].includes(required)) return /\.(pdf|png|jpe?g|docx)$/i.test(name);
        if (['快递起终点截图', '高铁二等座价格证明'].includes(required)) return /\.(pdf|png|jpe?g)$/i.test(name);
        return true;
      });
      if (!acceptable) issues.push(`${category}：请补充${required}${['发票', '行程单'].includes(required) ? ' PDF 原件'
        : ['订单截图', '付款截图'].includes(required) ? '（图片、PDF 或 Word）'
        : ['快递起终点截图', '高铁二等座价格证明'].includes(required) ? '（图片或 PDF）' : ''}。`);
    }
  }
  return [...new Set(issues)];
}
