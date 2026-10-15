import test from 'node:test';
import assert from 'node:assert/strict';
import { readProfileCandidates } from '../lib/identity/profile-query.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

const studentId = '999990001';

function row(id = 'synthetic-profile') {
  return { _id: id, 学号: studentId, 姓名: '合成成员' };
}

function unavailable(error) {
  return error.statusCode === 503
    && error.code === 'profile_query_unavailable';
}

test('lookup uses a fixed table and bounded numeric identifier query', async () => {
  const rows = [row()];
  const queries = [];

  const result = await readProfileCandidates({
    async query(sql) {
      queries.push(sql);
      return rows;
    },
  }, studentId);

  assert.deepEqual(result, rows);
  assert.deepEqual(queries, [
    "SELECT * FROM `个人主页（编辑版）` WHERE `学号` = '999990001' LIMIT 3",
  ]);
});

test('a successful complete empty query returns an empty array', async () => {
  const result = await readProfileCandidates({
    query: async () => [],
  }, studentId);

  assert.deepEqual(result, []);
});

test('distinct duplicate candidates remain visible for conflict handling', async () => {
  const rows = [row('synthetic-one'), row('synthetic-two')];

  assert.deepEqual(
    await readProfileCandidates({ query: async () => rows }, studentId),
    rows,
  );
});

test('invalid identifiers never start a query', async () => {
  let queries = 0;
  const client = {
    async query() {
      queries++;
      return [];
    },
  };

  for (const value of [
    '',
    null,
    999990001,
    '123',
    '9'.repeat(21),
    "999990001' OR 1=1",
    '999990001 ',
  ]) {
    await assert.rejects(
      readProfileCandidates(client, value),
      unavailable,
    );
  }

  assert.equal(queries, 0);
});

test('malformed or oversized query results are rejected', async () => {
  for (const rows of [
    null,
    {},
    { results: [] },
    [row('one'), row('two'), row('three'), row('four')],
  ]) {
    await assert.rejects(
      readProfileCandidates({ query: async () => rows }, studentId),
      unavailable,
    );
  }
});

test('invalid rows and mismatched student IDs are rejected', async () => {
  for (const candidate of [
    null,
    [],
    {},
    { ...row(), _id: '' },
    { ...row(), _id: '   ' },
    { ...row(), _id: 123 },
    { ...row(), 学号: '999990002' },
  ]) {
    await assert.rejects(
      readProfileCandidates({
        query: async () => [candidate],
      }, studentId),
      unavailable,
    );
  }
});

test('repeated row IDs cannot become an authoritative candidate list', async () => {
  await assert.rejects(
    readProfileCandidates({
      query: async () => [row(), row()],
    }, studentId),
    unavailable,
  );
});

test('truncated empty and nonempty results are both rejected', async () => {
  for (const rows of [[], [row()]]) {
    Object.defineProperty(rows, 'readMeta', {
      value: { truncated: true },
    });

    await assert.rejects(
      readProfileCandidates({ query: async () => rows }, studentId),
      unavailable,
    );
  }
});

test('query errors are sanitized and never returned as empty results', async () => {
  await assert.rejects(
    readProfileCandidates({
      query: async () => {
        throw new Error('synthetic-private-token');
      },
    }, studentId),
    error => {
      assert.equal(error.message.includes('synthetic-private-token'), false);
      return unavailable(error);
    },
  );
});

test('each lookup reloads the current query result', async () => {
  let queries = 0;
  const client = {
    async query() {
      queries++;
      return queries === 1 ? [] : [row()];
    },
  };

  assert.deepEqual(await readProfileCandidates(client, studentId), []);
  assert.equal((await readProfileCandidates(client, studentId)).length, 1);
  assert.equal(queries, 2);
});

test('an already cancelled request does not start a query', async () => {
  let queries = 0;
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    withRequestBudget(
      () => readProfileCandidates({
        async query() {
          queries++;
          return [];
        },
      }, studentId),
      { signal: controller.signal },
    ),
    error => error.code === 'external_request_cancelled',
  );

  assert.equal(queries, 0);
});