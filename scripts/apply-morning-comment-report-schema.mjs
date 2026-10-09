/** Add only the report columns required by the morning comment reports. */

import { Base } from 'seatable-api';
import { MORNING_COMMENT_TABLE } from '../lib/morning/shared.js';

const REPORT_COLUMNS = Object.freeze([
  '举报状态',
  '举报人账号ID',
  '举报原因',
  '举报时间',
  '处理人',
  '处理时间',
  '处理意见',
]);

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const expectedBaseUuid = process.env.SEATABLE_BUSINESS_BASE_UUID?.trim();
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'ADD-MORNING-REPORT-COLUMNS';

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
const table = (metadata?.tables || []).find((item) => item.name === MORNING_COMMENT_TABLE);
if (!table) throw new Error(`Missing required table: ${MORNING_COMMENT_TABLE}`);
const columns = new Map((table.columns || []).map((column) => [column.name, column]));
const incompatible = REPORT_COLUMNS.filter((name) => columns.has(name) && columns.get(name).type !== 'text');
if (incompatible.length) {
  throw new Error(`Report columns have incompatible types: ${incompatible.join('、')}`);
}
const missing = REPORT_COLUMNS.filter((name) => !columns.has(name));

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  baseUuid: base.dtableUuid,
  expectedBaseUuid: expectedBaseUuid || null,
  table: MORNING_COMMENT_TABLE,
  writes: apply && missing.length > 0,
  missing,
  requiredConfirmation,
  rowUpdates: 0,
}, null, 2));

if (!apply || !missing.length) process.exit(0);
for (const name of missing) {
  await base.insertColumn(MORNING_COMMENT_TABLE, name, 'text', '');
}

const verified = (await base.getMetadata())?.tables?.find((item) => item.name === MORNING_COMMENT_TABLE);
const verifiedColumns = new Set((verified?.columns || []).map((column) => column.name));
const failed = REPORT_COLUMNS.filter((name) => !verifiedColumns.has(name));
console.log(JSON.stringify({ verified: failed.length === 0, added: missing, failed }, null, 2));
if (failed.length) process.exitCode = 1;
