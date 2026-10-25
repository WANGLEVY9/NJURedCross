import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicMaterialsFixture, materialActor as actor, materialBody as body } from './helpers/public-materials.js';
import { createPublicMaterialsPortal, assertMaterialRequestAsset } from '../lib/materials/public-portal.js';
import { openPublicMaterialRequestStore } from '../lib/materials/public-request-store.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

function fixture(t, options) { const f = publicMaterialsFixture(options); t.after(() => f.store.close()); return f; }
const rejected = statusCode => error => error.statusCode === statusCode;

test('production catalog only projects inventory, including current stock and automatic vest policy', async t => {
  const f = fixture(t);
  const items = await f.portal.catalog(f.client);
  assert.equal(items[0].remaining, 8);
  assert.equal(items[1].approvalMode, 'automatic');
  assert.deepEqual(Object.keys(items[0]).sort(), ['id', 'assetCode', 'name', 'unit', 'remaining', 'location', 'approvalMode'].sort());
  assert.equal(JSON.stringify(items).includes('PRIVATE'), false);
  assert.equal(f.writes.length, 0);
  f.summaries[0].quantity = 3;
  assert.equal((await f.portal.catalog(f.client))[0].remaining, 3);
});

for (const [department, expected] of [
  ['主席团 & 指导组', true], ['综事中心主任团', true], ['生命中心主任团', true], ['博爱中心主任团', true],
  ['工作组主任团', true], ['博爱', true], ['生命', true], ['综事', true], ['苏州', true],
  ['志愿者', false], ['苏州志愿者', false], ['', false],
]) {
  test(`production qualification checks own verified profile: ${department || 'empty'}`, async t => {
    const f = fixture(t); f.profiles[0]['部门'] = department;
    const result = await f.portal.eligibility(actor);
    assert.equal(result.eligible, expected);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(f.queries[0], "SELECT * FROM `个人主页（编辑版）` WHERE `学号` = '123456789' LIMIT 3");
    assert.equal(f.writes.length, 0);
  });
}

test('duplicate profiles, incomplete data, schema mismatch and unavailable source all fail closed', async t => {
  for (const change of [
    f => f.profiles.push({ ...f.profiles[0], _id: 'another-profile' }),
    f => { f.profiles[0]['姓名'] = '另一个人'; },
    f => { f.profiles[0]['学号'] = '999999999'; },
    f => { f.profileMetadata.tables[0].columns[1].type = 'text'; },
    f => { f.profileBase.query = async () => { throw Error('PRIVATE-UPSTREAM'); }; },
  ]) {
    const f = fixture(t); change(f);
    assert.equal((await f.portal.eligibility(actor)).eligible, false);
    await assert.rejects(f.portal.request(f.client, actor, body), error => [403, 503].includes(error.statusCode));
    assert.equal(f.writes.length, 0);
  }
});

test('request binds trusted identity and actual inventory link, with no stock deduction or extra columns', async t => {
  const f = fixture(t), before = structuredClone(f.summaries);
  const result = await f.portal.request(f.client, actor, { ...body, name: '伪造姓名', studentId: '999999999',
    email: 'forged@example.test', department: '工作组主任团', items: '伪造物资', approvalMode: 'automatic' });
  assert.equal(result.request.status, '待审批');
  assert.equal(f.applications[0]['姓名'], actor.realName);
  assert.equal(f.applications[0]['邮箱'], actor.email);
  assert.equal(f.applications[0]['学号'], actor.studentId);
  assert.equal(f.applications[0]['借用物资名及数量'], '合成急救箱 × 2 箱');
  assert.deepEqual(f.applications[0]['可借用物资'].map(v => v.row_id), ['synthetic-kit']);
  assert.deepEqual(f.summaries, before);
  assert.equal(f.writes[0].table, '物资管理');
  assert.equal(f.writes[1].otherTable, '工位物资表');
  assert.deepEqual(Object.keys(f.writes[0].row).sort(), ['姓名','学号','邮箱','借用用途','借用物资名及数量','借用件数','拟借用日期','拟归还日期','状态'].sort());
});

