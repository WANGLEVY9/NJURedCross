/** Finance schema contract. Mutations live in the explicitly invoked schema setup. */
export const FINANCE_TABLES = Object.freeze({ journal: '平台报销事务表', chunks: '平台报销数据块',
  requests: '财务审核表', summaries: '报销记录表' });
export const REIMBURSEMENT_SCHEMA = Object.freeze([
  { name: FINANCE_TABLES.journal, columns: { '事务ID': 'text', '序号': 'number', '前序摘要': 'text', '摘要': 'text', '内容': 'long-text', '写入时间': 'date' } },
  { name: FINANCE_TABLES.chunks, columns: { '块ID': 'text', '摘要': 'text', '内容': 'long-text', '写入时间': 'date' } },
  { name: FINANCE_TABLES.requests, columns: { '平台申请ID': 'text', '平台版本': 'number', '平台状态': 'text', '平台投影摘要': 'text',
    '原件引用': 'long-text', '合并件引用': 'long-text', '活动名称': 'text', '备注': 'text', '报销条目': 'text', '报销金额': 'number',
    '姓名': 'text', '学号': 'text', '邮箱': 'text', '银行卡号': 'text', '活动时间': 'date', '初审时间': 'date', '初审人': 'text',
    '初审问题反馈': 'text', '复审时间': 'date', '复审人': 'text', '复审问题反馈': 'text', '已打款': 'checkbox', '打款时间': 'date',
    '打款人': 'text', '实际报销金额': 'number' } },
  { name: FINANCE_TABLES.summaries, columns: { '平台汇总ID': 'text', '平台投影摘要': 'text', '材料引用': 'long-text',
    '报销时间': 'date', '活动名称': 'text', '报销总金额': 'number', '活动负责人': 'text', '备注': 'text' } },
]);
export function inspectReimbursementSchema(metadata) {
  const missing = [], mismatched = [];
  for (const definition of REIMBURSEMENT_SCHEMA) {
    const table = metadata?.tables?.find(item => item.name === definition.name);
    if (!table) { missing.push({ table: definition.name, column: null }); continue; }
    for (const [name, type] of Object.entries(definition.columns)) {
      const column = table.columns?.find(item => item.name === name);
      if (!column) missing.push({ table: definition.name, column: name, type });
      else if (column.type !== type) mismatched.push({ table: definition.name, column: name, expected: type, actual: column.type });
    }
  }
  return { ready: !missing.length && !mismatched.length, missing, mismatched };
}
export function requireReimbursementSchema(metadata) {
  const result = inspectReimbursementSchema(metadata);
  if (!result.ready) throw Object.assign(new Error('报销表结构尚未完成核对，请联系管理员。'),
    { statusCode: 503, code: 'reimbursement_schema_pending' });
}
