import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(
  new URL('../server.js', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

const start = source.indexOf('let repairingMailRecords = false;');
const end = source.indexOf('const identityCtx = {', start);
assert.ok(start >= 0 && end > start);

function fixture(repair, retry = async () => {}) {
  const calls = [];
  const errors = [];

  const box = {
    withRequestBudget: async task => {
      calls.push('budget');
      return task();
    },
    withSharedWriteLock: async task => {
      calls.push('lock');
      try {
        return await task();
      } finally {
        calls.push('unlock');
      }
    },
    repairMailRecords: async options => {
      assert.equal(options.limit, 5);
      calls.push('repair');
      return repair();
    },
    console: {
      error: message => errors.push(message),
    },
    retryQueuedMail: async options => {
      assert.equal(options.limit, 5);
      calls.push('retry');
      return retry();
    },
  };

  vm.createContext(box);
  vm.runInContext(
    source.slice(start, end) +
      '\nglobalThis.run = repairStoredMailRecords;',
    box,
  );

  return { run: box.run, calls, errors };
}

test('record repair uses the request budget and shared lock', async () => {
  const expected = { selected: 1, repaired: 1, pending: 0 };
  const { run, calls, errors } = fixture(async () => expected);

  assert.equal(await run(), expected);
  assert.deepEqual(calls, [
    'budget',
    'lock',
    'repair',
    'retry',
    'unlock',
  ]);
  assert.deepEqual(errors, []);
});

test('overlapping repair ticks do not start another job', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { run, calls } = fixture(() => pending);

  const first = run();

  assert.equal(await run(), undefined);
  assert.equal(calls.filter(value => value === 'repair').length, 1);

  release({ repaired: 1 });
  await first;

  assert.equal(calls.at(-1), 'unlock');
});

test('repair failure releases the lock and allows the next tick', async () => {
  let attempts = 0;
  const { run, calls, errors } = fixture(async () => {
    attempts++;
    if (attempts === 1) {
      throw new Error('synthetic-private-error');
    }
    return { repaired: 1 };
  });

  const failed = await run();
  assert.equal(failed.ok, false);
  assert.equal(calls.at(-1), 'unlock');

  const recovered = await run();
  assert.equal(recovered.repaired, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(errors, [
    'Mail background processing failed; queued jobs retained.',
  ]);
});
test('delivery worker failure releases the lock and allows another tick', async () => {
  let attempts = 0;

  const { run, calls, errors } = fixture(
    async () => ({ repaired: 0 }),
    async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('synthetic-private-delivery-detail');
      }
      return { completed: 1 };
    },
  );

  assert.equal((await run()).ok, false);
  assert.equal(calls.at(-1), 'unlock');

  assert.equal((await run()).repaired, 0);
  assert.equal(attempts, 2);
  assert.equal(calls.at(-1), 'unlock');
  assert.equal(errors.length, 1);
  assert.ok(!errors[0].includes('synthetic-private'));
});
