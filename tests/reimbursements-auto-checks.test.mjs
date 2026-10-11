import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createInvoiceChecks, invoiceCheckSummary } from '../public/app/shared/invoice-checks.js';

const result = page => ({ page, buyer: { state: 'unknown' }, seal: { state: 'none' } });
async function settleUntil(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await setImmediate();
  assert.ok(predicate(), 'automatic check queue did not settle');
}

test('automatic management checks cover every uncached page in order, without duplicate work or parallel OCR', async () => {
  let release, active = 0, peak = 0;
  const gate = new Promise(resolve => { release = resolve; }), calls = [];
  const checks = createInvoiceChecks(async (id, page) => {
    active++; peak = Math.max(peak, active); calls.push([id, page]);
    await gate; active--; return { analysis: result(page) };
  });
  const bundle = { id: 'first', pageCount: 3, analyses: [result(2)] };
  checks.ensure(bundle); checks.ensure(bundle);
  checks.ensure({ id: 'second', pageCount: 2 });
  await settleUntil(() => calls.length === 1);
  checks.ensure(bundle); release();
  await settleUntil(() => checks.get('second').complete);
  assert.deepEqual(calls, [['first', 1], ['first', 3], ['second', 1], ['second', 2]]);
  assert.equal(peak, 1);
  assert.deepEqual(checks.get('first').analyses.map(item => item.page), [1, 2, 3]);
  checks.ensure(bundle); await setImmediate(); assert.equal(calls.length, 4);
  checks.dispose();
});

test('a failed page remains an explicit error and does not prevent the remaining pages from being checked', async () => {
  const checks = createInvoiceChecks(async (id, page) => {
    if (page === 2) throw new Error('OCR timeout');
    return { analysis: result(page) };
  });
  checks.ensure({ id: 'mixed', pageCount: 3 });
  await settleUntil(() => checks.get('mixed').complete);
  const state = checks.get('mixed');
  assert.deepEqual(state.analyses.map(item => item.page), [1, 3]);
  assert.deepEqual(state.errors, [{ page: 2, message: 'OCR timeout' }]);
  assert.match(invoiceCheckSummary(state), /部分未完成.*已检查 2\/3 页.*失败 1 页/);
  checks.dispose();
});

test('leaving management stops launching further pages and detaches result listeners', async () => {
  let release, notifications = 0;
  const gate = new Promise(resolve => { release = resolve; }), calls = [];
  const checks = createInvoiceChecks(async (id, page) => {
    calls.push(page); await gate; return { analysis: result(page) };
  });
  checks.subscribe(() => notifications++);
  checks.ensure({ id: 'closing', pageCount: 3 });
  await settleUntil(() => calls.length === 1);
  checks.dispose(); const before = notifications; release(); await setImmediate();
  assert.deepEqual(calls, [1]); assert.equal(notifications, before);
});

test('supporting pages are excluded from automatic invoice checks without shifting original PDF page numbers', async () => {
  const calls = [], checks = createInvoiceChecks(async (id, page) => { calls.push(page); return { analysis: result(page) }; });
  checks.ensure({ id: 'typed', pageCount: 4, sources: [{ kind: 'supporting', startPage: 1, endPage: 2 }, { kind: 'invoice', startPage: 3, endPage: 4 }] });
  await settleUntil(() => checks.get('typed').complete);
  assert.deepEqual(calls, [3, 4]); assert.equal(checks.get('typed').pageCount, 2);
  checks.ensure({ id: 'no-invoices', pageCount: 2, sources: [{ kind: 'supporting', startPage: 1, endPage: 2 }] });
  assert.match(invoiceCheckSummary(checks.get('no-invoices')), /未上传发票/);
  assert.equal(checks.get('no-invoices').complete, true); checks.dispose();
});
