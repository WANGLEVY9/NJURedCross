import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  buildIdentityLookupQuery,
  readIdentityRowsByField,
} from '../lib/identity/account-query.js';
import { identityRoutes, BINDING_TABLE } from '../lib/identity/api.js';
import { ACCOUNT_TABLE, CODE_TABLE } from '../lib/identity/store.js';

function parse(sql) {
  const table = sql.match(/FROM `([^`]+)`/)[1];
  const fields = [...sql.matchAll(/lower\(trim\(`([^`]+)`\)\)/g)].map(m => m[1]);
  const key = sql.match(/= '([^']*)'/)[1];
  const offset = Number(sql.match(/OFFSET (\d+)$/)[1]);
  return { table, fields, key, offset };
}

function sqlClient(tables) {
  const calls = { queries: [], fullReads: [] };

  return {
    calls,
    async query(sql) {
      calls.queries.push(sql);
      const { table, fields, key, offset } = parse(sql);
      const rows = tables.get(table) || [];
      const matched = rows.filter(row => fields.some(field => (
        String(row[field] ?? '').trim().toLowerCase() === key
      )));
      return matched.slice(offset, offset + 100);
    },
    async appendRow(table, row) {
      const _id = randomUUID();
      tables.get(table).push({ ...row, _id });
      return { _id };
    },
    async updateRow(table, id, patch) {
      Object.assign(tables.get(table).find(row => row._id === id), patch);
    },
    async listRows(table) {
      calls.fullReads.push(table);
      throw new Error(`整表读取不应发生：${table}`);
    },
  };
}

function context(client, mail = []) {
  return {
    config: {
      registrationAvailable: true,
      privateIdentity: true,
      codeSecret: 'synthetic-secret',
      businessBaseUuid: 'synthetic-business',
      volunteerBaseUuid: 'synthetic-volunteer',
      smailDomains: ['smail.nju.edu.cn', 'nju.edu.cn'],
    },
    getBase: async () => client,
    readJson: async req => req.body,
    clientIp: () => 'synthetic-ip',
    identifier: prefix => `${prefix}-${randomUUID()}`,
    recordAudit: async () => {},
    accounts: new Map(),
    json: (_res, status, body) => ({ status, body }),
    sendMail: async message => { mail.push(message); return { ok: true }; },
    makeSession: async () => 'synthetic-token',
    getSession: () => ({ username: 'synthetic-user', role: 'member' }),
    sessionPayload: () => ({ ok: true }),
    sessionCookie: () => '',
  };
}

const register = (ctx, studentId, domain = 'smail.nju.edu.cn') => identityRoutes({
  method: 'POST',
  headers: {},
  body: { studentId, emailDomain: domain, realName: '合成测试用户', password: 'Synthetic1!' },
}, {}, new URL('https://fixture.test/api/auth/register'), ctx);

function tables(rows = []) {
  return new Map([
    [ACCOUNT_TABLE, rows],
    [BINDING_TABLE, []],
    [CODE_TABLE, []],
  ]);
}

test('unsupported identity columns and unsafe values never build SQL', () => {
  assert.throws(() => buildIdentityLookupQuery('unknown-table', '邮箱', 'a'));
  assert.throws(() => buildIdentityLookupQuery('平台账号表', '未知列', 'a'));
  assert.equal(buildIdentityLookupQuery('平台账号表', '学号', '   '), null);
  assert.equal(buildIdentityLookupQuery('平台账号表', '学号', "a'b"), null);
  assert.match(
    buildIdentityLookupQuery('邮箱验证码表', '邮箱', 'a@b.test'),
    /FROM `邮箱验证码表`[\s\S]*WHERE lower\(trim\(`邮箱`\)\) = 'a@b\.test'[\s\S]*LIMIT 100 OFFSET 0$/,
  );
});

test('targeted reads page until complete and reject malformed batches', async () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({
    _id: `synthetic-${index}`,
    邮箱: 'a@b.test',
  }));
  const client = {
    async query(sql) {
      const { offset } = parse(sql);
      return rows.slice(offset, offset + 100);
    },
  };

  assert.equal((await readIdentityRowsByField(client, CODE_TABLE, '邮箱', 'a@b.test')).length, 150);

  const broken = {
    async query() {
      const batch = [{ _id: '' }];
      return batch;
    },
  };
  await assert.rejects(() => readIdentityRowsByField(broken, CODE_TABLE, '邮箱', 'a@b.test'));

  const noSql = { async listRows() { return rows; } };
  assert.equal(await readIdentityRowsByField(noSql, CODE_TABLE, '邮箱', 'a@b.test'), null);
});

test('signup and duplicate student ids read identity tables by column', async () => {
  const source = tables([{
    _id: 'synthetic-account',
    账号ID: 'ACC-SYNTHETIC',
    登录名: '231000991@nju.edu.cn',
    邮箱: '231000991@nju.edu.cn',
    密码哈希: 'synthetic-hash',
    角色: 'member',
    真实姓名: '合成同学',
    学号: '231000991',
    状态: '启用',
    邮箱已验证: '未验证',
  }]);
  const client = sqlClient(source);
  const ctx = context(client);

  const duplicate = await register(ctx, '231000991');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'student_id_in_use');

  const created = await register(ctx, '231000992');
  assert.equal(created.status, 201);
  assert.deepEqual(client.calls.fullReads, []);
  assert.ok(client.calls.queries.some(sql => sql.includes('`学号`')));
  assert.ok(client.calls.queries.some(sql => sql.includes('邮箱验证码表')));
  assert.ok(client.calls.queries.some(sql => sql.includes('`账号ID`')));
});

test('verification still completes without a full code table read', async () => {
  const source = tables();
  const client = sqlClient(source);
  const mail = [];
  const ctx = context(client, mail);

  const signup = await register(ctx, '231000993');
  assert.equal(signup.status, 201);
  const code = mail.at(-1).text.match(/验证码是：(\d{6})/)[1];

  const verified = await identityRoutes({
    method: 'POST',
    headers: {},
    body: { email: '231000993@smail.nju.edu.cn', code, password: 'Synthetic1!' },
  }, {}, new URL('https://fixture.test/api/auth/verify-email'), ctx);

  assert.equal(verified.status, 200);
  assert.deepEqual(client.calls.fullReads, []);
});
