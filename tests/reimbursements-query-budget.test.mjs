import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { checksum, emptyDocument } from '../lib/reimbursements/material-codec.js';
import { readFinanceMatches } from '../lib/reimbursements/table-query.js';
import { findReimbursementReviewer } from '../lib/reimbursements/reviewer-source.js';

const final = { id: 'synthetic-final', financePermissions: ['final', 'view'] };
const event = { id: 'synthetic-event', name: '合成活动', date: '2026-10-20', campus: '苏州' };
function seedHistory(f, count) {
  let previous = '';
  for (let index = 1; index <= count; index++) {
    const change = { format: 1, storedBytes: 0, changes: [{ map: 'activities', key: event.id, value: { ...event, revision: index } }] };
    const bytes = Buffer.from(JSON.stringify(change)), content = bytes.toString('base64'), key = checksum(content);
    f.rows.get(f.tables.chunks).push({ _id: `chunk-${index}`, 块ID: key, 摘要: key, 内容: content });
    const row = { _id: `journal-${index}`, 事务ID: randomUUID(), 序号: index, 前序摘要: previous,
      内容: JSON.stringify({ format: 1, hash: checksum(bytes), chunks: [key] }) };
    row.摘要 = checksum(JSON.stringify([row.事务ID, row.序号, row.前序摘要, row.内容])); previous = row.摘要;
    f.rows.get(f.tables.journal).push(row);
  }
}

test('hundreds of history records replay once; repeated reads fetch only the head, with no old chunks or mirrors', async () => {
  const f = reimbursementTableFixture(); seedHistory(f, 215);
  const store = f.makeStore(), snapshot = await store.load();
  assert.equal(snapshot.version, 215);
  assert.equal(new Map(snapshot.document.maps.activities).get(event.id).revision, 215);
  const coldReads = f.queries.length; f.queries.length = 0;
  for (let i = 0; i < 40; i++) assert.equal((await store.load()).version, 215);
  assert.equal(f.queries.length, 40);
  assert.ok(f.queries.every(query => query.table === f.tables.journal && query.limit === 2 && query.returned === 2));
  assert.ok(f.queries.every(query => /WHERE/.test(query.sql) && !/SELECT \*/.test(query.sql)));
  f.queries.length = 0;
  for (let i = 0; i < 40; i++) await store.load({ fresh: false });
  assert.equal(f.queries.length, 0);
  assert.ok(coldReads < 10); // Three journal pages and bounded, referenced chunk batches.
});

test('new commits read only the delta and their affected platform IDs, unrelated legacy rows are never downloaded', async () => {
  const f = reimbursementTableFixture(), service = f.makeService();
  for (let i = 0; i < 12000; i++) f.rows.get(f.tables.requests).push({ _id: `legacy-${i}`, 姓名: '合成历史', 报销金额: 999 });
  await service.summaries.saveActivity(final, event);
  f.queries.length = 0;
  await service.summaries.saveActivity(final, { ...event, revision: 1, name: '合成活动改名' });
  assert.ok(f.queries.filter(query => query.table === f.tables.chunks).every(query => query.returned <= 1));
  assert.ok(f.queries.every(query => query.table !== f.tables.requests && query.table !== f.tables.summaries));
  const before = f.queries.length;
  await Promise.all(Array.from({ length: 6 }, () => service.summaries.listActivities(final)));
  assert.equal(f.queries.length, before);
});

test('display cache cannot authorize stale writes or conceal another writer from a forced refresh', async () => {
  const f = reimbursementTableFixture(), first = f.makeStore();
  const original = await first.load();
  const next = emptyDocument(); next.maps.activities = [[event.id, event]];
  await f.makeStore().commit(next, original);
  assert.equal((await first.load({ fresh: false })).version, 0);
  await assert.rejects(first.commit(original.document, original), { statusCode: 409 });
  assert.equal((await first.load()).version, 1);
});

test('editing one managed request queries only that platform ID even beside thousands of legacy rows', async () => {
  const f = reimbursementTableFixture();
  for (let i = 0; i < 12000; i++) f.rows.get(f.tables.requests).push({ _id: `legacy-${i}`, 姓名: '合成历史' });
  const store = f.makeStore(), before = await store.load(), document = emptyDocument();
  document.maps.activities = [[event.id, event]];
  document.maps.requests = ['request-a', 'request-b'].map(id => [id, { id, name: '合成姓名', activityId: event.id,
    bundleId: 'missing-test-bundle', amountCents: 100, status: 'pending', history: [], expenseItems: [] }]);
  await store.commit(document, before);
  const previous = await store.load(), changed = structuredClone(previous.document);
  changed.maps.requests[0][1].name = '合成修改'; f.queries.length = 0;
  await store.commit(changed, previous);
  const queries = f.queries.filter(query => query.table === f.tables.requests);
  assert.equal(queries.length, 2); assert.ok(queries.every(query => query.returned === 1));
  assert.ok(queries.every(query => query.sql.includes("'request-a'") && !query.sql.includes("'request-b'")));
  assert.equal(f.rows.get(f.tables.requests).length, 12002);
});

test('query failure never falls back to listRows; invalid keys and incomplete results stop processing', async () => {
  let calls = 0;
  const client = { listRows() { throw Error('must not scan'); }, query() { calls++; throw Error('synthetic query failure'); } };
  await assert.rejects(readFinanceMatches(client, '财务审核表', '平台申请ID', ['unsafe\' OR 1=1']), { code: 'reimbursement_query_key_invalid' });
  assert.equal(calls, 0);
  await assert.rejects(readFinanceMatches(client, '财务审核表', '平台申请ID', ['safe']), { code: 'reimbursement_query_unavailable' });
  const rows = []; Object.defineProperty(rows, 'readMeta', { value: { truncated: true } });
  await assert.rejects(readFinanceMatches({ query: async () => rows }, '财务审核表', '平台申请ID', ['safe']), { code: 'reimbursement_query_incomplete' });
});

test('reviewer notification lookup selects only the bound contact and excludes the account directory and credentials', async () => {
  const queries = [], row = { _id: 'synthetic-row', 账号ID: 'synthetic-li', 真实姓名: '李婉荣', 邮箱: 'li@example.invalid', 邮箱已验证: '已验证', 状态: '启用' };
  const client = { query: async sql => { queries.push(sql); return [row]; } };
  assert.equal((await findReimbursementReviewer(client, 'synthetic-li', '李婉荣')).email, 'li@example.invalid');
  assert.match(queries[0], /WHERE `账号ID` = 'synthetic-li' LIMIT 2$/);
  assert.ok(!/SELECT \*|密码|哈希/.test(queries[0]));
  row.状态 = '停用'; assert.equal(await findReimbursementReviewer(client, 'synthetic-li', '李婉荣'), null);
  assert.equal(await findReimbursementReviewer(client, "' OR 1=1", '李婉荣'), null);
  assert.equal(queries.length, 2);
});
