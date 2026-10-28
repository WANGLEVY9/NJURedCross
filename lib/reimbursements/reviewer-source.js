import { assertRequestActive } from '../http/request-budget.js';
import { isAccountActive } from '../permissions.js';
/** Mail needs only one bound reviewer's contact, never the account directory or credentials. */
export async function findReimbursementReviewer(client, id, expectedName) {
  if (typeof expectedName !== 'string' || !expectedName.trim()) return null;
  return findContact(client, id, expectedName);
}
export async function findReimbursementApplicant(client, id) {
  return findContact(client, id);
}
async function findContact(client, id, expectedName) {
  if (!client?.query || typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(id)) return null;
  assertRequestActive();
  const rows = await client.query(`SELECT \`_id\`, \`账号ID\`, \`真实姓名\`, \`邮箱\`, \`邮箱已验证\`, \`状态\` FROM \`平台账号表\` WHERE \`账号ID\` = '${id}' LIMIT 2`);
  assertRequestActive();
  if (!Array.isArray(rows) || rows.readMeta?.truncated || rows.length !== 1) return null;
  const row = rows[0];
  return row['账号ID'] === id && (expectedName === undefined || row['真实姓名'] === expectedName) && row['邮箱已验证'] === '已验证'
    && isAccountActive({ status: row['状态'] }) && typeof row['邮箱'] === 'string' && row['邮箱'].includes('@')
    ? { id, email: row['邮箱'], emailVerified: true } : null;
}
