import test from 'node:test';
import assert from 'node:assert/strict';
import { readCommunityRows } from '../lib/community/scoped-rows.js';
import { morningRoutes } from '../lib/morning/api.js';
import { morningPlazaRoutes } from '../lib/morning/plaza.js';
import { openMorningPlazaSnapshotStore } from '../lib/morning/plaza-snapshot-store.js';

const table = '早安晚安名片表';
const noScan = () => { throw new Error('unexpected full table scan'); };

test('lookup uses the exact subtable and account predicate, never a full-table read', async () => {
  const row = { _id: 'r1', 账号ID: 'ACC-1' };
  const client = { query: async sql => {
    assert.equal(sql, "SELECT * FROM `早安晚安名片表` WHERE (`账号ID` IN ('ACC-1')) ORDER BY `_id` LIMIT 100 OFFSET 0");
    return [row];
  } };
  assert.deepEqual(await readCommunityRows(client, table, { 账号ID: 'ACC-1' }, noScan), [row]);
});

test('pagination reads beyond the first 100 and detects exact-limit overflow', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ _id: `r${i}`, 账号ID: 'ACC-1' }));
  const offsets = [];
  const client = { query: async sql => {
    const [, limit, offset] = sql.match(/LIMIT (\d+) OFFSET (\d+)$/);
    offsets.push(Number(offset));
    return rows.slice(Number(offset), Number(offset) + Number(limit));
  } };
  assert.equal((await readCommunityRows(client, table, { 账号ID: 'ACC-1' }, noScan)).length, 201);
  assert.deepEqual(offsets, [0, 100, 200]);
  await assert.rejects(readCommunityRows(client, table, { 账号ID: 'ACC-1' }, noScan, { maxRows: 200 }), { code: 'community_query_unavailable' });
  rows.pop();
  assert.equal((await readCommunityRows(client, table, { 账号ID: 'ACC-1' }, noScan, { maxRows: 200 })).length, 200);
});

test('large ID lists are batched and empty relationships do not query', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => `ACC-${i}`);
  const calls = [];
  const client = { query: async sql => {
    calls.push(sql);
    const values = [...sql.matchAll(/'(ACC-\d+)'/g)].map(match => match[1]);
    assert.ok(values.length <= 100);
    // Return one matching record per chunk, with all other conditions preserved.
    assert.match(sql, /`审核状态` IN \('已发布'\)/);
    return [{ _id: values[0], 账号ID: values[0], 审核状态: '已发布' }];
  } };
  assert.equal((await readCommunityRows(client, table, { 账号ID: ids, 审核状态: '已发布' }, noScan)).length, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(await readCommunityRows(client, table, { 账号ID: [] }, noScan), []);
  assert.equal(calls.length, 3);
});

test('malformed, duplicate, truncated and out-of-scope results fail closed', async () => {
  const row = { _id: 'r', 账号ID: 'ACC-1' };
  const truncated = Object.assign([row], { readMeta: { truncated: true } });
  for (const result of [null, [null], [{}], [row, row], truncated, [{ _id: 'other', 账号ID: 'ACC-2' }]]) {
    await assert.rejects(readCommunityRows({ query: async () => result }, table, { 账号ID: 'ACC-1' }, noScan), { statusCode: 503 });
  }
  await assert.rejects(readCommunityRows({ query: async () => { throw Error('secret upstream detail'); } }, table, { 账号ID: 'ACC-1' }, noScan), error => error.statusCode === 503 && !error.message.includes('secret'));
});

test('query identifiers are allowlisted and unusual legacy values never enter SQL', async () => {
  const client = { query: noScan };
  await assert.rejects(readCommunityRows(client, '任意表', { 账号ID: 'ACC-1' }, noScan), TypeError);
  await assert.rejects(readCommunityRows(client, table, { '账号ID OR 1=1': 'x' }, noScan), TypeError);
  for (const value of ["O'Brien", "x' OR '1'='1", 'x\\y', 'x\n', '', 'x`y']) {
    const rows = [{ _id: 'own', 账号ID: value }, { _id: 'other', 账号ID: 'another' }];
    const result = await readCommunityRows(client, table, { 账号ID: value }, async (_client, name, options) => {
      assert.equal(name, table);
      assert.equal(options.requireComplete, true);
      return rows;
    });
    assert.deepEqual(result, [rows[0]]);
  }
  await assert.rejects(readCommunityRows({}, table, { 账号ID: 'ACC-1' }, async () => Object.assign([], { readMeta: { truncated: true } })), { statusCode: 503 });
});

test('personal card and pending revision read only the current account and card', async () => {
  const queries = [];
  const client = { query: async sql => {
    queries.push(sql);
    assert.match(sql, /`账号ID` IN \('ACC-1'\)/);
    if (sql.includes('FROM `早安晚安名片表`')) return [{ _id: 'card', 名片ID: 'MNG-1', 账号ID: 'ACC-1', 审核状态: '已发布' }];
    assert.match(sql, /FROM `早安晚安名片修订表`/);
    assert.match(sql, /`名片ID` IN \('MNG-1'\)/);
    return [];
  } };
  const result = await morningRoutes({ method: 'GET' }, {}, new URL('http://test/api/morning/card'), {
    requirePortalSession: () => ({}), accountForSession: async () => ({}), actor: () => 'ACC-1',
    getBase: async () => client, listRows: noScan, assertCompleteRows() {},
    json: (_res, status, body) => ({ status, body }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.card.id, 'MNG-1');
  assert.equal(queries.length, 2);
});

test('plaza detail loads the viewer and requested card with private projection intact', async t => {
  const store = await openMorningPlazaSnapshotStore(':memory:');
  t.after(() => store.close());
  const client = { query: async sql => {
    assert.match(sql, /\(`账号ID` IN \('ACC-1'\)\) OR \(`名片ID` IN \('MNG-2'\)\)/);
    return [{ _id: 'r2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: '已发布', 真实姓名快照: 'private-name', 学号快照: 'private-id', 昵称: '公开昵称' }];
  } };
  const result = await morningPlazaRoutes({ method: 'GET' }, {}, new URL('http://test/api/morning/cards/MNG-2'), {
    requirePortalSession: () => ({}), actor: () => 'ACC-1', enforcePublicLimit() {},
    morningPlazaSnapshotStore: store,
    getBase: async () => client, listRows: noScan, assertCompleteRows() {},
    json: (_res, status, body) => ({ status, body }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.viewer.canInvite, false);
  assert.equal(JSON.stringify(result).includes('private-'), false);
});
