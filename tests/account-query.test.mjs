import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountLookupQuery,
  readAccountCandidates,
} from '../lib/identity/account-query.js';

test('primary lookup normalizes the identifier and uses fixed fields', () => {
  const sql = buildAccountLookupQuery('  STUDENT@example.test  ');

  assert.equal(sql, [
    'SELECT * FROM `平台账号表`',
    "WHERE (lower(trim(`登录名`)) = 'student@example.test'",
    "OR lower(trim(`邮箱`)) = 'student@example.test')",
    'ORDER BY `_id`',
    'LIMIT 100 OFFSET 0',
  ].join(' '));

  assert.ok(!sql.includes('真实姓名'));
  assert.ok(!sql.includes('学号'));
});

test('sign-in lookup includes student ID and real name aliases', () => {
  const sql = buildAccountLookupQuery('模拟同学', {
    aliases: true,
  });

  for (const field of ['登录名', '邮箱', '学号', '真实姓名']) {
    assert.ok(sql.includes(`lower(trim(\`${field}\`))`));
  }

  assert.ok(sql.includes("'模拟同学'"));
});

test('lookup uses explicit bounded pagination', () => {
  const sql = buildAccountLookupQuery('student', {
    offset: 200,
  });

  assert.ok(sql.endsWith('LIMIT 100 OFFSET 200'));
});

test('special identifiers cannot be interpolated into SQL', () => {
  for (const value of [
    "o'neil",
    'a"b',
    'a\\b',
    'a`b',
    'a\nb',
    'a\u0000b',
    'x'.repeat(161),
    "' OR 1=1 --",
  ]) {
    assert.equal(buildAccountLookupQuery(value), null);
  }
});

test('empty identifiers do not produce queries', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.equal(buildAccountLookupQuery(value), null);
  }
});

test('invalid pagination and alias options are rejected', () => {
  for (const offset of [-1, 1, 150, 10_100, 0.5, NaN]) {
    assert.throws(
      () => buildAccountLookupQuery('student', { offset }),
      TypeError,
    );
  }

  assert.throws(
    () => buildAccountLookupQuery('student', { aliases: 'yes' }),
    TypeError,
  );
});
const unavailable = error => (
  error.code === 'account_query_unavailable'
  && error.statusCode === 503
);

test('candidate reads paginate filtered rows to completion', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    _id: `synthetic-${index}`,
    登录名: 'student',
  }));
  const queries = [];

  const client = {
    query: async sql => {
      queries.push(sql);
      const offset = Number(sql.match(/OFFSET (\d+)$/)[1]);
      return rows.slice(offset, offset + 100);
    },
  };

  assert.deepEqual(
    await readAccountCandidates(client, 'student', { aliases: true }),
    rows,
  );
  assert.equal(queries.length, 2);
  assert.ok(queries[0].endsWith('OFFSET 0'));
  assert.ok(queries[1].endsWith('OFFSET 100'));
  assert.ok(queries.every(sql => sql.includes('WHERE')));
});

test('successful empty candidate reads return an empty array', async () => {
  const client = { query: async () => [] };

  assert.deepEqual(
    await readAccountCandidates(client, 'missing'),
    [],
  );
});

test('compatibility cases do not start SQL queries', async () => {
  let calls = 0;
  const client = {
    query: async () => {
      calls++;
      return [];
    },
  };

  assert.equal(await readAccountCandidates(client, "o'neil"), null);
  assert.equal(await readAccountCandidates({}, 'student'), null);
  assert.equal(calls, 0);
});

test('query failures are sanitized and never reported as no account', async () => {
  const client = {
    query: async () => {
      throw new Error('synthetic-private-token-and-query');
    },
  };

  await assert.rejects(
    readAccountCandidates(client, 'student'),
    error => (
      unavailable(error)
      && !error.message.includes('synthetic-private')
    ),
  );
});

test('malformed and repeated candidate rows stop lookup', async () => {
  for (const response of [
    null,
    {},
    [null],
    [{}],
    [{ _id: '' }],
    [{ _id: 'same' }, { _id: 'same' }],
    Array.from({ length: 101 }, (_, index) => ({
      _id: `row-${index}`,
    })),
  ]) {
    await assert.rejects(
      readAccountCandidates({
        query: async () => response,
      }, 'student'),
      unavailable,
    );
  }
});

test('candidate reads reject incomplete results beyond the safety cap', async () => {
  let calls = 0;

  const client = {
    query: async sql => {
      calls++;
      const offset = Number(sql.match(/OFFSET (\d+)$/)[1]);

      return Array.from({ length: 100 }, (_, index) => ({
        _id: `row-${offset + index}`,
      }));
    },
  };

  await assert.rejects(
    readAccountCandidates(client, 'student'),
    unavailable,
  );
  assert.equal(calls, 101);
});

test('candidate reads reload authoritative data on every lookup', async () => {
  let status = '启用';
  let calls = 0;

  const client = {
    query: async () => {
      calls++;
      return [{ _id: 'synthetic-account', 状态: status }];
    },
  };

  const first = await readAccountCandidates(client, 'student');
  status = '停用';
  const second = await readAccountCandidates(client, 'student');

  assert.equal(first[0].状态, '启用');
  assert.equal(second[0].状态, '停用');
  assert.equal(calls, 2);
});