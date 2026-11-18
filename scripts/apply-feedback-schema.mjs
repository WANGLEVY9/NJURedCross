import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
assertCoordinatedMaintenance({ write: process.argv.includes('--apply') });
import { Base } from 'seatable-api';
import { FEEDBACK_SCHEMA } from '../lib/production-schema.js';

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-NJU-RC-FEEDBACK-TABLE';

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const base = new Base({ server, APIToken: token });
await base.auth();

async function inspect() {
  const metadata = await base.getMetadata();
  const table = metadata?.tables?.find((candidate) => candidate.name === FEEDBACK_SCHEMA.name);
  const missingColumns = table
    ? FEEDBACK_SCHEMA.columns.filter((name) => !table.columns?.some((column) => column.name === name && column.type === 'text'))
    : [];
  return { table, missingColumns };
}

const before = await inspect();
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  writes: apply,
  table: FEEDBACK_SCHEMA.name,
  exists: Boolean(before.table),
  missingColumns: before.missingColumns,
  requiredConfirmation,
}, null, 2));

if (!apply) process.exit(0);
if (before.table && before.missingColumns.length) {
  throw new Error(`Refusing to alter an existing table with mismatched columns: ${before.missingColumns.join('、')}`);
}
if (!before.table) {
  const columns = FEEDBACK_SCHEMA.columns.map((name, index) => ({
    column_name: name,
    column_type: 'text',
    anchor_column: index === 0 ? '' : FEEDBACK_SCHEMA.columns[index - 1],
  }));
  await base.addTable(FEEDBACK_SCHEMA.name, 'zh-cn', columns);
}

const after = await inspect();
if (!after.table || after.missingColumns.length) throw new Error('Feedback schema verification failed');
console.log(JSON.stringify({ verified: true, table: FEEDBACK_SCHEMA.name }, null, 2));
