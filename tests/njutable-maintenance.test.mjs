import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readExpiredRows, timestampOf } from '../scripts/njutable-retention.mjs';

test('NJUTable hygiene uses an explicit confirmation and a 60-day retention default', async () => {
  const source = await readFile(new URL('../scripts/njutable-maintenance.mjs', import.meta.url), 'utf8');
  assert.match(source, /const RETENTION_DAYS = 60/);
  assert.match(source, /APPLY-NJUTABLE-HYGIENE/);
  assert.match(source, /DELETE-NON-EMPTY-DEV-TABLES/);
  assert.match(source, /audit_logs_require_explicit_confirmation/);
  assert.match(source, /identity_records_require_explicit_environment_opt_in/);
  assert.match(source, /if \(!args\.apply\) \{/);
  assert.match(source, /deleteRows\(base, plan\.name, ids\)/);
  assert.match(source, /^await observer\.dependency\('background', 'run', main\)/m,
    'module evaluation must wait for maintenance before the runner releases its lock');
});

test('hygiene service and timer enable the daily bounded cleanup', async () => {
  const [service, timer] = await Promise.all([
    readFile(new URL('../ops/systemd/njuredcross-njutable-hygiene.service', import.meta.url), 'utf8'),
    readFile(new URL('../ops/systemd/njuredcross-njutable-hygiene.timer', import.meta.url), 'utf8'),
  ]);
  assert.match(service, /^ExecStart=\/usr\/bin\/node scripts\/run-coordinated-script\.mjs njutable-maintenance\.mjs --apply --confirm=APPLY-NJUTABLE-HYGIENE --include-audit$/m);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /OnCalendar=/);
});

const cutoff = Date.parse('2026-09-24T00:00:00Z');
const rule = { table: 'synthetic-log', column: 'at' };
function retentionClient(rows, changeCount = false) {
  let counts = 0;
  return {
    async query(sql) {
      if (sql.startsWith('SELECT COUNT(*)')) return [{ total: rows.length + (changeCount && counts++ ? 1 : 0) }];
      const [, limit, offset] = /LIMIT (\d+) OFFSET (\d+)$/.exec(sql);
      return rows.slice(Number(offset), Number(offset) + Number(limit));
    },
  };
}

test('retention reaches expired records behind the first 1000 recent rows', async () => {
  const rows = Array.from({ length: 1003 }, (_, index) => ({
    _id: `row-${index}`, at: index < 1000 ? '2026-11-23' : '2026-08-01',
  }));
  const result = await readExpiredRows(retentionClient(rows), rule, cutoff, 1000);
  assert.equal(result.expiredCount, 3);
  assert.equal(result.readCount, 1003);
  assert.equal(result.scanComplete, true);
  assert.deepEqual(result.expiredRowIds, ['row-1000', 'row-1001', 'row-1002']);
});

test('retention bounds deletion and reports an unfinished scan', async () => {
  const rows = Array.from({ length: 1200 }, (_, index) => ({ _id: `row-${index}`, at: '2026-08-01' }));
  const result = await readExpiredRows(retentionClient(rows), rule, cutoff, 1000);
  assert.equal(result.expiredCount, 1000);
  assert.equal(result.capped, true);
  assert.equal(result.scanComplete, false);
});

test('retention rejects incomplete pages, duplicate IDs and concurrent count changes', async () => {
  const rows = [{ _id: 'one', at: '2026-08-01' }, { _id: 'one', at: '2026-08-01' }];
  await assert.rejects(readExpiredRows(retentionClient(rows), rule, cutoff, 1000), /Invalid retention row/);
  await assert.rejects(readExpiredRows({ async query(sql) {
    return sql.startsWith('SELECT COUNT(*)') ? [{ total: 2 }] : rows.slice(0, 1);
  } }, rule, cutoff, 1000), /Incomplete read/);
  await assert.rejects(readExpiredRows(retentionClient(rows.slice(0, 1), true), rule, cutoff, 1000), /changed during scan/);
});

test('retention keeps malformed dates, boundary records and active identity records', async () => {
  const rows = [
    { _id: 'bad', at: '2026-02-30', 状态: '已过期' },
    { _id: 'boundary', at: new Date(cutoff).toISOString(), 状态: '已失效' },
    { _id: 'active', at: '2026-08-01', 状态: '有效' },
    { _id: 'expired', at: '2026-08-01', 状态: '已过期' },
  ];
  const result = await readExpiredRows(retentionClient(rows), { ...rule, expiredOnly: true }, cutoff, 1000);
  assert.deepEqual(result.expiredRowIds, ['expired']);
});

test('retention rejects missing counts and excessive scan size before reading rows', async () => {
  for (const total of [null, -1, 1.5, 100001]) {
    await assert.rejects(readExpiredRows({ async query(sql) {
      assert.ok(sql.startsWith('SELECT COUNT(*)'));
      return [{ total }];
    } }, rule, cutoff, 1000), /Incomplete count|scan limit/);
  }
});

test('timezone-free retention timestamps use Beijing time regardless of host timezone', () => {
  assert.equal(timestampOf('2026-09-24 08:00:00'), cutoff);
  assert.equal(timestampOf('2026-09-24'), cutoff - 8 * 3600000);
  assert.equal(timestampOf('2026-02-30'), null);
  assert.equal(timestampOf('September 1, 2026'), null);
});
