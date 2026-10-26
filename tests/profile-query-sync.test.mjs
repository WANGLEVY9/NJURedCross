import test from 'node:test';
import assert from 'node:assert/strict';
import {
  synchronizeProfile,
  PROFILE_TABLE,
  PROFILE_FIELDS,
} from '../lib/identity/volunteer-profile.js';
import {
  ACCOUNT_TABLE,
  accountFromRow,
} from '../lib/identity/store.js';

const studentId = '999990001';

function profileRow() {
  return {
    _id: 'synthetic-profile',
    学号: studentId,
    姓名: '合成成员',
  };
}

function truncated(rows) {
  Object.defineProperty(rows, 'readMeta', {
    value: { truncated: true },
  });
  return rows;
}

function fixture(initialResult) {
  let queryResult = initialResult;
  const sourceWrites = [];

  const raw = {
    _id: 'synthetic-account-row',
    账号ID: 'synthetic-account',
    登录名: `${studentId}@smail.nju.edu.cn`,
    邮箱: `${studentId}@smail.nju.edu.cn`,
    密码哈希: 'synthetic-hash',
    角色: 'member',
    真实姓名: '合成成员',
    学号: studentId,
    邮箱已验证: '已验证',
    志愿资料: JSON.stringify({
      pending: { phone: '13900000000' },
    }),
  };

  const binding = {
    _id: 'synthetic-binding',
    账号ID: raw.账号ID,
    资料导入完成: '是',
  };

  const client = {
    async listRows(table, _view, _order, _direction, start, limit) {
      const rows = table === ACCOUNT_TABLE ? [raw] : [binding];
      return structuredClone(rows.slice(start, start + limit));
    },
    async updateRow(table, id, patch) {
      const target = table === ACCOUNT_TABLE ? raw : binding;
      assert.equal(id, target._id);
      Object.assign(target, patch);
    },
  };

  const source = {
    dtableUuid: 'synthetic-profile-base',
    async getMetadata() {
      return {
        tables: [{
          name: PROFILE_TABLE,
          columns: [
            '学号',
            '姓名',
            ...Object.values(PROFILE_FIELDS),
          ].map(name => ({ name, type: 'text' })),
        }],
      };
    },
    async query() {
      return typeof queryResult === 'function'
        ? queryResult()
        : queryResult;
    },
    async appendRow(table, values) {
      assert.equal(table, PROFILE_TABLE);
      const created = { _id: 'synthetic-created-profile', ...values };
      sourceWrites.push({ kind: 'append', values });
      queryResult.push(created);
      return { _id: created._id };
    },
    async updateRow(table, id, patch) {
      assert.equal(table, PROFILE_TABLE);
      sourceWrites.push({ kind: 'update', id, patch });
      const target = queryResult.find(row => row._id === id);
      assert.ok(target);
      Object.assign(target, patch);
    },
  };

  const ctx = {
    getProfileBase: async () => source,
    config: { profileBaseUuid: source.dtableUuid },
  };

  return {
    raw,
    binding,
    sourceWrites,
    setResult(value) {
      queryResult = value;
    },
    sync() {
      return synchronizeProfile(client, ctx, accountFromRow(raw));
    },
  };
}

function assertPendingWithoutSourceWrites(f, result) {
  assert.equal(result.state, '待重试');
  assert.equal(f.binding.资料同步状态, '待重试');
  assert.equal(f.sourceWrites.length, 0);
  assert.equal(
    JSON.parse(f.raw.志愿资料).pending.phone,
    '13900000000',
  );
  assert.equal(f.binding.资料行ID, undefined);
}

test('truncated empty results cannot create a profile', async () => {
  const f = fixture(truncated([]));
  assertPendingWithoutSourceWrites(f, await f.sync());
});

test('truncated matching results cannot bind or update a profile', async () => {
  const f = fixture(truncated([profileRow()]));
  assertPendingWithoutSourceWrites(f, await f.sync());
});

test('malformed results preserve pending edits without source writes', async () => {
  for (const result of [
    null,
    {},
    [{ 学号: studentId, 姓名: '合成成员' }],
  ]) {
    const f = fixture(result);
    assertPendingWithoutSourceWrites(f, await f.sync());
  }
});

test('query failures do not expose details or create source records', async () => {
  const f = fixture(() => {
    throw new Error('synthetic-private-query-token');
  });
  const result = await f.sync();

  assertPendingWithoutSourceWrites(f, result);
  assert.equal(
    JSON.stringify(result).includes('synthetic-private-query-token'),
    false,
  );
});

test('a complete empty result can create and synchronize one profile', async () => {
  const f = fixture([]);

  assert.equal((await f.sync()).state, '已同步');
  assert.equal(f.binding.资料行ID, 'synthetic-created-profile');
  assert.equal(f.sourceWrites.filter(write => write.kind === 'append').length, 1);
  assert.equal(JSON.parse(f.raw.志愿资料).pending, undefined);

  assert.equal((await f.sync()).state, '已同步');
  assert.equal(f.sourceWrites.filter(write => write.kind === 'append').length, 1);
});

test('recovery after a truncated result resumes pending edits safely', async () => {
  const f = fixture(truncated([]));
  assertPendingWithoutSourceWrites(f, await f.sync());

  f.setResult([profileRow()]);
  assert.equal((await f.sync()).state, '已同步');

  assert.equal(f.binding.资料行ID, 'synthetic-profile');
  assert.equal(f.sourceWrites.filter(write => write.kind === 'append').length, 0);
  assert.equal(f.sourceWrites.filter(write => write.kind === 'update').length, 1);
  assert.equal(JSON.parse(f.raw.志愿资料).pending, undefined);
});