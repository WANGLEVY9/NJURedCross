import test from 'node:test';
import assert from 'node:assert/strict';
import { readProfileCandidates, readProfileCandidatesByIds } from '../lib/identity/profile-query.js';
import { withRequestBudget } from '../lib/http/request-budget.js';
import { apiFailure } from '../lib/http/errors.js';

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

/**
 * 上游故障必须分得开。
 *
 * 生产现象：报名页只显示「服务暂时不可用，请稍后重试」。可这条链路上 token 过期、
 * 限流、上游崩溃、网络中断都会走到同一句话，运维只能靠猜。现在把 SeaTable 的
 * 状态码带出来交给 apiFailure 分类，同时不允许上游响应体跟着错误对象跑。
 */
const upstreamFailure = status => Object.assign(
  new Error(`Request failed with status code ${status}`),
  { code: 'ERR_BAD_REQUEST', response: { status, data: { secret: 'upstream-body' } } },
);

test('upstream auth failures surface as an unavailable data service', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      readProfileCandidates({
        query: async () => {
          throw upstreamFailure(status);
        },
      }, studentId),
      error => {
        const failure = apiFailure(error, { method: 'GET' });
        assert.equal(failure.status, 503);
        assert.equal(failure.payload.code, 'seatable_auth_failed');
        assert.equal(failure.payload.seaTableStatus, status);
        assert.equal(failure.payload.message, '数据服务连接暂时不可用，请稍后重试或联系管理员。');
        return true;
      },
    );
  }
});

test('other upstream failures keep their status instead of collapsing into 503', async () => {
  for (const status of [429, 500, 502, 504]) {
    await assert.rejects(
      readProfileCandidates({
        query: async () => {
          throw upstreamFailure(status);
        },
      }, studentId),
      error => {
        const failure = apiFailure(error, { method: 'GET' });
        assert.equal(failure.status, 502);
        assert.equal(failure.payload.seaTableStatus, status);
        assert.equal(failure.payload.message, '数据服务请求失败，请稍后重试。');
        return true;
      },
    );
  }
});

test('failures without an upstream status keep the original 503 contract', async () => {
  await assert.rejects(
    readProfileCandidates({
      query: async () => {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      },
    }, studentId),
    error => {
      const failure = apiFailure(error, { method: 'GET' });
      assert.equal(failure.status, 503);
      assert.equal(failure.payload.code, 'profile_query_unavailable');
      assert.equal(failure.payload.seaTableStatus, null);
      return true;
    },
  );
});

test('upstream response bodies never ride along with the error', async () => {
  await assert.rejects(
    readProfileCandidates({
      query: async () => {
        throw upstreamFailure(500);
      },
    }, studentId),
    error => {
      assert.deepEqual(error.response, { status: 500 });
      assert.equal(JSON.stringify(error).includes('upstream-body'), false);
      return true;
    },
  );
});

test('batch lookups classify upstream failures the same way', async () => {
  await assert.rejects(
    readProfileCandidatesByIds({
      query: async () => {
        throw upstreamFailure(401);
      },
    }, [studentId]),
    error => apiFailure(error, { method: 'GET' }).payload.code === 'seatable_auth_failed',
  );
});
