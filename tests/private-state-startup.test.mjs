import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { auditReconciliationConfig } from '../lib/audit/config.js';
import { validatePrivateStateDirectory } from '../lib/http/private-state-directory.js';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

const start = source.indexOf(
  'const auditConfig = auditReconciliationConfig(process.env, publicDir);',
);
const end = source.indexOf('const base = new Base(', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);

async function fixture(t, configuredDirectory) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'private-state-startup-'));
  const publicDir = join(root, 'public');
  await mkdir(publicDir);

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const events = [];
  const open = name => async () => {
    events.push(name);
    return {};
  };

  const box = {
    root,
    publicDir,
    join,
    resolve,
    configuredWriteStateDir: configuredDirectory,
    process: {
      env: { PLATFORM_AUDIT_RECONCILIATION_ENABLED: 'false' },
    },
    sessionSecret: 'synthetic-startup-secret-at-least-32-characters',
    auditReconciliationConfig,
    validatePrivateStateDirectory: async (config, directory) => {
      await validatePrivateStateDirectory(config, directory);
      events.push('validated');
    },
    openMaterialReceiptStore: open('materials'),
    createWriteCoordinator: open('coordinator'),
    openMailDeliveryStore: open('mail-delivery'),
    openMailRetryStore: open('mail-retry'),
    openAuditReconciliationStore: open('audit'),
  };

  vm.createContext(box);
  vm.runInContext(
    `globalThis.start = async function() {
      ${block}
      return { writeStateDir, auditReconciliationStore };
    };`,
    box,
  );

  return { box, root, publicDir, events };
}

test('disabled audit still validates the default directory before opening stores', async t => {
  const f = await fixture(t);
  const result = await f.box.start();

  assert.equal(result.writeStateDir, join(f.root, '.write-state'));
  assert.equal(result.auditReconciliationStore, null);
  assert.deepEqual(f.events, [
    'validated',
    'materials',
    'coordinator',
    'mail-delivery',
    'mail-retry',
  ]);
});

test('unsafe shared directory prevents all store initialization even with audit disabled', async t => {
  const f = await fixture(t);
  f.box.configuredWriteStateDir = join(f.publicDir, 'state');

  await assert.rejects(
    f.box.start(),
    { code: 'private_state_directory_unavailable' },
  );
  assert.deepEqual(f.events, []);
});

test('an explicit private directory is validated before all shared stores', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'private-state');
  await mkdir(directory);
  f.box.configuredWriteStateDir = directory;

  const result = await f.box.start();

  assert.equal(result.writeStateDir, directory);
  assert.equal(f.events[0], 'validated');
  assert.equal(f.events.includes('audit'), false);
  assert.equal(f.events.length, 5);
});

test('the shared validator cannot silently skip a missing configuration', async t => {
  const f = await fixture(t);

  await assert.rejects(
    validatePrivateStateDirectory(null, f.publicDir),
    { code: 'private_state_directory_unavailable' },
  );
});