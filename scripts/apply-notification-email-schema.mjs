// Add the member-controlled delivery address to the private identity Base.
// Usage: node --env-file=.env scripts/apply-notification-email-schema.mjs [--apply]
// Preview by default; --apply only creates the column, never writes account rows.
import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
const apply = process.argv.includes('--apply');
assertCoordinatedMaintenance({ write: apply });
const { Base } = await import('seatable-api');
const { ACCOUNT_TABLE } = await import('../lib/identity/store.js');

const COLUMN = '收信邮箱';
try {
  const server = process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn';
  const token = process.env.SEATABLE_IDENTITY_API_TOKEN;
  const expected = process.env.SEATABLE_IDENTITY_BASE_UUID;
  if (!token || !expected) throw Error('Identity Base configuration missing');
  const base = new Base({ server, APIToken: token });
  await base.auth();
  if (base.dtableUuid !== expected) throw Error('Identity Base UUID mismatch');
  const meta = await base.getMetadata();
  const table = meta.tables.find(item => item.name === ACCOUNT_TABLE);
  if (!table) throw Error(`Table missing: ${ACCOUNT_TABLE}`);
  const exists = table.columns.some(column => column.name === COLUMN);
  const anchor = table.columns.at(-1)?.key || '';
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', table: ACCOUNT_TABLE, column: COLUMN, exists, baseVerified: true, rowWrites: 0 }));
  if (!apply) process.exit(0);
  if (!exists) await base.insertColumn(ACCOUNT_TABLE, COLUMN, 'text', anchor);
  const after = await base.getMetadata();
  const verified = after.tables.find(item => item.name === ACCOUNT_TABLE)?.columns.some(column => column.name === COLUMN);
  if (!verified) throw Error('Column verification failed');
  console.log(JSON.stringify({ verified: true, rowWrites: 0 }));
} catch {
  console.error('Notification email schema operation failed; raw SDK errors suppressed');
  process.exitCode = 1;
}
