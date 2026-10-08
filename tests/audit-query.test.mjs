import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuditEvidenceQuery,
  readAuditCandidates,
} from '../lib/audit/audit-query.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

test('audit queries use a fixed table, exact ID and bounded candidate count', () => {
  assert.equal(
    buildAuditEvidenceQuery('AUD-synthetic-001'),
    "SELECT * FROM `操作审计表` WHERE `审计ID` = 'AUD-synthetic-001' ORDER BY `_id` LIMIT 2",
  );
});

test('audit queries preserve identifier case', () => {
  assert.ok(
    buildAuditEvidenceQuery('AUD-AbC_123').includes("'AUD-AbC_123'"),
  );
});

test('unsafe or legacy identifiers request the compatibility path', () => {
  for (const id of [
    "AUD-' OR 1=1",
    'AUD-"',
    'AUD-\\',
    'AUD-`',
    'AUD-\n',
    'AUD-中文',
    ' AUD-001',
    'AUD-001 ',
  ]) {
    assert.equal(buildAuditEvidenceQuery(id), null);
  }
});

test('empty, non-string and oversized identifiers do not produce queries', () => {
  for (const id of [null, undefined, 123, '', 'x'.repeat(201)]) {
    assert.equal(buildAuditEvidenceQuery(id), null);
  }
});
test('candidate queries return at most two exact-ID rows', async () => {
  const rows = [
    { _id: 'row-1', 审计ID: 'AUD-001' },
    { _id: 'row-2', 审计ID: 'AUD-001' },
  ];
  let calls = 0;

  const client = {
    query: async sql => {
      calls++;
      assert.equal(sql, buildAuditEvidenceQuery('AUD-001'));
      return rows;
    },
  };

  assert.deepEqual(await readAuditCandidates(client, 'AUD-001'), rows);
  assert.equal(calls, 1);
});

test('successful empty queries report no candidates', async () => {
  assert.deepEqual(
    await readAuditCandidates({ query: async () => [] }, 'AUD-001'),
    [],
  );
});

test('compatibility cases do not start SQL queries', async () => {
  let calls = 0;
  const client = { query: async () => { calls++; return []; } };

  assert.equal(await readAuditCandidates(client, "AUD-'legacy"), null);
  assert.equal(await readAuditCandidates({}, 'AUD-001'), null);
  assert.equal(calls, 0);
});

test('malformed or incomplete candidate results stop the query', async () => {
  const truncated = [{ _id: 'row-1', 审计ID: 'AUD-001' }];
  Object.defineProperty(truncated, 'readMeta', {
    value: { truncated: true },
  });

  for (const rows of [
    null,
    {},
    [null],
    [{ 审计ID: 'AUD-001' }],
    [{ _id: 'row-1', 审计ID: 'AUD-other' }],
    [
      { _id: 'row-1', 审计ID: 'AUD-001' },
      { _id: 'row-1', 审计ID: 'AUD-001' },
    ],
    Array.from({ length: 3 }, (_, index) => ({
      _id: `row-${index}`,
      审计ID: 'AUD-001',
    })),
    truncated,
  ]) {
    await assert.rejects(
      readAuditCandidates({ query: async () => rows }, 'AUD-001'),
      { code: 'audit_query_unavailable', statusCode: 503 },
    );
  }
});

test('query failures are sanitized instead of reported as empty results', async () => {
  await assert.rejects(
    readAuditCandidates({
      query: async () => {
        throw new Error('synthetic-private-upstream-detail');
      },
    }, 'AUD-001'),
    error => error.code === 'audit_query_unavailable'
      && error.statusCode === 503
      && !error.message.includes('synthetic-private-upstream-detail'),
  );
});

test('each lookup queries authoritative candidates again', async () => {
  let calls = 0;
  const client = {
    query: async () => {
      calls++;
      return calls === 1
        ? []
        : [{ _id: 'row-1', 审计ID: 'AUD-001' }];
    },
  };

  assert.deepEqual(await readAuditCandidates(client, 'AUD-001'), []);
  assert.equal((await readAuditCandidates(client, 'AUD-001')).length, 1);
  assert.equal(calls, 2);
});

test('audit lookup rejects results returned after cancellation', async () => {
  const controller = new AbortController();

  await assert.rejects(
    withRequestBudget(() => readAuditCandidates({
      query: async () => {
        controller.abort();
        return [{
          _id: 'synthetic-row',
          审计ID: 'AUD-synthetic-001',
        }];
      },
    }, 'AUD-synthetic-001'), { signal: controller.signal }),
    error => error.code === 'external_request_cancelled',
  );
});

test('audit lookup preserves cancellation when the query rejects', async () => {
  const controller = new AbortController();

  await assert.rejects(
    withRequestBudget(() => readAuditCandidates({
      query: async () => {
        controller.abort();
        throw new Error('synthetic transport failure');
      },
    }, 'AUD-synthetic-001'), { signal: controller.signal }),
    error => error.code === 'external_request_cancelled',
  );
});