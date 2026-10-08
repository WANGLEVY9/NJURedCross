import { Base } from 'seatable-api';
import { STATE_SCHEMA } from '../lib/production-schema.js';

/**
 * Read-only preflight for the warmth/birthday SeaTable integration.
 *
 * This deliberately does not create tables, add columns or write probe rows.
 * It verifies the target Base identity, required warmth tables, required
 * columns and one-row read access before a real UUID / API token is used.
 */

const requiredTables = [
  '温暖连接参加表',
  '温暖连接投稿表',
  '温暖祝福库表',
  '温暖祝福投递表',
  '温暖祝福举报表',
  '温暖连接黑名单表',
  '温暖连接操作锁表',
];

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN?.trim();
const expectedBaseUuid = process.env.SEATABLE_BUSINESS_BASE_UUID?.trim();

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (!expectedBaseUuid) throw new Error('Missing SEATABLE_BUSINESS_BASE_UUID');

function safeSeaTableError(error) {
  const status = error?.response?.status;
  return status ? `SeaTable HTTP ${status}` : `SeaTable request failed (${error?.code || 'network_error'})`;
}

let base;
let metadata;
try {
  base = new Base({ server, APIToken: token });
  await base.auth();
  metadata = await base.getMetadata();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'read-only',
    server,
    writes: false,
    error: safeSeaTableError(error),
  }, null, 2));
  process.exit(1);
}

const baseMatches = base.dtableUuid === expectedBaseUuid;
const tablesByName = new Map((metadata?.tables || []).map((table) => [table.name, table]));

const checks = [];
for (const name of requiredTables) {
  const definition = STATE_SCHEMA.find((item) => item.name === name);
  const table = tablesByName.get(name);
  const expectedColumns = definition?.columns || [];
  const actualColumns = new Set((table?.columns || []).map((column) => column.name));
  const missingColumns = expectedColumns.filter((column) => !actualColumns.has(column));
  let sampleReadOk = false;
  let sampleReadError = null;

  if (table) {
    try {
      const sample = await base.listRows(name, '', '', false, 0, 1);
      sampleReadOk = Array.isArray(sample);
    } catch (error) {
      sampleReadError = safeSeaTableError(error);
    }
  }

  checks.push({
    name,
    schemaDeclared: Boolean(definition),
    exists: Boolean(table),
    expectedColumnCount: expectedColumns.length,
    missingColumns,
    sampleReadOk,
    sampleReadError,
  });
}

const ok = baseMatches && checks.every((item) => item.schemaDeclared && item.exists && item.missingColumns.length === 0 && item.sampleReadOk);

console.log(JSON.stringify({
  ok,
  mode: 'read-only',
  server,
  writes: false,
  baseUuid: base.dtableUuid,
  expectedBaseUuid,
  baseMatches,
  tableCount: metadata?.tables?.length || 0,
  checks,
}, null, 2));

if (!ok) process.exitCode = 1;
