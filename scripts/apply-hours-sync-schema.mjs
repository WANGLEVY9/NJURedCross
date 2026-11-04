// Add the two columns required by the confirmed 2026-11-04 hours posting spec:
//   「活动及时长汇总表」.活动ID            machine matching, display name still uses 「活动名称」
//   「个人主页（编辑版）」.志愿时长（26-27） weekly recomputed academic-year column
// Usage: node --env-file=.env scripts/apply-hours-sync-schema.mjs [--apply]
// Dry-run by default. Column creation only; never writes rows or changes existing columns.
import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
const apply = process.argv.includes('--apply');
assertCoordinatedMaintenance({ write: apply });
const { Base } = await import('seatable-api');
const { LEGACY_ACTIVITY_ID_COLUMN, ACADEMIC_YEAR_COLUMN } = await import('../lib/events/hours-academic-year.js');

const NUMBER_DATA = {
  format: 'number', precision: 2, enable_precision: false,
  enable_fill_default_value: false, enable_check_format: false,
  decimal: 'dot', thousands: 'no',
};
const PLAN = [
  { table: '活动及时长汇总表', column: LEGACY_ACTIVITY_ID_COLUMN, type: 'text', data: null },
  { table: '个人主页（编辑版）', column: ACADEMIC_YEAR_COLUMN, type: 'number', data: NUMBER_DATA },
];

try {
  const server = process.env.SEATABLE_SERVER_URL, token = process.env.SEATABLE_VOLUNTEER_API_TOKEN;
  const expected = process.env.SEATABLE_VOLUNTEER_BASE_UUID;
  if (!server || !token || !expected) throw Error('Missing volunteer Base configuration');
  const base = new Base({ server, APIToken: token });
  await base.auth();
  if (base.dtableUuid !== expected) throw Error('Volunteer Base UUID mismatch');
  const meta = await base.getMetadata();
  const plan = PLAN.map(item => {
    const table = meta.tables.find(entry => entry.name === item.table);
    if (!table) throw Error(`Table missing: ${item.table}`);
    return { ...item, exists: table.columns.some(column => column.name === item.column), anchor: table.columns.at(-1)?.key || '' };
  });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', baseVerified: true, plan: plan.map(({ data, ...rest }) => rest), rowWrites: 0 }));
  if (!apply) process.exit(0);
  for (const item of plan) {
    if (item.exists) continue;
    await base.insertColumn(item.table, item.column, item.type, item.anchor, item.data || undefined);
  }
  const after = await base.getMetadata();
  for (const item of PLAN) {
    const table = after.tables.find(entry => entry.name === item.table);
    if (!table?.columns.some(column => column.name === item.column)) throw Error(`Column verification failed: ${item.column}`);
  }
  console.log(JSON.stringify({ verified: true, rowWrites: 0 }));
} catch {
  console.error('Hours sync schema operation failed; raw SDK errors suppressed');
  process.exitCode = 1;
}
