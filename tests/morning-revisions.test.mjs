import test from 'node:test';
import assert from 'node:assert/strict';
import {
  morningRevisionRoutes,
  savePublishedCardRevision,
  toMorningRevisionView,
} from '../lib/morning/revisions.js';
import {
  MORNING_CARD_STATUS,
  MORNING_REVISION_STATUS,
  MORNING_REVISION_TABLE,
} from '../lib/morning/shared.js';

function fixture() {
  const card = {
    _id: 'card-row-1',
    名片ID: 'MNG-1',
    账号ID: 'ACC-1',
    真实姓名快照: '本地成员',
    学号快照: '999990002',
    性别快照: '女',
    院系快照: '旧学院',
    年级快照: '2023级',
    展示院系: '否',
    展示年级: '否',
    校区: '仙林',
    昵称: '旧昵称',
    兴趣标签: JSON.stringify(['摄影']),
    备注: '旧留言',
    审核状态: MORNING_CARD_STATUS.PUBLISHED,
  };
  const cards = [card];
  const revisions = [];
  let sequence = 0;
  const client = {
    async appendRow(table, row) {
      assert.equal(table, MORNING_REVISION_TABLE);
      const created = { ...row, _id: `revision-row-${++sequence}` };
      revisions.push(created);
      return { _id: created._id };
    },
    async updateRow(table, id, patch) {
      const rows = table === MORNING_REVISION_TABLE ? revisions : cards;
      const row = rows.find(item => item._id === id);
      assert.ok(row, 'updated row must exist');
      Object.assign(row, patch);
    },
  };
  const ctx = {
    getBase: async () => client,
    listRows: async (_client, table) => table === MORNING_REVISION_TABLE ? revisions : cards,
    assertCompleteRows: () => {},
    requireConsoleAccess: () => ({ username: 'reviewer' }),
    requireCsrf: () => true,
    actor: session => session.accountId || 'REVIEWER',
    readJsonObject: async req => req.body || {},
    recordAudit: () => {},
    json: (res, status, payload) => {
      res.status = status;
      res.payload = payload;
      return payload;
    },
  };
  return { card, cards, revisions, client, ctx };
}

function input(overrides = {}) {
  return {
    nickname: '新昵称',
    campus: '鼓楼',
    interestTags: ['摄影', '跑步'],
    note: '新的公开留言',
    showDepartment: true,
    showGrade: true,
    ...overrides,
  };
}

test('published card edits create a pending revision without changing the plaza card', async () => {
  const state = fixture();
  const saved = await savePublishedCardRevision({
    client: state.client,
    listRows: state.ctx.listRows,
    assertCompleteRows: state.ctx.assertCompleteRows,
    card: state.card,
    accountId: 'ACC-1',
    account: {
      realName: '本地成员',
      studentId: '999990002',
      gender: '女',
      department: '新学院',
      grade: '2024级',
    },
    input: input(),
    now: '2030-01-01T00:00:00.000Z',
  });
  assert.equal(toMorningRevisionView(saved).status, MORNING_REVISION_STATUS.PENDING);
  assert.equal(state.revisions.length, 1);
  assert.equal(state.card.昵称, '旧昵称');
  assert.equal(state.card.备注, '旧留言');
  assert.equal(state.revisions[0].昵称, '新昵称');
  assert.equal(state.revisions[0].院系快照, '新学院');
});

test('approving a revision updates the published card and preserves review evidence', async () => {
  const state = fixture();
  const saved = await savePublishedCardRevision({
    client: state.client,
    listRows: state.ctx.listRows,
    assertCompleteRows: state.ctx.assertCompleteRows,
    card: state.card,
    accountId: 'ACC-1',
    account: {
      realName: '本地成员',
      studentId: '999990002',
      gender: '女',
      department: '新学院',
      grade: '2024级',
    },
    input: input(),
    now: '2030-01-01T00:00:00.000Z',
  });
  const res = {};
  await morningRevisionRoutes(
    { method: 'POST', headers: {}, body: { decision: 'approve', note: '资料核对无误', expectedVersion: saved.版本号 } },
    res,
    new URL(`http://example.test/api/community/morning/revisions/${encodeURIComponent(saved.修订ID)}/review`),
    state.ctx,
  );
  assert.equal(res.status, 200);
  assert.equal(state.card.昵称, '新昵称');
  assert.equal(state.card.校区, '鼓楼');
  assert.equal(state.card.院系快照, '新学院');
  assert.equal(state.card.展示院系, '是');
  assert.equal(state.card.审核人, 'reviewer');
  assert.equal(state.revisions[0].审核状态, MORNING_REVISION_STATUS.APPROVED);
});

test('returning a revision keeps the current plaza card unchanged', async () => {
  const state = fixture();
  const saved = await savePublishedCardRevision({
    client: state.client,
    listRows: state.ctx.listRows,
    assertCompleteRows: state.ctx.assertCompleteRows,
    card: state.card,
    accountId: 'ACC-1',
    account: {
      realName: '本地成员',
      studentId: '999990002',
      gender: '女',
      department: '新学院',
      grade: '2024级',
    },
    input: input({ nickname: '不应上线的昵称' }),
    now: '2030-01-01T00:00:00.000Z',
  });
  const res = {};
  await morningRevisionRoutes(
    { method: 'POST', headers: {}, body: { decision: 'return', note: '请补充留言', expectedVersion: saved.版本号 } },
    res,
    new URL(`http://example.test/api/community/morning/revisions/${encodeURIComponent(saved.修订ID)}/review`),
    state.ctx,
  );
  assert.equal(res.status, 200);
  assert.equal(state.card.昵称, '旧昵称');
  assert.equal(state.card.备注, '旧留言');
  assert.equal(state.revisions[0].审核状态, MORNING_REVISION_STATUS.RETURNED);
});

