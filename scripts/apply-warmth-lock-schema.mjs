import { STATE_SCHEMA } from '../lib/production-schema.js';
import { Base } from 'seatable-api';

const targetName = '温暖连接操作锁表';
const definition = STATE_SCHEMA.find((item) => item.name === targetName);
if (!definition) throw new Error(`Schema definition missing: ${targetName}`);

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const expectedBaseUuid = process.env.SEATABLE_BUSINESS_BASE_UUID?.trim();
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-WARMTH-LOCK-TABLE';

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && !expectedBaseUuid) {
  throw new Error('Refusing to write without SEATABLE_BUSINESS_BASE_UUID. Set the target business Base UUID first.');
}
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

function safeSeaTableError(error) {
  const status = error?.response?.status;
  return status ? `SeaTable HTTP ${status}` : `SeaTable request failed (${error?.code || 'network_error'})`;
}

const base = new Base({ server, APIToken: token });
let metadata;
try {
  await base.auth();
  metadata = await base.getMetadata();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode: apply ? 'apply' : 'preview',
    server,
    writes: false,
    target: targetName,
    error: safeSeaTableError(error),
  }, null, 2));
  process.exit(1);
}
if (expectedBaseUuid && base.dtableUuid !== expectedBaseUuid) {
  throw new Error(`Business Base mismatch: token points to ${base.dtableUuid}, expected ${expectedBaseUuid}`);
}
const existingTable = (metadata?.tables || []).find((table) => table.name === targetName);
const exists = Boolean(existingTable);
const existingColumns = new Set((existingTable?.columns || []).map((column) => column.name));
const missingColumns = exists ? definition.columns.filter((column) => !existingColumns.has(column)) : [];

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  baseUuid: base.dtableUuid,
  expectedBaseUuid: expectedBaseUuid || null,
  writes: apply && !exists,
  target: targetName,
  columns: definition.columns,
  exists,
  missingColumns,
  requiredConfirmation,
}, null, 2));

if (exists && missingColumns.length) {
  throw new Error(`Existing table ${targetName} is missing columns: ${missingColumns.join('、')}. Refusing to continue.`);
}
if (!apply || exists) process.exit(0);

const columns = definition.columns.map((name, index) => ({
  column_name: name,
  column_type: 'text',
  anchor_column: index === 0 ? '' : definition.columns[index - 1],
}));
try {
  await base.addTable(targetName, 'zh-cn', columns);
} catch (error) {
  console.error(JSON.stringify({ ok: false, target: targetName, created: false, error: safeSeaTableError(error) }, null, 2));
  process.exit(1);
}
let verify;
try {
  verify = await base.getMetadata();
} catch (error) {
  console.error(JSON.stringify({ ok: false, target: targetName, created: false, error: safeSeaTableError(error) }, null, 2));
  process.exit(1);
}
const created = (verify?.tables || []).some((table) => table.name === targetName);
console.log(JSON.stringify({ created, target: targetName }, null, 2));
if (!created) process.exitCode = 1;