test('vest is auto-approved but remains in stock until actual checkout', async t => {
  const f = fixture(t);
  const result = await f.portal.request(f.client, actor, { ...body, materialId: 'synthetic-vest', assetCode: 'NJU-RC-synthetic-vest' });
  assert.equal(result.request.status, '待出库');
  assert.equal(f.applications[0]['借出审批'], '审批通过');
  assert.equal(f.applications[0]['状态'], '开始');
  assert.equal(f.summaries[1].quantity, 12);
});

test('qualification and stock are checked again at submission', async t => {
  const f = fixture(t);
  assert.equal((await f.portal.eligibility(actor)).eligible, true);
  await f.portal.catalog(f.client);
  f.profiles[0]['部门'] = '志愿者';
  await assert.rejects(f.portal.request(f.client, actor, body), rejected(403));
  f.profiles[0]['部门'] = '主席团 & 指导组'; f.summaries[0].quantity = 1;
  await assert.rejects(f.portal.request(f.client, actor, body), rejected(409));
  assert.equal(f.writes.length, 0);
});

for (const invalid of [
  { materialId: '' }, { assetCode: 'NJU-RC-other' }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 },
  { quantity: true }, { quantity: '1e1' }, { consent: false }, { idempotencyKey: '' },
  { plannedBorrowDate: '2020-01-01' }, { plannedReturnDate: '2099-02-30' }, { plannedReturnDate: '2099-10-20' },
]) {
  test(`invalid borrowing writes nothing: ${JSON.stringify(invalid)}`, async t => {
    const f = fixture(t);
    await assert.rejects(f.portal.request(f.client, actor, { ...body, ...invalid }), rejected(400));
    assert.equal(f.writes.length, 0);
  });
}

test('unverified account and caller-supplied department cannot gain borrowing access', async t => {
  const f = fixture(t);
  for (const change of [{ emailVerified: false }, { studentId: "123456789' OR 1=1" }, { realName: '' }, { id: null }]) {
    await assert.rejects(f.portal.request(f.client, { ...actor, ...change }, { ...body, department: '工作组主任团' }), rejected(403));
  }
  assert.equal(f.writes.length, 0);
});

test('schema or link destination mismatch refuses to append', async t => {
  const f = fixture(t);
  f.metadata.tables[0].columns.find(c => c.type === 'link').data.other_table_id = 'other-base-table';
  await assert.rejects(f.portal.request(f.client, actor, body), rejected(503));
  assert.equal(f.writes.length, 0);
});

test('same key replays once; changing the payload conflicts; another actor cannot replay the receipt', async t => {
  const f = fixture(t);
  const original = await f.portal.request(f.client, actor, body);
  const replay = await f.portal.request(f.client, actor, body);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.request, original.request);
  assert.equal(f.applications.length, 1);
  await assert.rejects(f.portal.request(f.client, actor, { ...body, quantity: 1 }), rejected(409));
  const other = await f.portal.request(f.client, { ...actor, id: 'other-synthetic-account' }, body);
  assert.notEqual(other.request.code, original.request.code);
});

test('lost append acknowledgement does not append again, including after reopening its durable receipt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'public-material-receipt-'));
  const file = join(root, 'requests.sqlite');
  const f = publicMaterialsFixture({ file });
  let opened = f.store;
  t.after(async () => { opened.close(); await rm(root, { recursive: true, force: true }); });
  const append = f.client.appendRow;
  f.client.appendRow = async (...args) => { await append(...args); throw Error('lost response'); };
  await assert.rejects(f.portal.request(f.client, actor, body), rejected(503));
  f.store.close();
  const reopened = openPublicMaterialRequestStore(file); opened = reopened;
  const portal = createPublicMaterialsPortal({ store: reopened, getProfileBase: async () => f.profileBase,
    getInventory: async () => ({ summaries: f.summaries }) });
  await assert.rejects(portal.request(f.client, actor, body), error => error.code === 'material_request_uncertain');
  assert.equal(f.applications.length, 1);
});

