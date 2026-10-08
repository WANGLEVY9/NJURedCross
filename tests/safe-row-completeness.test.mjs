import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readPagedRows } from '../lib/http/paged-rows.js';

const source = (await readFile(
  new URL('../server.js', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

const start = source.indexOf('async function safeRows(');
const end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start);

const box = {
  listAllRows: (client, table, options) => (
    readPagedRows(client, table, options)
  ),
};

vm.createContext(box);
vm.runInContext(
  source.slice(start, end + 2) + '\nglobalThis.load = safeRows;',
  box,
);

function clientWithRows(count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));

  return {
    listRows: async (_table, _view, _order, _direction, offset, limit) => (
      rows.slice(offset, offset + limit)
    ),
  };
}

test('safe rows read beyond the first page without losing records', async () => {
  const result = await box.load(clientWithRows(501), 'synthetic');

  assert.equal(result.length, 501);
  assert.equal(result.readMeta.truncated, false);
});

test('safe rows accept an exactly complete capped dataset', async () => {
  const result = await box.load(clientWithRows(2), 'synthetic', 2);

  assert.equal(result.length, 2);
  assert.equal(result.readMeta.truncated, false);
});

test('safe rows reject truncation rather than return partial data', async () => {
  await assert.rejects(
    box.load(clientWithRows(3), 'synthetic', 2),
    error => (
      error.code === 'incomplete_operational_data'
      && error.statusCode === 503
    ),
  );
});

test('safe rows never convert upstream failure into an empty array', async () => {
  await assert.rejects(
    box.load({
      listRows: async () => {
        throw new Error('synthetic-private-upstream-detail');
      },
    }, 'synthetic'),
    error => (
      error.code === 'paged_read_unavailable'
      && !error.message.includes('synthetic-private')
    ),
  );
});
const stateStart = source.indexOf('function stateRows(');
const stateEnd = source.indexOf('\n}', stateStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart);

vm.runInContext(
  source.slice(stateStart, stateEnd + 2)
    + '\nglobalThis.state = stateRows;',
  box,
);

function mutationFixture(name, extra = {}) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);

  const context = {
    stateRows: client => box.state(client, 'synthetic', 2),
    readEnrollmentRows: client => box.state(client, 'synthetic', 2),
    communityEnrollmentTable: 'synthetic',
    outreachTaskTable: 'synthetic',
    toFiniteNumber: value => Number(value) || 0,
    ...extra,
  };

  vm.createContext(context);
  vm.runInContext(
    source.slice(start, end + 2)
      + `\nglobalThis.run = ${name};`,
    context,
  );

  return context.run;
}

test('state reads accept complete datasets', async () => {
  const result = await box.state(clientWithRows(2), 'synthetic', 2);

  assert.equal(result.length, 2);
  assert.equal(result.readMeta.truncated, false);
});

test('state reads reject incomplete datasets', async () => {
  await assert.rejects(
    box.state(clientWithRows(3), 'synthetic', 2),
    error => error.code === 'incomplete_operational_data',
  );
});

test('incomplete enrollment reads cannot create or update records', async () => {
  let writes = 0;
  const client = {
    ...clientWithRows(3),
    appendRow: async () => { writes++; },
    updateRow: async () => { writes++; },
  };

  await assert.rejects(
    mutationFixture('saveEnrollment')(
      client,
      'synthetic-registration',
      { 状态: '已确认' },
    ),
    error => error.code === 'incomplete_operational_data',
  );

  assert.equal(writes, 0);
});

test('incomplete publication reads cannot create or update tasks', async () => {
  let writes = 0;
  const client = {
    ...clientWithRows(3),
    appendRow: async () => { writes++; },
    updateRow: async () => { writes++; },
  };

  await assert.rejects(
    mutationFixture('saveOutreachPublication')(
      client,
      'synthetic-content',
      { taskId: 'TASK-SYNTHETIC' },
    ),
    error => error.code === 'incomplete_operational_data',
  );

  assert.equal(writes, 0);
});