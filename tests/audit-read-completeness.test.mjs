import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const start = source.indexOf('const AUDIT_COLUMNS = [');
const end = source.indexOf('/* --- 宣传投稿表', start);
assert.ok(start >= 0 && end > start);

function fixture(rows, { fail = false } = {}) {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (fail) throw new Error('upstream unavailable');
      const limit = Number(/LIMIT (\d+)$/.exec(sql)?.[1] || 0);
      return rows.slice(0, limit);
    },
  };
  const box = {
    getBase: async () => client,
    auditTable: 'synthetic-audit',
    assertRequestActive: () => {},
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    getIdentityBase: async () => ({}),
    loadAccountsFromTable: async () => new Map([
      ['audit@smail.nju.edu.cn', { accountId: 'ACC-1', realName: '王泰杰', email: 'audit@smail.nju.edu.cn' }],
    ]),
  };
  vm.createContext(box);
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.load = readAuditSnapshot;\nglobalThis.recent = readRecentAudit;`,
    box,
  );
  return { box, calls, load: options => box.load(options), recent: limit => box.recent(limit) };
}

test('audit reads sort on the server and never read the whole table', async () => {
  const f = fixture([
    { 审计ID: 'newer', 时间: '2026-01-02T00:00:00.000Z', 动作: 'event.confirm' },
    { 审计ID: 'older', 时间: '2026-01-01T00:00:00.000Z', 动作: 'identity.login' },
  ]);
  const result = await f.load({ limit: 1 });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, 'newer');
  assert.match(f.calls[0], /ORDER BY `时间` DESC/);
  assert.match(f.calls[0], /LIMIT 4$/);
  assert.doesNotMatch(f.calls[0], /FROM `synthetic-audit` WHERE 1\s*=/);
});

test('a truncated scan is reported instead of pretending the list is empty', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    审计ID: `id-${index}`, 时间: `2026-01-${String(20 - index).padStart(2, '0')}T00:00:00.000Z`, 动作: 'event.confirm',
  }));
  const f = fixture(rows);
  const result = await f.load({ limit: 5 });
  assert.equal(result.entries.length, 5);
  assert.equal(result.hasMore, true);
});

test('an upstream failure is reported as a service error, never as an empty log', async () => {
  const f = fixture([], { fail: true });
  await assert.rejects(f.load({ limit: 5 }), { statusCode: 503 });
});

test('entries are grouped into boards and filters stay out of the SQL predicate', async () => {
  const f = fixture([
    { 审计ID: 'a', 时间: '2026-01-02T00:00:00.000Z', 动作: 'hours.admit', 操作人: 'u1' },
    { 审计ID: 'b', 时间: '2026-01-01T00:00:00.000Z', 动作: 'materials.approve', 操作人: 'u2' },
  ]);
  const result = await f.load({ limit: 10, board: 'hours' });
  assert.deepEqual(result.entries.map(entry => entry.id), ['a']);
  assert.equal(result.entries[0].board, 'hours');
  assert.doesNotMatch(f.calls[0], /LIKE/);
});

test('the recent audit helper still returns entries for the overview', async () => {
  const f = fixture([{ 审计ID: 'a', 时间: '2026-01-02T00:00:00.000Z', 动作: 'event.confirm' }]);
  const entries = await f.recent(8);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, 'event.confirm');
});

test('audit actors are shown by real name with the account kept for cross-checking', async () => {
  const f = fixture([{ 审计ID: 'x', 时间: '2026-01-02T00:00:00.000Z', 动作: 'event.confirm', 操作人: 'audit@smail.nju.edu.cn' }]);
  const result = await f.load({ limit: 10 });
  assert.equal(result.entries[0].actorName, '王泰杰');
  assert.equal(result.entries[0].actorEmail, 'audit@smail.nju.edu.cn');
  const anonymous = fixture([{ 审计ID: 'y', 时间: '2026-01-02T00:00:00.000Z', 动作: 'event.confirm', 操作人: 'ACC-UNKNOWN' }]);
  const second = await anonymous.load({ limit: 10 });
  assert.equal(second.entries[0].actorName, '');
});
