import test from 'node:test';
import assert from 'node:assert/strict';
import { configureMailer, sendMail } from '../lib/mailer.js';

const message = {
  to: 'recipient@example.test',
  subject: 'synthetic',
  text: 'synthetic',
  idempotencyKey: 'target',
};

test('mailer skips a sent record beyond its first history page', async () => {
  const rows = Array.from({ length: 230 }, () => ({
    幂等键: 'unrelated',
    状态: '已发送',
  }));
  rows.push({ 幂等键: 'target', 状态: '已发送' });

  configureMailer({
    isProduction: true,
    getClient: async () => ({
      listRows: async (_table, _view, _order, _direction, start, limit) =>
        rows.slice(start, start + limit),
    }),
  });

  try {
    const result = await sendMail(message);
    assert.equal(result.ok, true);
    assert.equal(result.transport, 'idempotent-skip');
  } finally {
    configureMailer({ isProduction: true });
  }
});

test('history read failure returns a safe failure instead of authorizing send', async () => {
  configureMailer({
    isProduction: true,
    getClient: async () => ({
      listRows: async () => { throw new Error('private upstream details'); },
    }),
  });

  try {
    const result = await sendMail(message);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'mail_history_unavailable');
    assert.ok(!JSON.stringify(result).includes('private upstream'));
  } finally {
    configureMailer({ isProduction: true });
  }
});

test('delivery client failure is not silently ignored', async () => {
  configureMailer({
    isProduction: true,
    getClient: async () => { throw new Error('private credentials'); },
  });

  try {
    const result = await sendMail(message);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'mail_history_unavailable');
    assert.ok(!JSON.stringify(result).includes('private credentials'));
  } finally {
    configureMailer({ isProduction: true });
  }
});