import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectMaterialState } from '../lib/materials/inspection.js';

async function fixture(t, states = []) {
  const directory = await mkdtemp(join(tmpdir(), 'material-inspection-'));
  const file = join(directory, 'receipts.sqlite');
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE material_receipts (
      operation_key TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      document TEXT NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO material_receipts VALUES (?, ?, ?)
  `);

  states.forEach((state, index) => {
    insert.run(
      `private-operation-${index}`,
      state,
      JSON.stringify({ actor: 'private-person' }),
    );
  });
  db.close();

  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file };
}

function unavailable(error) {
  return error.code === 'material_inspection_unavailable';
}

test('empty database reports zero counts', async t => {
  const { file } = await fixture(t);

  assert.deepEqual(inspectMaterialState(file), {
    mode: 'read-only',
    writes: 0,
    networkRequests: 0,
    states: {
      prepared: 0,
      flow_attempted: 0,
      flow_confirmed: 0,
      application_attempted: 0,
      completed: 0,
    },
    total: 0,
    unfinished: 0,
    plansValidated: false,
  });
});

test('summary counts every stage and excludes completed operations', async t => {
  const { file } = await fixture(t, [
    'prepared',
    'flow_attempted',
    'flow_attempted',
    'flow_confirmed',
    'application_attempted',
    'completed',
  ]);

  const result = inspectMaterialState(file);

  assert.equal(result.total, 6);
  assert.equal(result.unfinished, 5);
  assert.equal(result.states.flow_attempted, 2);
  assert.equal(result.states.completed, 1);
});

test('inspection does not change stored rows or database bytes', async t => {
  const { file } = await fixture(t, ['flow_attempted']);
  const before = await stat(file);

  inspectMaterialState(file);
  inspectMaterialState(file);

  const after = await stat(file);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(
      db.prepare('SELECT state FROM material_receipts').get().state,
      'flow_attempted',
    );
  } finally {
    db.close();
  }
});

test('summary does not expose operation keys or personal fields', async t => {
  const { file } = await fixture(t, ['prepared']);
  const output = JSON.stringify(inspectMaterialState(file));

  assert.equal(output.includes('private-operation'), false);
  assert.equal(output.includes('private-person'), false);
  assert.equal(output.includes('document'), false);
});

test('unknown states fail instead of producing misleading counts', async t => {
  const { file } = await fixture(t, ['unexpected-state']);
  assert.throws(() => inspectMaterialState(file), unavailable);
});

test('missing database is not created and errors hide its path', async t => {
  const { directory } = await fixture(t);
  const missing = join(directory, 'private-missing.sqlite');

  assert.throws(() => inspectMaterialState(missing), error => {
    assert.equal(error.message.includes(directory), false);
    return unavailable(error);
  });

  await assert.rejects(stat(missing), { code: 'ENOENT' });
});

test('missing table fails instead of reporting an empty store', async t => {
  const { directory } = await fixture(t);
  const file = join(directory, 'no-table.sqlite');
  const db = new DatabaseSync(file);
  db.close();

  assert.throws(() => inspectMaterialState(file), unavailable);
});

test('invalid file arguments are rejected', () => {
  for (const value of [undefined, null, '', '   ', 123]) {
    assert.throws(() => inspectMaterialState(value), unavailable);
  }
});