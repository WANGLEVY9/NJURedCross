import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMailDeliveryStore } from '../lib/mail/delivery-store.js';
import { openMailRetryStore } from '../lib/mail/retry-store.js';
import { createMailIntent } from '../lib/mail/intent.js';

const script = fileURLToPath(
  new URL('../scripts/inspect-mail-state.mjs', import.meta.url),
);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mail-inspection-cli-'));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const delivery = await openMailDeliveryStore(
    join(directory, 'mail-deliveries.sqlite'),
  );
  const retry = await openMailRetryStore(
    join(directory, 'mail-retries.sqlite'),
  );

  let recordId;

  try {
    const intent = createMailIntent({
      idempotencyKey: 'CHANGE:synthetic-cli-1',
      to: 'private-student@example.test',
      subject: '模拟私有主题',
      text: '模拟私有正文',
      kind: 'security',
    }, {
      secret: 'synthetic-cli-secret-123456789012345',
    });

    const entry = delivery.create(intent);
    recordId = entry.recordId;
    delivery.transition(intent.key, 'pending', 'sending');
    delivery.transition(intent.key, 'sending', 'unknown');
  } finally {
    retry.close();
    delivery.close();
  }

  return {
    recordId,

    run(args = [], productionWithoutDirectory = false) {
      const env = {
        ...process.env,
        NODE_ENV: productionWithoutDirectory
          ? 'production'
          : 'development',
      };

      if (productionWithoutDirectory) {
        delete env.PLATFORM_WRITE_STATE_DIR;
      } else {
        env.PLATFORM_WRITE_STATE_DIR = directory;
      }

      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: directory,
        env,
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.error, undefined);
      return result;
    },
  };
}

test('CLI reports summary using the configured state directory', async t => {
  const f = await fixture(t);
  const result = f.run();

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.writes, 0);
  assert.equal(report.delivery.states.unknown, 1);
});

test('CLI finds a task by record ID without exposing content', async t => {
  const f = await fixture(t);
  const result = f.run([`--record-id=${f.recordId}`]);

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.found, true);
  assert.equal(report.delivery.state, 'unknown');
  assert.equal(report.retry, null);

  for (const privateValue of [
    'private-student@example.test',
    '模拟私有主题',
    '模拟私有正文',
    'CHANGE:synthetic-cli-1',
  ]) {
    assert.ok(!result.stdout.includes(privateValue));
  }
});

test('CLI rejects invalid and unsupported arguments', async t => {
  const f = await fixture(t);

  for (const args of [
    ['--apply'],
    ['--record-id='],
    ['--record-id=invalid'],
    [`--record-id=${f.recordId}`, '--apply'],
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes('邮件只读诊断未完成'));
  }
});

test('production CLI requires an explicit state directory', async t => {
  const f = await fixture(t);
  const result = f.run([], true);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('邮件只读诊断未完成'));
});
test('CLI lists task identifiers with explicit pagination metadata', async t => {
  const f = await fixture(t);
  const result = f.run(['--attention', '--limit=1']);

  assert.equal(result.status, 0);

  const report = JSON.parse(result.stdout);
  assert.equal(report.writes, 0);
  assert.equal(report.limit, 1);
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].recordId, f.recordId);
  assert.equal(report.items[0].state, 'unknown');
  assert.equal(report.hasMore, false);
  assert.equal(report.nextCursor, null);

  const next = f.run([
    '--attention',
    '--limit=1',
    `--after=${f.recordId}`,
  ]);

  assert.equal(next.status, 0);
  assert.deepEqual(JSON.parse(next.stdout).items, []);
});

test('CLI rejects invalid and repeated pagination parameters', async t => {
  const f = await fixture(t);

  for (const args of [
    ['--attention', '--limit=0'],
    ['--attention', '--limit=101'],
    ['--attention', '--limit=1.5'],
    ['--attention', '--limit=1', '--limit=2'],
    ['--attention', '--after='],
    ['--attention', '--after=invalid'],
    [
      '--attention',
      `--after=${f.recordId}`,
      `--after=${f.recordId}`,
    ],
    ['--attention', '--apply'],
  ]) {
    const result = f.run(args);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes('邮件只读诊断未完成'));
  }
});