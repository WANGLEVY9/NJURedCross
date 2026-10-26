import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsByValues } from '../lib/http/rows-by-values.js';

const sqlClient = ({ statuses, rows }) => {
  let call = 0;
  const queries = [];
  return {
    queries,
    query: async sql => {
      queries.push(sql);
      const status = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      if (status !== 200) {
        const error = new Error(`Request failed with status code ${status}`);
        error.response = { status };
        throw error;
      }
      return rows;
    },
  };
};

test('a throttled bounded query retries once after a short back-off', async () => {
  const client = sqlClient({ statuses: [429, 200], rows: [{ 活动ID: 'WF-1', 容量: '8' }] });
  const rows = await rowsByValues(client, '网站活动报名总表', '活动ID', ['WF-1'], ['活动ID', '容量']);
  assert.deepEqual(rows, [{ 活动ID: 'WF-1', 容量: '8' }]);
  assert.equal(client.queries.length, 2);
});

test('a twice-throttled bounded query fails instead of retrying indefinitely', async () => {
  const client = sqlClient({ statuses: [429, 429], rows: [] });
  await assert.rejects(rowsByValues(client, '网站活动报名总表', '活动ID', ['WF-1']), error => /429/.test(String(error?.message || error)));
  assert.equal(client.queries.length, 2);
});

test('non-throttled query failures are not retried', async () => {
  const client = sqlClient({ statuses: [500], rows: [] });
  await assert.rejects(rowsByValues(client, '网站活动报名总表', '活动ID', ['WF-1']), /500/);
  assert.equal(client.queries.length, 1);
});
