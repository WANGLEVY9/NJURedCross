import { objectFields, summaryFailure } from './summary-contract.js';
const keyFor = (requestId, itemId) => JSON.stringify([requestId, itemId]);
/** One exact permutation drives both the form rows and the evidence pages. */
export function arrangeSummary(rows, materials, order) {
  const keyed = new Map(rows.map(row => [keyFor(row.origins[0].requestId, row.origins[0].itemId), row]));
  if (order === undefined) order = rows.map(row => ({ requestId: row.origins[0].requestId, itemId: row.origins[0].itemId }));
  if (!Array.isArray(order) || order.length !== rows.length) throw summaryFailure('条目顺序必须完整包含本批全部支出项目。');
  const keys = order.map(entry => { objectFields(entry, ['requestId', 'itemId'], '条目顺序'); return keyFor(entry.requestId, entry.itemId); });
  if (new Set(keys).size !== keys.length || keys.some(key => !keyed.has(key))) throw summaryFailure('条目顺序包含重复或不属于本批的项目。');
  const rank = new Map(keys.map((key, index) => [key, index]));
  return { rows: keys.map(key => keyed.get(key)), itemOrder: order,
    materials: [...materials].sort((a, b) => (rank.get(keyFor(a.requestId, a.expenseItemId)) ?? rows.length)
      - (rank.get(keyFor(b.requestId, b.expenseItemId)) ?? rows.length)) };
}
