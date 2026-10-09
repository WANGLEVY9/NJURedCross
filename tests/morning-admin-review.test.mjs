import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MORNING_CARD_STATUS } from '../lib/morning/api.js';
import {
  MORNING_ADMIN_PREFIX,
  morningAdminRoutes,
  morningReviewPatch,
  summarizeMorningCards,
} from '../lib/morning/admin.js';

const adminPage = await readFile(new URL('../public/app/console/pages/morning.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../public/app/main.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../public/app/core/api.js', import.meta.url), 'utf8');
const communityPage = await readFile(new URL('../public/app/console/pages/community.js', import.meta.url), 'utf8');

function row(overrides = {}) {
  return {
    _id: 'row-1',
    名片ID: 'MNG-1',
    账号ID: 'ACC-1',
    真实姓名快照: '本地成员',
    学号快照: '999990002',
    性别快照: '女',
    校区: '仙林',
    昵称: '小南',
    兴趣标签: JSON.stringify(['摄影', '跑步']),
    备注: '想找一起跑步的同学',
    审核状态: MORNING_CARD_STATUS.PENDING,
    审核意见: '',
    审核人: '',
    审核时间: '',
    提交时间: '2026-10-09T00:00:00.000Z',
    发布时间: '',
    更新时间: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

function harness(rows, {
  body = {},
  permitted = true,
  csrf = true,
  session = { username: 'local-admin', role: 'super_admin', accountId: 'ACC-ADMIN' },
} = {}) {
  const audits = [];
  const res = { statusCode: 0, payload: null };
  const client = {
    async updateRow(_table, id, patch) {
      const target = rows.find((item) => item._id === id);
      if (!target) throw new Error('row not found');
      Object.assign(target, patch);
      return target;
    },
  };
  const ctx = {
    getBase: async () => client,
    listRows: async () => rows,
    assertCompleteRows: () => {},
    readJsonObject: async () => body,
    requireConsoleAccess: (_req, response, scope) => {
      if (scope !== 'community') throw new Error(`unexpected scope: ${scope}`);
      if (!permitted) {
        response.statusCode = 403;
        response.payload = { ok: false, code: 'permission_denied' };
        return null;
      }
      return session;
    },
    requireCsrf: (_req, response) => {
      if (csrf) return true;
      response.statusCode = 403;
      response.payload = { ok: false, code: 'csrf_failed' };
      return false;
    },
    actor: (value) => value.accountId || value.username,
    recordAudit: (...args) => audits.push(args),
    json: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      return payload;
    },
  };
  return { ctx, res, audits };
}

async function call(rows, { method = 'GET', path = MORNING_ADMIN_PREFIX, body, ...options } = {}) {
  const { ctx, res, audits } = harness(rows, { body, ...options });
  await morningAdminRoutes({ method, body }, res, new URL(`http://example.test${path}`), ctx);
  return { res, audits };
}

test('早安晚安管理端列表只返回请求状态并统计各状态', async () => {
  const rows = [
    row(),
    row({ _id: 'row-2', 名片ID: 'MNG-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
    row({ _id: 'row-3', 名片ID: 'MNG-3', 审核状态: MORNING_CARD_STATUS.DELETED }),
  ];
  const { res } = await call(rows);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.stats.pending, 1);
  assert.equal(res.payload.stats.published, 1);
  assert.equal(res.payload.cards.length, 1);
  assert.equal(res.payload.cards[0].id, 'MNG-1');
});

test('早安晚安管理端详情返回审核所需字段', async () => {
  const { res } = await call([row()], { path: `${MORNING_ADMIN_PREFIX}/MNG-1` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.card.realName, '本地成员');
  assert.equal(res.payload.card.studentId, '999990002');
  assert.deepEqual(res.payload.card.interestTags, ['摄影', '跑步']);
});

test('早安晚安审核支持通过、退回与拒绝', async () => {
  const approved = await call([row()], { method: 'POST', path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`, body: { decision: 'approve' } });
  assert.equal(approved.res.statusCode, 200);
  assert.equal(approved.res.payload.card.status, MORNING_CARD_STATUS.PUBLISHED);
  assert.equal(approved.audits[0][2], 'morning.card.review.approve');

  const returned = await call([row()], { method: 'POST', path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`, body: { decision: 'return', note: '请补充备注' } });
  assert.equal(returned.res.statusCode, 200);
  assert.equal(returned.res.payload.card.status, MORNING_CARD_STATUS.RETURNED);
  assert.equal(returned.res.payload.card.reviewNote, '请补充备注');

  const rejected = await call([row()], { method: 'POST', path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`, body: { decision: 'reject', note: '内容不符合要求' } });
  assert.equal(rejected.res.statusCode, 200);
  assert.equal(rejected.res.payload.card.status, MORNING_CARD_STATUS.REJECTED);
});

test('早安晚安退回和拒绝必须填写审核意见', async () => {
  const returned = await call([row()], { method: 'POST', path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`, body: { decision: 'return' } });
  assert.equal(returned.res.statusCode, 400);
  assert.equal(returned.res.payload.code, 'review_note_required');

  const rejected = await call([row()], { method: 'POST', path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`, body: { decision: 'reject' } });
  assert.equal(rejected.res.statusCode, 400);
  assert.equal(rejected.res.payload.code, 'review_note_required');
});

test('早安晚安只有待审核名片可以被审核', async () => {
  const { res } = await call([row({ 审核状态: MORNING_CARD_STATUS.PUBLISHED })], {
    method: 'POST',
    path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`,
    body: { decision: 'approve' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'card_not_pending');
});

test('早安晚安管理端路由遵守权限与 CSRF', async () => {
  const denied = await call([row()], { permitted: false });
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.res.payload.code, 'permission_denied');

  const csrfDenied = await call([row()], {
    method: 'POST',
    path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`,
    body: { decision: 'approve' },
    csrf: false,
  });
  assert.equal(csrfDenied.res.statusCode, 403);
  assert.equal(csrfDenied.res.payload.code, 'csrf_failed');
});

test('早安晚安普通管理员不能审核自己的名片', async () => {
  const { res } = await call([row({ 账号ID: 'ACC-ADMIN' })], {
    method: 'POST',
    path: `${MORNING_ADMIN_PREFIX}/MNG-1/review`,
    body: { decision: 'approve' },
    session: { username: 'local-admin', role: 'platform_admin', accountId: 'ACC-ADMIN' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'self_review_forbidden');
});

test('早安晚安审核状态映射与统计保持独立', () => {
  const approved = morningReviewPatch({
    currentStatus: MORNING_CARD_STATUS.PENDING,
    decision: 'approve',
    note: '',
    reviewer: 'local-admin',
    now: '2026-10-09T01:00:00.000Z',
  });
  assert.equal(approved.patch['审核状态'], MORNING_CARD_STATUS.PUBLISHED);
  assert.equal(approved.patch['发布时间'], '2026-10-09T01:00:00.000Z');
  assert.deepEqual(summarizeMorningCards([
    { status: MORNING_CARD_STATUS.PENDING },
    { status: MORNING_CARD_STATUS.WITHDRAWN },
  ]), { pending: 1, published: 0, returned: 0, rejected: 0, exited: 1 });
});

test('早安晚安管理端页面接入独立路由、客户端接口与审核抽屉', () => {
  assert.ok(mainSource.includes("path: '/console/community/morning'"), 'admin route missing');
  assert.ok(mainSource.includes('pages/morning.js'), 'admin page module missing');
  assert.ok(mainSource.includes("requireConsoleScope('community')"), 'admin route must reuse community permission');
  assert.ok(apiSource.includes('morning: {') && apiSource.includes('/api/community/morning/cards'), 'console API namespace missing');
  assert.ok(communityPage.includes("communityModuleNav('birthday')"), 'community console must expose the module switch');
  assert.ok(adminPage.includes('openMorningReviewDrawer'), 'review drawer missing');
  assert.ok(adminPage.includes('consoleApi.morning.review('), 'review action missing');
  assert.ok(adminPage.includes('decision !== \'approve\'') && adminPage.includes('拒绝报名必须填写原因'), 'review note validation missing');
  assert.ok(adminPage.includes('审核下一条'), 'continuous review action missing');
  assert.ok(!adminPage.includes('点赞') && !adminPage.includes('like'), 'morning review must not introduce likes');
});
