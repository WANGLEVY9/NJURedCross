import test from 'node:test';
import assert from 'node:assert/strict';
import { findAuditEvidence } from '../lib/audit/reconciliation-read.js';

function expected() {
  return {
    审计ID: 'AUD-synthetic-001',
    时间: '2026-01-01T00:00:00.000Z',
    操作人: 'synthetic-actor',
    角色: 'platform_admin',
    动作: 'materials.synthetic',
    对象: 'synthetic-target',
    结果: 'success',
    IP: 'synthetic-address',
    备注: '{"quantity":2}',
  };
}

function fixture(rows) {
  const calls = [];
  const client = {
    async listRows(table, view, order, convert, start, limit) {
      assert.equal(table, '操作审计表');
      calls.push(start);
      return rows.slice(start, start + limit);
    },
  };
  return { client, calls };
}

test('audit evidence is found beyond the first page', async () => {
  const rows = Array.from({ length: 500 }, (_, index) => ({
    _id: `synthetic-${index}`,
    审计ID: `AUD-other-${index}`,
  }));
  rows.push({ _id: 'synthetic-target-row', ...expected() });
  const f = fixture(rows);

  assert.deepEqual(await findAuditEvidence(f.client, expected()), {
    found: true,
    matched: true,
    rowId: 'synthetic-target-row',
  });
  assert.deepEqual(f.calls, [0, 500]);
});

test('a complete read with no matching ID reports absence without writing', async () => {
  const f = fixture([]);

  assert.deepEqual(await findAuditEvidence(f.client, expected()), {
    found: false,
    matched: false,
  });
});

test('equivalent timezone representations match the same instant', async () => {
  const f = fixture([{
    _id: 'synthetic-row',
    ...expected(),
    时间: '2026-01-01T08:00:00+08:00',
  }]);

  assert.equal((await findAuditEvidence(f.client, expected())).matched, true);
});

test('different audit contents or timestamps stop reconciliation', async () => {
  for (const field of [
    '操作人', '角色', '动作', '对象', '结果', 'IP', '备注', '时间',
  ]) {
    const actual = { _id: 'synthetic-row', ...expected() };
    actual[field] = field === '时间'
      ? '2026-01-02T00:00:00.000Z'
      : 'synthetic-different';
    const f = fixture([actual]);

    await assert.rejects(
      findAuditEvidence(f.client, expected()),
      { code: 'audit_reconciliation_conflict', statusCode: 409 },
    );
  }
});

test('duplicate audit IDs stop reconciliation even when contents match', async () => {
  const f = fixture([
    { _id: 'synthetic-first', ...expected() },
    { _id: 'synthetic-second', ...expected() },
  ]);

  await assert.rejects(
    findAuditEvidence(f.client, expected()),
    { code: 'audit_reconciliation_conflict', statusCode: 409 },
  );
});

test('an incomplete read cannot confirm even a visible matching record', async () => {
  const client = {
    async listRows() {
      const rows = [{ _id: 'synthetic-row', ...expected() }];
      Object.defineProperty(rows, 'readMeta', {
        value: { truncated: true },
      });
      return rows;
    },
  };

  await assert.rejects(
    findAuditEvidence(client, expected()),
    { code: 'incomplete_operational_data', statusCode: 503 },
  );
});

test('transport failures do not reveal upstream details or report absence', async () => {
  const client = {
    async listRows() {
      throw new Error('synthetic-private-upstream-detail');
    },
  };

  await assert.rejects(
    findAuditEvidence(client, expected()),
    error => error.statusCode === 503
      && error.code === 'paged_read_unavailable'
      && !error.message.includes('synthetic-private-upstream-detail'),
  );
});

test('invalid expected records stop before reading the remote table', async () => {
  const f = fixture([]);

  for (const invalid of [
    null,
    { ...expected(), 审计ID: '' },
    { ...expected(), 时间: 'invalid' },
    { ...expected(), 备注: null },
  ]) {
    await assert.rejects(
      findAuditEvidence(f.client, invalid),
      { code: 'audit_reconciliation_unavailable', statusCode: 503 },
    );
  }
  assert.deepEqual(f.calls, []);
});