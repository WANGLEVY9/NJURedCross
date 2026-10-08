import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { TEST_WORKFLOW_BASE } from '../lib/events/workflow-mode.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(
  new URL('../scripts/inspect-attendance-evidence.mjs', import.meta.url),
);

function environment(overrides = {}) {
  const env = { ...process.env };

  for (const key of Object.keys(env)) {
    if (/^(SEATABLE_|PLATFORM_|WORKFLOW_|NODE_OPTIONS$)/i.test(key)) {
      delete env[key];
    }
  }

  env.NODE_ENV = 'development';
  return { ...env, ...overrides };
}

async function rejectsBeforeReading(args = [], overrides = {}) {
  await assert.rejects(
    execute(process.execPath, [script, ...args], {
      cwd: root,
      env: environment(overrides),
      timeout: 5000,
      maxBuffer: 64 * 1024,
    }),
    error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /签到照片只读核查未完成/);
      assert.match(error.stderr, /未执行写入或删除/);
      assert.equal(error.stderr.includes('synthetic-secret-token'), false);
      return true;
    },
  );
}

test('unsupported arguments cannot start evidence inspection', async () => {
  await rejectsBeforeReading(['--apply']);
});

test('production mode is rejected', async () => {
  await rejectsBeforeReading([], { NODE_ENV: 'production' });
});

test('missing configuration cannot produce a successful empty report', async () => {
  await rejectsBeforeReading();
});

test('a different Base is rejected before authentication', async () => {
  await rejectsBeforeReading([], {
    SEATABLE_SERVER_URL: 'http://127.0.0.1:9',
    SEATABLE_VOLUNTEER_API_TOKEN: 'synthetic-secret-token',
    SEATABLE_VOLUNTEER_BASE_UUID: 'synthetic-wrong-base',
    WORKFLOW_EVIDENCE_DIR: join(root, '.synthetic-evidence'),
  });
});

test('relative evidence directories are rejected', async () => {
  await rejectsBeforeReading([], {
    SEATABLE_SERVER_URL: 'http://127.0.0.1:9',
    SEATABLE_VOLUNTEER_API_TOKEN: 'synthetic-secret-token',
    SEATABLE_VOLUNTEER_BASE_UUID: TEST_WORKFLOW_BASE,
    WORKFLOW_EVIDENCE_DIR: '.synthetic-evidence',
  });
});

test('public directories are rejected before authentication', async () => {
  for (const directory of [
    join(root, 'public'),
    join(root, 'public', 'synthetic-evidence'),
  ]) {
    await rejectsBeforeReading([], {
      SEATABLE_SERVER_URL: 'http://127.0.0.1:9',
      SEATABLE_VOLUNTEER_API_TOKEN: 'synthetic-secret-token',
      SEATABLE_VOLUNTEER_BASE_UUID: TEST_WORKFLOW_BASE,
      WORKFLOW_EVIDENCE_DIR: directory,
    });
  }
});