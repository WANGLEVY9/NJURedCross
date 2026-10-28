import { assertRequestActive } from '../http/request-budget.js';
import { REIMBURSEMENT_SCHEMA, FINANCE_TABLES } from './table-schema.js';
import { storageFailure } from './material-codec.js';
const definitions = new Map(REIMBURSEMENT_SCHEMA.map(table => [table.name, Object.keys(table.columns)]));
const literal = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(value)) throw storageFailure('reimbursement_query_key_invalid');
  return `'${value}'`;
};
/** Fixed finance tables, explicit columns and bounded server-side predicates only. */
async function query(client, table, where, order, limit) {
  const columns = definitions.get(table);
  if (!columns || !client?.query) throw storageFailure('reimbursement_query_unavailable');
  const sql = `SELECT ${['_id', ...columns].map(key => `\`${key}\``).join(', ')} FROM \`${table}\` WHERE ${where}${order ? ` ORDER BY ${order}` : ''} LIMIT ${limit}`;
  assertRequestActive();
  let rows;
  try { rows = await client.query(sql); } catch { assertRequestActive(); throw storageFailure('reimbursement_query_unavailable'); }
  assertRequestActive();
  if (!Array.isArray(rows) || rows.length > limit || rows.readMeta?.truncated || rows.some(row => !row || typeof row._id !== 'string')
    || new Set(rows.map(row => row._id)).size !== rows.length) throw storageFailure('reimbursement_query_incomplete');
  return rows;
}
export async function readFinanceMatches(client, table, field, values) {
  if (!definitions.get(table)?.includes(field) || !Array.isArray(values)) throw storageFailure('reimbursement_query_key_invalid');
  const keys = [...new Set(values)], result = [];
  for (let start = 0; start < keys.length; start += 100) {
    const batch = keys.slice(start, start + 100), limit = batch.length * 2 + 1;
    const rows = await query(client, table, `\`${field}\` IN (${batch.map(literal).join(', ')})`, '', limit);
    if (rows.length === limit || rows.some(row => !batch.includes(row[field]))) throw storageFailure('reimbursement_query_incomplete');
    result.push(...rows);
  }
  return result;
}
export async function readFinanceJournal(client, { after = 0, head = false } = {}) {
  if (!Number.isSafeInteger(after) || after < 0) throw storageFailure('reimbursement_query_key_invalid');
  const rows = await query(client, FINANCE_TABLES.journal, `\`序号\` > ${after}`, `\`序号\` ${head ? 'DESC' : 'ASC'}`, head ? 2 : 100);
  if (rows.some(row => !Number.isSafeInteger(row['序号']) || row['序号'] <= after)
    || rows.some((row, index) => index && (head ? row['序号'] > rows[index - 1]['序号'] : row['序号'] < rows[index - 1]['序号'])))
    throw storageFailure('reimbursement_journal_conflict');
  return rows;
}