test('link failure keeps known row; retry resumes its link instead of creating a second application', async t => {
  const f = fixture(t), link = f.client.updateLink;
  f.client.updateLink = async () => { throw Error('lost link'); };
  await assert.rejects(f.portal.request(f.client, actor, body), error => error.code === 'material_link_pending');
  assert.equal(f.applications.length, 1);
  f.client.updateLink = link;
  await f.portal.request(f.client, actor, body);
  assert.equal(f.applications.length, 1);
});

test('link acknowledgement alone is insufficient; exact row and link must be read back', async t => {
  const f = fixture(t);
  f.client.updateLink = async () => ({});
  await assert.rejects(f.portal.request(f.client, actor, body), error => error.code === 'material_link_pending');
  assert.equal(f.applications.length, 1);
});

test('checkout refuses missing, ambiguous or wrong inventory links rather than matching names', () => {
  for (const value of [undefined, [], ['different'], ['synthetic-kit', 'another'], '合成急救箱', [{ display_value: '合成急救箱' }]]) {
    assert.throws(() => assertMaterialRequestAsset({ 可借用物资: value }, { id: 'synthetic-kit' }), rejected(409));
  }
  assert.doesNotThrow(() => assertMaterialRequestAsset({ 可借用物资: [{ row_id: 'synthetic-kit' }] }, { id: 'synthetic-kit' }));
  assert.throws(() => assertMaterialRequestAsset({ 可借用物资: ['synthetic-kit'], 借用件数: 2 }, { id: 'synthetic-kit' }, 1), rejected(409));
  assert.doesNotThrow(() => assertMaterialRequestAsset({ 可借用物资: ['synthetic-kit'], 借用件数: 2 }, { id: 'synthetic-kit' }, 2));
});

test('concurrent retries create exactly one application', async t => {
  const f = fixture(t);
  const results = await Promise.allSettled([f.portal.request(f.client, actor, body), f.portal.request(f.client, actor, body)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.applications.length, 1);
});

test('lost link acknowledgement resumes by reading the existing link without writing it again', async t => {
  const f = fixture(t), link = f.client.updateLink;
  f.client.updateLink = async (...args) => { await link(...args); throw Error('lost acknowledgement'); };
  await assert.rejects(f.portal.request(f.client, actor, body), error => error.code === 'material_link_pending');
  f.client.updateLink = async () => { throw Error('Must not rewrite a confirmed link'); };
  assert.equal((await f.portal.request(f.client, actor, body)).request.status, '待审批');
  assert.equal(f.writes.filter(w => w.method === 'updateLink').length, 1);
});

test('retry does not overwrite a conflicting association changed outside this request', async t => {
  const f = fixture(t);
  f.client.updateLink = async () => { throw Error('link unavailable'); };
  await assert.rejects(f.portal.request(f.client, actor, body), rejected(503));
  f.applications[0]['可借用物资'] = [{ row_id: 'different-inventory' }];
  await assert.rejects(f.portal.request(f.client, actor, body), rejected(503));
  assert.equal(f.applications[0]['可借用物资'][0].row_id, 'different-inventory');
  assert.equal(f.writes.length, 1);
});

test('expiry during preflight stops all later mutations', async t => {
  const f = fixture(t), metadata = f.client.getMetadata;
  f.client.getMetadata = async () => { await new Promise(resolve => setTimeout(resolve, 25)); return metadata(); };
  await assert.rejects(withRequestBudget(() => f.portal.request(f.client, actor, body), { timeoutMs: 5 }), rejected(503));
  assert.equal(f.writes.length, 0);
});

test('invalid inventory cannot be disguised as an empty or zero-stock catalog', async t => {
  const f = fixture(t); f.summaries[0].quantity = -1;
  await assert.rejects(f.portal.catalog(f.client), rejected(503));
  assert.equal(f.writes.length, 0);
});
