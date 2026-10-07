import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findAccountByLogin,
  resolveSignInAccount,
} from '../lib/identity/store.js';

function row(patch = {}) {
  return {
    _id: 'synthetic-row-1',
    登录名: 'student@example.test',
    邮箱: 'student@example.test',
    密码哈希: 'synthetic-hash',
    角色: 'member',
    真实姓名: '模拟同学',
    学号: '123456',
    状态: '启用',
    邮箱已验证: '已验证',
    ...patch,
  };
}

function sqlClient(initialRows) {
  let rows = initialRows;
  const queries = [];

  return {
    queries,
    setRows(value) { rows = value; },

    async query(sql) {
      queries.push(sql);
      const offset = Number(sql.match(/OFFSET (\d+)$/)[1]);
      return rows.slice(offset, offset + 100);
    },

    async listRows() {
      throw new Error('SQL lookup must not read the full account table');
    },
  };
}

test('primary lookup uses SQL and returns a matching account', async () => {
  const client = sqlClient([row()]);

  const account = await findAccountByLogin(
    client,
    ' STUDENT@example.test ',
  );

  assert.equal(account.username, 'student@example.test');
  assert.equal(client.queries.length, 1);
  assert.ok(!client.queries[0].includes('真实姓名'));
});

test('sign-in keeps primary identifiers ahead of aliases', async () => {
  const client = sqlClient([
    row({
      _id: 'name-match',
      登录名: 'name@example.test',
      邮箱: 'name@example.test',
      真实姓名: 'target',
    }),
    row({
      _id: 'student-match',
      登录名: 'other@example.test',
      邮箱: 'other@example.test',
      学号: 'target',
    }),
    row({
      _id: 'primary-match',
      登录名: 'target',
      邮箱: 'primary@example.test',
    }),
  ]);

  const result = await resolveSignInAccount(client, 'target');

  assert.equal(result.ambiguous, false);
  assert.equal(result.account.rowId, 'primary-match');
  assert.ok(client.queries[0].includes('真实姓名'));
});

test('student ID matches take precedence over real names', async () => {
  const client = sqlClient([
    row({
      _id: 'name-match',
      登录名: 'name@example.test',
      邮箱: 'name@example.test',
      真实姓名: 'target',
    }),
    row({
      _id: 'student-match',
      登录名: 'other@example.test',
      邮箱: 'other@example.test',
      学号: 'target',
    }),
  ]);

  const result = await resolveSignInAccount(client, 'target');

  assert.equal(result.account.rowId, 'student-match');
  assert.equal(result.ambiguous, false);
});

test('duplicate primary identifiers remain ambiguous', async () => {
  const client = sqlClient([
    row(),
    row({ _id: 'synthetic-row-2' }),
  ]);

  const result = await resolveSignInAccount(
    client,
    'student@example.test',
  );

  assert.equal(result.account, null);
  assert.equal(result.ambiguous, true);
});

test('duplicate student IDs and real names remain ambiguous', async () => {
  for (const value of ['123456', '模拟同学']) {
    const client = sqlClient([
      row(),
      row({
        _id: 'synthetic-row-2',
        登录名: 'other@example.test',
        邮箱: 'other@example.test',
      }),
    ]);

    const result = await resolveSignInAccount(client, value);

    assert.equal(result.account, null);
    assert.equal(result.ambiguous, true);
  }
});

test('invalid account rows and unrelated candidates cannot authenticate', async () => {
  const client = sqlClient([
    row({ 密码哈希: '' }),
    row({
      _id: 'unrelated-row',
      登录名: 'other@example.test',
      邮箱: 'other@example.test',
    }),
  ]);

  const result = await resolveSignInAccount(
    client,
    'student@example.test',
  );

  assert.equal(result.account, null);
  assert.equal(result.ambiguous, false);
});

test('each lookup observes fresh account status and credentials', async () => {
  const client = sqlClient([row()]);

  const first = await findAccountByLogin(
    client,
    'student@example.test',
  );

  client.setRows([row({
    状态: '停用',
    密码哈希: 'changed-synthetic-hash',
  })]);

  const second = await findAccountByLogin(
    client,
    'student@example.test',
  );

  assert.equal(first.status, '启用');
  assert.equal(second.status, '停用');
  assert.equal(second.passwordHash, 'changed-synthetic-hash');
  assert.equal(client.queries.length, 2);
});

test('SQL failure never falls back to a full table or stale account', async () => {
  let fullReads = 0;

  const client = {
    query: async () => {
      throw new Error('synthetic-private-upstream-detail');
    },
    listRows: async () => {
      fullReads++;
      return [row()];
    },
  };

  await assert.rejects(
    resolveSignInAccount(client, 'student@example.test'),
    error => (
      error.code === 'account_query_unavailable'
      && !error.message.includes('synthetic-private')
    ),
  );

  assert.equal(fullReads, 0);
});

test('unusual legacy identifiers retain the compatibility lookup', async () => {
  let queries = 0;
  let fullReads = 0;

  const client = {
    query: async () => {
      queries++;
      return [];
    },
    listRows: async () => {
      fullReads++;
      return [row({ 登录名: "O'Neil" })];
    },
  };

  const account = await findAccountByLogin(client, "o'neil");

  assert.equal(account.username, "O'Neil");
  assert.equal(queries, 0);
  assert.equal(fullReads, 1);
});

test('empty identifiers do not read any account data', async () => {
  const client = {
    query: async () => { throw new Error('Unexpected SQL'); },
    listRows: async () => { throw new Error('Unexpected full read'); },
  };

  assert.equal(await findAccountByLogin(client, ' '), null);
  assert.deepEqual(await resolveSignInAccount(client, ''), {
    account: null,
    ambiguous: false,
  });
});