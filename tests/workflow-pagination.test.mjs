import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowRows } from '../lib/events/workflow.js';
import { syncBloodBooking } from '../lib/events/blood-booking.js';

function truncatedPage() {
  const rows = [{ _id: 'synthetic-row' }];
  Object.defineProperty(rows, 'readMeta', {
    value: { truncated: true },
  });
  return rows;
}

test('workflow reads include records beyond the first page', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));
  const calls = [];
  const base = {
    async listRows(table, view, order, convert, start, limit) {
      calls.push(start);
      return rows.slice(start, start + limit);
    },
  };

  const result = await workflowRows(base, 'synthetic-workflow');
  assert.equal(result.length, 501);
  assert.deepEqual(calls, [0, 500]);
  assert.equal(result.readMeta.truncated, false);
});

test('workflow reads reject upstream truncation', async () => {
  const base = { listRows: async () => truncatedPage() };

  await assert.rejects(
    workflowRows(base, 'synthetic-workflow'),
    { code: 'incomplete_operational_data', statusCode: 503 },
  );
});

test('workflow reads reject repeated row IDs across pages', async () => {
  const first = Array.from({ length: 500 }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));
  const base = {
    async listRows(table, view, order, convert, start) {
      return start === 0 ? first : [{ _id: 'synthetic-0' }];
    },
  };

  await assert.rejects(
    workflowRows(base, 'synthetic-workflow'),
    { code: 'paged_read_unavailable', statusCode: 503 },
  );
});

test('truncated booking data stops before target reads or writes', async () => {
  let targetReads = 0;
  let writes = 0;
  const base = {
    listRows: async () => truncatedPage(),
    async getRow() {
      targetReads++;
      return null;
    },
    async updateRow() {
      writes++;
    },
  };

  await assert.rejects(
    syncBloodBooking(
      base,
      'synthetic-roster',
      {},
      { 报名ID: 'synthetic-booking' },
    ),
    { code: 'incomplete_operational_data', statusCode: 503 },
  );
  assert.equal(targetReads, 0);
  assert.equal(writes, 0);
});

test('booking detects duplicate ownership beyond the first page', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));
  rows[0]['网站报名ID'] = 'synthetic-booking';
  rows[500]['网站报名ID'] = 'synthetic-booking';

  let targetReads = 0;
  let writes = 0;
  const base = {
    async listRows(table, view, order, convert, start, limit) {
      return rows.slice(start, start + limit);
    },
    async getRow() {
      targetReads++;
      return null;
    },
    async updateRow() {
      writes++;
    },
  };

  await assert.rejects(
    syncBloodBooking(
      base,
      'synthetic-roster',
      {},
      { 报名ID: 'synthetic-booking' },
    ),
    error => error.statusCode === 409
      && error.message.includes('报名对应多个岗位'),
  );
  assert.equal(targetReads, 0);
  assert.equal(writes, 0);
});