test('a stale revision version cannot overwrite a newer submission', async () => {
  const state = fixture();
  const first = await savePublishedCardRevision({
    client: state.client,
    listRows: state.ctx.listRows,
    assertCompleteRows: state.ctx.assertCompleteRows,
    card: state.card,
    accountId: 'ACC-1',
    account: { realName: '本地成员', studentId: '999990002', gender: '女', department: '新学院', grade: '2024级' },
    input: input({ nickname: '版本一' }),
    now: '2030-01-01T00:00:00.000Z',
  });
  const second = await savePublishedCardRevision({
    client: state.client,
    listRows: state.ctx.listRows,
    assertCompleteRows: state.ctx.assertCompleteRows,
    card: state.card,
    accountId: 'ACC-1',
    account: { realName: '本地成员', studentId: '999990002', gender: '女', department: '新学院', grade: '2024级' },
    input: input({ nickname: '版本二' }),
    now: '2030-01-01T00:01:00.000Z',
  });
  assert.equal(first.版本号, 1);
  assert.equal(second.版本号, 2);
  const res = {};
  await morningRevisionRoutes(
    { method: 'POST', headers: {}, body: { decision: 'approve', note: '', expectedVersion: 1 } },
    res,
    new URL(`http://example.test/api/community/morning/revisions/${encodeURIComponent(second.修订ID)}/review`),
    state.ctx,
  );
  assert.equal(res.status, 409);
  assert.equal(res.payload.code, 'revision_stale');
  assert.equal(state.card.昵称, '旧昵称');
});

test('revision review rejects self-review, denial and missing CSRF before writes', async () => {
  const state = fixture();
  const saved = await savePublishedCardRevision({
    client: state.client,
    listRows: state.ctx.listRows,
    assertCompleteRows: state.ctx.assertCompleteRows,
    card: state.card,
    accountId: 'ACC-1',
    account: { realName: '本地成员', studentId: '999990002', gender: '女', department: '新学院', grade: '2024级' },
    input: input(),
    now: '2030-01-01T00:00:00.000Z',
  });
  const path = new URL(`http://example.test/api/community/morning/revisions/${encodeURIComponent(saved.修订ID)}/review`);
  state.ctx.requireConsoleAccess = () => ({ username: 'owner', role: 'platform_admin', accountId: 'ACC-1' });
  const self = {};
  await morningRevisionRoutes(
    { method: 'POST', headers: {}, body: { decision: 'approve', note: '', expectedVersion: saved.版本号 } },
    self,
    path,
    state.ctx,
  );
  assert.equal(self.status, 409);
  assert.equal(self.payload.code, 'self_review_forbidden');

  state.ctx.requireConsoleAccess = () => ({ username: 'denied', accountId: 'REVIEWER' });
  state.ctx.requireCsrf = () => false;
  const denied = {};
  const deniedResult = await morningRevisionRoutes(
    { method: 'POST', headers: {}, body: { decision: 'approve', note: '', expectedVersion: saved.版本号 } },
    denied,
    path,
    state.ctx,
  );
  assert.equal(deniedResult, true);
  assert.equal(state.revisions[0].审核状态, MORNING_REVISION_STATUS.PENDING);

  state.ctx.requireConsoleAccess = () => null;
  state.ctx.requireCsrf = () => true;
  const unauthorized = {};
  const unauthorizedResult = await morningRevisionRoutes(
    { method: 'POST', headers: {}, body: { decision: 'approve', note: '', expectedVersion: saved.版本号 } },
    unauthorized,
    path,
    state.ctx,
  );
  assert.equal(unauthorizedResult, true);
  assert.equal(state.revisions[0].审核状态, MORNING_REVISION_STATUS.PENDING);
});

test('rejecting a revision records the rejection without changing the plaza card', async () => {
  const state = fixture();
  const saved = await savePublishedCardRevision({
    client: state.client,
    listRows: state.ctx.listRows,
    assertCompleteRows: state.ctx.assertCompleteRows,
    card: state.card,
    accountId: 'ACC-1',
    account: { realName: '本地成员', studentId: '999990002', gender: '女', department: '新学院', grade: '2024级' },
    input: input({ nickname: '不应发布' }),
    now: '2030-01-01T00:00:00.000Z',
  });
  const res = {};
  await morningRevisionRoutes(
    { method: 'POST', headers: {}, body: { decision: 'reject', note: '资料不符合要求', expectedVersion: saved.版本号 } },
    res,
    new URL(`http://example.test/api/community/morning/revisions/${encodeURIComponent(saved.修订ID)}/review`),
    state.ctx,
  );
  assert.equal(res.status, 200);
  assert.equal(state.card.昵称, '旧昵称');
  assert.equal(state.revisions[0].审核状态, MORNING_REVISION_STATUS.REJECTED);
});
