import { Base } from 'seatable-api';

/**
 * Removes verification/test rows from the platform state tables.
 *
 * Since the state layer now lives in SeaTable (not in disposable local JSON
 * files), any end-to-end verification run leaves real rows behind. This script
 * cleans them up so a verification run never pollutes production data.
 *
 * Two modes:
 *   · marker mode (default) — deletes rows whose text fields contain a marker
 *     prefix (default `VERIFY-`). This is the safe, targeted mode.
 *   · purge mode (`--purge`) — empties the six state tables completely. Only
 *     for wiping a freshly-created schema during rollout; it destroys all rows.
 *
 * Safety model (same as the other schema scripts):
 *   · dry-run by default — prints what it would delete and exits without writing
 *   · requires an explicit --confirm phrase that differs per mode
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const purge = process.argv.includes('--purge');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
/** Marker prefix. Verification scripts tag their rows as `VERIFY-<stamp>`. */
const marker = process.argv.find((arg) => arg.startsWith('--marker='))?.slice('--marker='.length) || 'VERIFY-';
const requiredConfirmation = purge ? 'PURGE-NJU-RC-STATE-TABLES' : 'DELETE-NJU-RC-TEST-ROWS';

const tables = ['宣传项目表', '宣传投稿表', '宣传发布任务表', '温暖连接参加表', '温暖连接投稿表', '操作审计表'];

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const base = new Base({ server, APIToken: token });
await base.auth();

const matches = [];

for (const table of tables) {
  let rows;
  try {
    rows = await base.listRows(table);
  } catch (error) {
    console.error(`Skip ${table}: ${error?.response?.data?.error_msg || error.message}`);
    continue;
  }
  for (const row of rows) {
    if (purge) {
      matches.push({ table, rowId: row._id, field: '(purge)', value: '' });
      continue;
    }
    const hit = Object.entries(row)
      .filter(([key]) => key !== '_id')
      .find(([, value]) => typeof value === 'string' && value.includes(marker));
    if (hit) matches.push({ table, rowId: row._id, field: hit[0], value: hit[1].slice(0, 80) });
  }
}

console.log(JSON.stringify({
  mode: apply ? (purge ? 'purge-apply' : 'apply') : (purge ? 'purge-preview' : 'preview'),
  server,
  marker: purge ? null : marker,
  writes: apply,
  requiredConfirmation,
  found: matches.length,
  byTable: tables.map((name) => ({ name, rows: matches.filter((m) => m.table === name).length })),
  matches: purge ? `${matches.length} rows (contents omitted in purge mode)` : matches,
}, null, 2));

if (!apply) process.exit(0);

const deleted = [];
const failed = [];
for (const match of matches) {
  try {
    await base.deleteRow(match.table, match.rowId);
    deleted.push(`${match.table}/${match.rowId}`);
  } catch (error) {
    failed.push(`${match.table}/${match.rowId}: ${error?.response?.data?.error_msg || error.message}`);
  }
}

console.log(JSON.stringify({ deleted: deleted.length, failed }, null, 2));
