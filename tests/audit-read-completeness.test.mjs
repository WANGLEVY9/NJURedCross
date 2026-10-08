import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readPagedRows } from '../lib/http/paged-rows.js';

const source = (await readFile(
  new URL('../server.js', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

const start = source.indexOf('async function readRecentAudit(');
const end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start);

function fixture(rows) {
  const client = {
    listRows: async (_table, _view, _order, _direction, offset, limit) => (
      rows.slice(offset, offset + limit)
    ),
  };

  const box = {
    getBase: async () => client,
    auditTable: 'synthetic-audit',
    stateRows: (base, table) => readPagedRows(base, table, {
      maxRows: 2,
      requireComplete: true,
    }),
    byDateDesc: field => (left, right) => (
      String(right[field] || '').localeCompare(
        String(left[field] || ''),
      )
    ),
  };

  vm.createContext(box);
  vm.runInContext(
    source.slice(start, end + 2) +
      '\nglobalThis.load = readRecentAudit;',
    box,
  );

  return { box, load: () => box.load() };
}

test('complete audit records retain descending date order', async () => {
  const f = fixture([
    {
      _id: 'older',
      时间: '2026-01-01',
      动作: 'synthetic.old',
    },
    {
      _id: 'newer',
      时间: '2026-01-02',
      动作: 'synthetic.new',
    },
  ]);

  const result = await f.load();

  assert.equal(result.length, 2);
  assert.equal(result[0].action, 'synthetic.new');
  assert.equal(result[1].action, 'synthetic.old');
});

test('truncated audit reads cannot masquerade as an empty list', async () => {
  const f = fixture([
    { _id: 'a' },
    { _id: 'b' },
    { _id: 'c' },
  ]);

  await assert.rejects(
    f.load(),
    error => error.code === 'incomplete_operational_data',
  );
});

test('audit connection failure is propagated rather than hidden', async () => {
  const f = fixture([]);
  const failure = new Error('synthetic-audit-connection-failure');

  f.box.getBase = async () => { throw failure; };

  await assert.rejects(
    f.load(),
    error => error === failure,
  );
});