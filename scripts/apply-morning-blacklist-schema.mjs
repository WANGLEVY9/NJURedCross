/** Create the standalone morning blacklist table when it is missing. */

import { Base } from 'seatable-api';
import { MORNING_BLACKLIST_TABLE } from '../lib/morning/shared.js';
import { MORNING_SCHEMA } from '../lib/morning/schema.js';

const definition = MORNING_SCHEMA.find((item) => item.name === MORNING_BLACKLIST_TABLE);
if (!definition) throw new Error(`Schema definition missing: ${MORNING_BLACKLIST_TABLE}`);

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const expectedBaseUuid = process.env.SEATABLE_BUSINESS_BASE_UUID?.trim();
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-MORNING-BLACKLIST-TABLE';

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && !expectedBaseUuid) {
  throw new Error('Refusing to write without SEATABLE_BUSINESS_BASE_UUID. Set the target business Base UUID first.');
}
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const base = new Base({ server, APIToken: token });
await base.auth();
if (expectedBaseUuid && base.dtableUuid !== expectedBaseUuid) {
  throw new Error(`Business Base mismatch: token points to ${base.dtableUuid}, expected ${expectedBaseUuid}`);
}
const metadata = await base.getMetadata();
const existing = (metadata?.tables || []).find((table) => table.name === MORNING_BLACKLIST_TABLE);
const existingColumns = new Set((existing?.columns || []).map((column) => column.name));
const missingColumns = existing ? definition.columns.filter((column) => !existingColumns.has(column)) : [];

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  baseUuid: base.dtableUuid,
  expectedBaseUuid: expectedBaseUuid || null,
  table: MORNING_BLACKLIST_TABLE,
  writes: apply && !existing,
  exists: Boolean(existing),
  missingColumns,
  requiredConfirmation,
  rowUpdates: 0,
}, null, 2));

if (existing && missingColumns.length) {
  throw new Error(`Existing table ${MORNING_BLACKLIST_TABLE} is missing columns: ${missingColumns.join('、')}.`);
}
if (!apply || existing) process.exit(0);

const columns = definition.columns.map((name, index) => ({
  column_name: name,
  column_type: 'text',
  anchor_column: index === 0 ? '' : definition.columns[index - 1],
}));
await base.addTable(MORNING_BLACKLIST_TABLE, 'zh-cn', columns);
const verified = (await base.getMetadata())?.tables?.find((table) => table.name === MORNING_BLACKLIST_TABLE);
console.log(JSON.stringify({ created: Boolean(verified), table: MORNING_BLACKLIST_TABLE }, null, 2));
if (!verified) process.exitCode = 1;
