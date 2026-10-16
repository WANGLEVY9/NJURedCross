import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  runCoordinatedScript,
  assertCoordinatedMaintenance,
} from '../lib/maintenance/script-runner.js';

function fixture(overrides = {}) {
  const calls = [];
  const root = join(tmpdir(), 'synthetic-maintenance-project');

  const options = {
    scriptName: 'apply-state-schema.mjs',
    args: [],
    root,
    createCoordinator: async file => {
      calls.push(['coordinator', file]);
      return async task => {
        calls.push('lock');
        try {
          return await task();
        } finally {
          calls.push('unlock');
        }
      };
    },
    execute: async (url, args) => {
      calls.push(['execute', fileURLToPath(url), args]);
      return 'finished';
    },
    ...overrides,
  };

  return {
    calls,
    root,
    run: () => runCoordinatedScript(options),
  };
}

test('script runs only after acquiring the shared lock', async () => {
  const f = fixture();
  assert.equal(await f.run(), 'finished');
  assert.deepEqual(f.calls, [
    [
      'coordinator',
      join(f.root, '.write-state', 'write-lock.sqlite'),
    ],
    'lock',
    [
      'execute',
      join(f.root, 'scripts', 'apply-state-schema.mjs'),
      [],
    ],
    'unlock',
  ]);
});

test('original apply and confirmation arguments are preserved', async () => {
  const args = ['--apply', '--confirm=synthetic-confirmation'];
  const f = fixture({ args });
  await f.run();

  const executed = f.calls.find(call =>
    Array.isArray(call) && call[0] === 'execute',
  );
  assert.deepEqual(executed[2], args);
  assert.notEqual(executed[2], args);
  assert.deepEqual(args, [
    '--apply',
    '--confirm=synthetic-confirmation',
  ]);
});

test('preview does not automatically receive apply arguments', async () => {
  const f = fixture();
  await f.run();

  const executed = f.calls.find(call =>
    Array.isArray(call) && call[0] === 'execute',
  );
  assert.deepEqual(executed[2], []);
});

test('explicit state directory selects the shared lock file', async () => {
  const stateDir = join(tmpdir(), 'synthetic-shared-state');
  const f = fixture({ stateDir, isProduction: true });
  await f.run();

  assert.deepEqual(f.calls[0], [
    'coordinator',
    join(stateDir, 'write-lock.sqlite'),
  ]);
});

test('production without an explicit directory stops before execution', async () => {
  const f = fixture({ isProduction: true });
  await assert.rejects(f.run(), /PLATFORM_WRITE_STATE_DIR/);
  assert.deepEqual(f.calls, []);
});

test('unknown scripts and path traversal are rejected before locking', async () => {
  for (const scriptName of [
    'unknown.mjs',
    '../server.js',
    '/apply-state-schema.mjs',
  ]) {
    const f = fixture({ scriptName });
    await assert.rejects(f.run(), /维护脚本文件名/);
    assert.deepEqual(f.calls, []);
  }
});

test('invalid argument types stop before locking', async () => {
  const f = fixture({ args: ['--apply', 123] });
  await assert.rejects(f.run(), TypeError);
  assert.deepEqual(f.calls, []);
});

test('script failure propagates and releases the lock', async () => {
  const failure = new Error('synthetic script failure');
  const f = fixture({
    execute: async () => { throw failure; },
  });

  await assert.rejects(f.run(), error => error === failure);
  assert.equal(f.calls.at(-1), 'unlock');
});

test('lock acquisition failure never executes the script', async () => {
  let executed = false;
  const f = fixture({
    createCoordinator: async () => async () => {
      throw new Error('synthetic lock timeout');
    },
    execute: async () => { executed = true; },
  });

  await assert.rejects(f.run(), /synthetic lock timeout/);
  assert.equal(executed, false);
});
test('direct writes are refused while direct previews remain available', () => {
  assert.throws(
    () => assertCoordinatedMaintenance(),
    /run-coordinated-script/,
  );
  assert.doesNotThrow(
    () => assertCoordinatedMaintenance({ write: false }),
  );
});

test('write permission exists only inside the coordinated execution', async () => {
  const f = fixture({
    execute: async () => {
      await Promise.resolve();
      assert.doesNotThrow(() => assertCoordinatedMaintenance());
    },
  });

  await f.run();

  assert.throws(
    () => assertCoordinatedMaintenance(),
    /run-coordinated-script/,
  );
});