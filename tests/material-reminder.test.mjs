import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assertCompleteRows } from '../lib/events/safety.js';

const source = (await readFile(
  new URL('../server.js', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

const start = source.indexOf('async function sendOverdueReminders()');
const end = source.indexOf('function transactionPayload(', start);
assert.ok(start >= 0 && end > start);

function fixture({
  configured = true,
  truncated = false,
  delivered = true,
} = {}) {
  const calls = [];
  const applications = [{
    _id: 'application-1',
    邮箱: 'student@example.test',
    拟归还日期: '2026-01-01',
    状态: '借出（物资）',
    借用物资名及数量: '模拟物资 × 1',
  }];
  if (truncated) {
    Object.defineProperty(applications, 'readMeta', {
      value: { truncated: true },
    });
  }

  const box = {
    smtpHost: configured ? 'smtp.example.test' : '',
    smtpUser: 'synthetic-user',
    smtpPassword: 'synthetic-password',
    smtpPort: 587,
    smtpSecure: false,
    reminderFrom: 'sender@example.test',
    materialsTable: 'applications',
    assertCompleteRows,
    assertRequestActive: () => {},
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
    getBase: async () => ({
      appendRow: async () => { calls.push('record'); },
    }),
    listAllRows: async (_client, table) => {
      calls.push(`read:${table}`);
      return table === 'applications' ? applications : [];
    },
    daysLate: () => 1,
    today: () => '2026-01-02',
    randomBytes: () => ({ toString: () => 'synthetic' }),
    sendMail: async message => {
      assert.equal(message.kind, 'overdue');
      assert.equal(
        message.idempotencyKey,
        'OVERDUE:application-1:2026-01-02',
      );
      calls.push('mail');
      return { ok: delivered };
    },
  };

  vm.createContext(box);
  vm.runInContext(
    source.slice(start, end)
      + ';globalThis.run = sendOverdueReminders;',
    box,
  );
  return { calls, run: () => box.run() };
}

test('unconfigured reminders do not read data or send mail', async () => {
  const f = fixture({ configured: false });
  const result = await f.run();
  assert.equal(result.skipped, true);
  assert.deepEqual(f.calls, ['budget', 'lock', 'unlock']);
});

test('reminder reads, mail and receipt write remain inside the shared lock', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.sent, 1);
  assert.deepEqual(f.calls, [
    'budget',
    'lock',
    'read:applications',
    'read:物资流水表',
    'mail',
    'record',
    'unlock',
  ]);
});

test('truncated data prevents mail and receipt writes and releases the lock', async () => {
  const f = fixture({ truncated: true });
  await assert.rejects(f.run(), {
    statusCode: 503,
    code: 'incomplete_operational_data',
  });
  assert.ok(!f.calls.includes('mail'));
  assert.ok(!f.calls.includes('record'));
  assert.equal(f.calls.at(-1), 'unlock');
});
test('failed reminder delivery does not record a sent flow', async () => {
  const { run, calls } = fixture({ delivered: false });

  const result = await run();

  assert.equal(result.sent, 0);
  assert.ok(calls.includes('mail'));
  assert.ok(!calls.includes('record'));
  assert.equal(calls.at(-1), 'unlock');
});