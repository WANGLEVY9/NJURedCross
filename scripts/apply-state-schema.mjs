import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
assertCoordinatedMaintenance({ write: process.argv.includes('--apply') });
import { STATE_SCHEMA } from '../lib/production-schema.js';
import { Base } from 'seatable-api';

/**
 * Creates the six tables that replace the former `logs/*.json` state files, so
 * that every piece of platform data lives in SeaTable instead of the server's
 * local filesystem.
 *
 * Safety model (same as apply-event-schema.mjs):
 *   · prints a plan and exits without writing unless `--apply` is passed
 *   · requires an explicit --confirm phrase
 *   · refuses to run if any target table already exists, so it can never
 *     overwrite or partially clobber a live table
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-NJU-RC-STATE-TABLES';

const definitions = STATE_SCHEMA;

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const base = new Base({ server, APIToken: token });
await base.auth();
const metadata = await base.getMetadata();
const current = new Map((metadata?.tables || []).map((table) => [table.name, table]));
const existing = definitions.filter((definition) => current.has(definition.name));
const missing = definitions.filter((definition) => !current.has(definition.name));

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  writes: apply,
  requiredConfirmation,
  planned: definitions.map((item) => ({ name: item.name, columns: item.columns.length, replaces: item.replaces })),
  existing: existing.map((item) => item.name),
  toCreate: missing.map((item) => item.name),
}, null, 2));

if (!apply) process.exit(0);
if (existing.length) {
  throw new Error(`Refusing to write because target tables already exist: ${existing.map((item) => item.name).join('、')}. Create them manually or drop the expectation of a clean run.`);
}

const created = [];
const failed = [];
for (const definition of missing) {
  const columns = definition.columns.map((name, index) => ({
    column_name: name,
    column_type: 'text',
    anchor_column: index === 0 ? '' : definition.columns[index - 1],
  }));
  try {
    await base.addTable(definition.name, 'zh-cn', columns);
    created.push(`${definition.name} (${definition.columns.length} 列)`);
    console.log(`Created table: ${definition.name}`);
  } catch (error) {
    const detail = error?.response?.data?.error_msg || error?.response?.data?.detail || error.message;
    failed.push(`${definition.name}: ${detail}`);
    console.error(`Failed to create ${definition.name}: ${detail}`);
  }
}

const verify = await base.getMetadata();
const nowPresent = new Set((verify?.tables || []).map((table) => table.name));
console.log(JSON.stringify({
  created,
  failed,
  verifiedPresent: definitions.filter((item) => nowPresent.has(item.name)).map((item) => item.name),
}, null, 2));

if (failed.length) process.exitCode = 1;
