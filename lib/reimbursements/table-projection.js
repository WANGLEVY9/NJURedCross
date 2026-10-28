import { checksum, storageFailure } from './material-codec.js';
import { FINANCE_TABLES } from './table-schema.js';
import { WORKFLOW_STATUSES } from './workflow.js';
import { readFinanceMatches } from './table-query.js';

const date = value => String(value || '').slice(0, 10);
function requestRow(item, lookup) {
  const activity = lookup.activities.get(item.activityId), bundle = lookup.bundles.get(item.bundleId);
  const packets = lookup.packetSets.get(`${item.id}:${item.revision}:${item.bundleId}`);
  return { '平台申请ID': item.id, '平台版本': item.stateVersion || item.revision,
    '平台状态': item.paymentStatus === 'paid' ? '已打款' : WORKFLOW_STATUSES[item.status] || '待核查',
    '活动名称': item.activityNameSnapshot || activity?.name || '', '备注': String(item.purpose || '').slice(0, 2000),
    '报销条目': (item.expenseItems || []).map(row => row.label).join('；').slice(0, 2000), '报销金额': item.amountCents / 100,
    '姓名': item.name, '学号': item.applicantStudentId || '', '邮箱': item.applicantEmail || '', '银行卡号': item.bankAccount || '',
    '活动时间': item.expenseDate || activity?.date || '', '初审时间': date(item.initialReview?.at), '初审人': item.initialReview?.actor || '',
    '初审问题反馈': item.history?.filter(row => row.action === 'initial-return').at(-1)?.note || '',
    '复审时间': date(item.finalReview?.at), '复审人': item.finalReview?.actor || '',
    '复审问题反馈': item.history?.filter(row => row.action === 'final-return').at(-1)?.note || '',
    '已打款': item.paymentStatus === 'paid', '打款时间': date(item.paymentRecord?.paidDate),
    '打款人': item.paymentRecord?.actor || '', '实际报销金额': (item.paymentRecord?.amountCents || 0) / 100,
    '原件引用': JSON.stringify(bundle?.files?.map((file, index) => ({ name: bundle.downloadNames?.[index] || file.name, material: file.bytes?.$material })) || []),
    '合并件引用': JSON.stringify({ application: bundle?.merged?.$material || null,
      groups: packets?.groups?.map(group => group.files) || [] }) };
}
function summaryRow(item) {
  return { '平台汇总ID': item.id, '活动名称': item.activity.name, '报销时间': date(item.form.fillDate),
    '报销总金额': item.totalCents / 100, '活动负责人': item.form.handlerName,
    '备注': `${item.code}${item.protocolVersion === 2 ? ` · ${item.status === 'approved' ? '终审通过' : item.status === 'returned' ? '退回初审' : '预览草稿，尚未终审'}` : ''}`
      + (item.funding?.submittedDate ? ` · 材料提交：${item.funding.submittedDate}` : '')
      + (item.funding?.receivedDate ? ` · 经费到账：${item.funding.receivedDate} / ${(item.funding.receivedCents / 100).toFixed(2)}元` : '')
      + (item.paymentProgress ? ` · 已打款${item.paymentProgress.count}项 / ${(item.paymentProgress.amountCents / 100).toFixed(2)}元 / ${item.paymentProgress.paidDate} / ${item.paymentProgress.actorName}` : ''),
    '材料引用': JSON.stringify({ form: item.formPdf?.$material, packet: item.packetPdf?.$material }) };
}
function comparable(row, keys) {
  return Object.fromEntries(keys.map(key => [key, key.endsWith('时间') ? date(row[key])
    : ['已打款'].includes(key) ? row[key] === true : typeof row[key] === 'number' ? row[key] : row[key] || '']));
}
/** Journal is authoritative; these are readable mirrors. Legacy rows are untouched.
 * An incomplete mirror never changes a review/payment decision in the journal. */
export function affectedFinancialRows(document, changes) {
  const requests = new Set(), summaries = new Set(), activities = new Set(), bundles = new Set();
  for (const change of changes) {
    if (change.map === 'requests') requests.add(change.key);
    if (change.map === 'summaries') summaries.add(change.key);
    if (change.map === 'activities') activities.add(change.key);
    if (change.map === 'bundles') bundles.add(change.key);
    if (change.map === 'packetSets' && change.value?.requestId) requests.add(change.value.requestId);
  }
  if (activities.size || bundles.size) for (const [id, request] of document.maps.requests)
    if (activities.has(request.activityId) || bundles.has(request.bundleId)) requests.add(id);
  return { requests, summaries };
}
export async function projectFinancialRows(client, document, fence, targets) {
  const lookup = Object.fromEntries(['activities', 'bundles', 'packetSets'].map(name => [name, new Map(document.maps[name])]));
  for (const [map, table, idField, project] of [
    ['requests', FINANCE_TABLES.requests, '平台申请ID', item => requestRow(item, lookup)],
    ['summaries', FINANCE_TABLES.summaries, '平台汇总ID', summaryRow],
  ]) {
    const affected = document.maps[map].filter(([id]) => targets[map].has(id));
    if (!affected.length) continue;
    const existing = await readFinanceMatches(client, table, idField, affected.map(([id]) => id));
    for (const [, item] of affected) {
      const payload = project(item), hash = checksum(JSON.stringify(comparable(payload, Object.keys(payload))));
      const matches = existing.filter(row => row[idField] === item.id);
      if (matches.length > 1) throw storageFailure('reimbursement_projection_ambiguous');
      const previous = matches[0];
      if (previous) {
        if (previous['平台投影摘要'] !== checksum(JSON.stringify(comparable(previous, Object.keys(payload))))) {
          throw storageFailure('reimbursement_projection_changed');
        }
        if (previous['平台投影摘要'] === hash) continue;
      }
      const row = { ...payload, '平台投影摘要': hash };
      await fence.save({ id: item.id, version: 0, digest: hash, projection: { table, idField } });
      try {
        if (previous) await client.updateRow(table, previous._id, row);
        else await client.appendRow(table, row, false);
      } catch { /* Confirm the same platform ID, including a lost ACK. */ }
      const confirmed = await readFinanceMatches(client, table, idField, [item.id]);
      if (confirmed.length !== 1 || confirmed[0]['平台投影摘要'] !== hash
        || checksum(JSON.stringify(comparable(confirmed[0], Object.keys(payload)))) !== hash) throw storageFailure('reimbursement_projection_pending');
      await fence.clear(item.id);
    }
  }
}
