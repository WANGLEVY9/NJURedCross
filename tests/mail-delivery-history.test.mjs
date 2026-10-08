import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDeliveredMail } from '../lib/mail/delivery-history.js';

function client(rows) {
  return {
    listRows: async (_table, _view, _order, _direction, start, limit) =>
      rows.slice(start, start + limit),
  };
}

test('sent record beyond the first 200 rows is found', async () => {
  const rows = Array.from({ length: 230 }, () => ({
    幂等键: 'unrelated',
    状态: '已发送',
  }));
  rows.push({ 幂等键: 'target', 状态: '已发送' });

  assert.equal(await hasDeliveredMail(client(rows), 'target'), true);
});

test('complete history without a sent record returns false', async () => {
  assert.equal(await hasDeliveredMail(client([
    { 幂等键: 'target', 状态: '失败' },
  ]), 'target'), false);
});

test('a full page requires reading the next page', async () => {
  const offsets = [];
  const base = {
    listRows: async (_table, _view, _order, _direction, start) => {
      offsets.push(start);
      return start === 0 ? [{ 状态: '失败' }, { 状态: '失败' }] : [];
    },
  };

  assert.equal(await hasDeliveredMail(base, 'target', {
    pageSize: 2,
  }), false);
  assert.deepEqual(offsets, [0, 2]);
});

test('read failure cannot be treated as permission to resend', async () => {
  await assert.rejects(hasDeliveredMail({
    listRows: async () => { throw new Error('private upstream details'); },
  }, 'target'), error =>
    error.code === 'mail_history_unavailable'
    && !error.message.includes('private upstream'),
  );
});

test('truncated reads stop the decision', async () => {
  const rows = [];
  rows.readMeta = { truncated: true };

  await assert.rejects(hasDeliveredMail({
    listRows: async () => rows,
  }, 'target'), { code: 'mail_history_unavailable' });
});

test('exceeding the read limit does not authorize sending', async () => {
  await assert.rejects(hasDeliveredMail(client([
    {}, {}, {},
  ]), 'target', {
    pageSize: 2,
    maxRows: 2,
  }), { code: 'mail_history_unavailable' });
});

test('missing history client is unavailable', async () => {
  await assert.rejects(
    hasDeliveredMail(null, 'target'),
    { code: 'mail_history_unavailable' },
  );
});

test('invalid arguments are rejected', async () => {
  await assert.rejects(hasDeliveredMail(client([]), ''), TypeError);
  await assert.rejects(hasDeliveredMail(client([]), 'target', {
    pageSize: 0,
  }), TypeError);
});