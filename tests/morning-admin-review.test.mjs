import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MORNING_CARD_STATUS } from '../lib/morning/api.js';
import {
  MORNING_BLACKLIST_PREFIX,
  MORNING_ADMIN_PREFIX,
  MORNING_MEMBERS_PREFIX,
  MORNING_REPORTS_PREFIX,
  morningAdminRoutes,
  morningReviewPatch,
  summarizeMorningCards,
} from '../lib/morning/admin.js';
import { MORNING_BLACKLIST_TABLE, MORNING_COMMENT_TABLE, MORNING_COMMENT_REPORT_STATUS } from '../lib/morning/shared.js';

const adminPage = await readFile(new URL('../public/app/console/pages/morning.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../public/app/main.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../public/app/core/api.js', import.meta.url), 'utf8');
const communityPage = await readFile(new URL('../public/app/console/pages/community.js', import.meta.url), 'utf8');
const blacklistSchemaScript = await readFile(new URL('../scripts/apply-morning-blacklist-schema.mjs', import.meta.url), 'utf8');
const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');

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

function comment(overrides = {}) {
  return {
    _id: 'comment-1',
    评论ID: 'MNG-CMT-1',
    名片ID: 'MNG-1',
    评论人账号ID: 'ACC-2',
    内容: '被举报的评论',
    状态: '已举报',
    举报状态: MORNING_COMMENT_REPORT_STATUS.PENDING,
    举报人账号ID: 'ACC-1',
    举报原因: '不当内容',
    举报时间: '2026-10-09T02:00:00.000Z',
    处理人: '',
    处理时间: '',
    处理意见: '',
    ...overrides,
  };
}

function blacklistEntry(overrides = {}) {
  return {
    _id: 'blacklist-1',
    黑名单ID: 'MNG-BLK-1',
    账号ID: 'ACC-1',
    昵称快照: '小南',
    真实姓名快照: '本地成员',
    学号快照: '999990002',
    原因: '多次不当内容',
    来源: '成员预览',
    状态: '生效',
    操作人: 'local-admin',
    拉黑时间: '2026-10-09T03:00:00.000Z',
    解除时间: '',
    更新时间: '2026-10-09T03:00:00.000Z',
    ...overrides,
  };
}

function harness(rows, {
  comments = [],
  blacklist = [],
  body = {},
  permitted = true,
  csrf = true,
  session = { username: 'local-admin', role: 'super_admin', accountId: 'ACC-ADMIN' },
} = {}) {
  const audits = [];
  const res = { statusCode: 0, payload: null };
  const client = {
    async updateRow(table, id, patch) {
      const source = table === MORNING_COMMENT_TABLE ? comments : table === MORNING_BLACKLIST_TABLE ? blacklist : rows;
      const target = source.find((item) => item._id === id);
      if (!target) throw new Error('row not found');
      Object.assign(target, patch);
      return target;
    },
    async appendRow(table, row) {
      if (table !== MORNING_BLACKLIST_TABLE) throw new Error(`unexpected table: ${table}`);
      const saved = { ...row, _id: `blacklist-${blacklist.length + 1}` };
      blacklist.push(saved);
      return saved;
    },
  };
  const ctx = {
    getBase: async () => client,
    listRows: async (_client, table) => table === MORNING_COMMENT_TABLE
      ? comments
      : table === MORNING_BLACKLIST_TABLE
        ? blacklist
        : rows,
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
  return { ctx, res, audits, blacklist };
}

async function call(rows, { comments = [], blacklist = [], method = 'GET', path = MORNING_ADMIN_PREFIX, body, ...options } = {}) {
  const { ctx, res, audits, blacklist: currentBlacklist } = harness(rows, { comments, blacklist, body, ...options });
  await morningAdminRoutes({ method, body }, res, new URL(`http://example.test${path}`), ctx);
  return { res, audits, blacklist: currentBlacklist };
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
  assert.ok(apiSource.includes('/api/community/morning/reports') && apiSource.includes('decideReport:'), 'report management API client missing');
  assert.ok(apiSource.includes('/api/community/morning/members') && apiSource.includes('/api/community/morning/blacklist'), 'member/blacklist API client missing');
  assert.ok(communityPage.includes("communityModuleNav('birthday')"), 'community console must expose the module switch');
  assert.ok(adminPage.includes('openMorningReviewDrawer'), 'review drawer missing');
  assert.ok(adminPage.includes('consoleApi.morning.review('), 'review action missing');
  assert.ok(adminPage.includes('decision !== \'approve\'') && adminPage.includes('拒绝报名必须填写原因'), 'review note validation missing');
  assert.ok(adminPage.includes('审核下一条'), 'continuous review action missing');
  assert.ok(adminPage.includes("label: '举报处理'") && adminPage.includes('openMorningReportDrawer'), 'parallel report handling view missing');
  assert.ok(adminPage.includes("label: '成员管理'") && adminPage.includes('openMorningMemberDrawer'), 'parallel member management view missing');
  assert.ok(adminPage.includes("label: '拉黑账号'") && adminPage.includes("label: '拉黑评论人'"), 'review/report blacklist actions missing');
  assert.ok(adminPage.includes('runWithLoading(action') && !adminPage.includes('event.currentTarget'), 'blacklist release must retain its button reference');
  assert.ok(adminPage.includes('确认举报并隐藏评论') && adminPage.includes('驳回举报并恢复评论'), 'report decisions missing');
  assert.ok(!adminPage.includes('点赞') && !adminPage.includes('like'), 'morning review must not introduce likes');
  assert.ok(blacklistSchemaScript.includes('CREATE-MORNING-BLACKLIST-TABLE') && blacklistSchemaScript.includes('base.addTable'), 'blacklist schema migration missing');
  assert.ok(packageSource.includes('morning:blacklist-schema:preview') && packageSource.includes('morning:blacklist-schema:apply'), 'blacklist schema scripts missing');
});

test('早安晚安管理端举报列表按状态返回待处理举报', async () => {
  const { res } = await call([row()], {
    comments: [comment(), comment({ _id: 'comment-2', 评论ID: 'MNG-CMT-2', 举报状态: MORNING_COMMENT_REPORT_STATUS.RESOLVED })],
    path: MORNING_REPORTS_PREFIX,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.stats.pending, 1);
  assert.equal(res.payload.stats.handled, 1);
  assert.equal(res.payload.reports.length, 1);
  assert.equal(res.payload.reports[0].reason, '不当内容');
});

test('早安晚安举报支持确认隐藏和驳回恢复评论', async () => {
  const handledComments = [comment()];
  const handled = await call([row()], {
    comments: handledComments,
    method: 'POST',
    path: `${MORNING_REPORTS_PREFIX}/MNG-CMT-1/handle`,
    body: { note: '确认存在骚扰内容' },
  });
  assert.equal(handled.res.statusCode, 200);
  assert.equal(handledComments[0]['举报状态'], MORNING_COMMENT_REPORT_STATUS.RESOLVED);
  assert.equal(handledComments[0]['状态'], '已举报');
  assert.equal(handledComments[0]['处理人'], 'local-admin');
  assert.equal(handled.audits[0][2], 'morning.comment.report.handle');

  const dismissedComments = [comment()];
  const dismissed = await call([row()], {
    comments: dismissedComments,
    method: 'POST',
    path: `${MORNING_REPORTS_PREFIX}/MNG-CMT-1/dismiss`,
    body: { note: '未发现违规内容' },
  });
  assert.equal(dismissed.res.statusCode, 200);
  assert.equal(dismissedComments[0]['举报状态'], MORNING_COMMENT_REPORT_STATUS.DISMISSED);
  assert.equal(dismissedComments[0]['状态'], '可见');
});

test('早安晚安举报只有待处理记录可以处理且必须填写意见', async () => {
  const missingNote = await call([row()], {
    comments: [comment()],
    method: 'POST',
    path: `${MORNING_REPORTS_PREFIX}/MNG-CMT-1/handle`,
    body: { note: '' },
  });
  assert.equal(missingNote.res.statusCode, 400);
  assert.equal(missingNote.res.payload.code, 'report_note_required');

  const closed = await call([row()], {
    comments: [comment({ 举报状态: MORNING_COMMENT_REPORT_STATUS.RESOLVED })],
    method: 'POST',
    path: `${MORNING_REPORTS_PREFIX}/MNG-CMT-1/handle`,
    body: { note: '重复处理' },
  });
  assert.equal(closed.res.statusCode, 409);
  assert.equal(closed.res.payload.code, 'report_not_pending');
});

test('早安晚安成员预览显示黑名单状态', async () => {
  const { res } = await call([
    row({ 审核状态: MORNING_CARD_STATUS.PUBLISHED, 发布时间: '2026-10-09T01:00:00.000Z' }),
  ], {
    blacklist: [blacklistEntry()],
    path: MORNING_MEMBERS_PREFIX,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.stats.total, 1);
  assert.equal(res.payload.stats.blacklisted, 1);
  assert.equal(res.payload.members[0].blacklisted, true);
  assert.equal(res.payload.members[0].blacklistReason, '多次不当内容');
});

test('早安晚安成员统计满足总数等于已发布、待审核与黑名单之和', async () => {
  const { res } = await call([
    row({ _id: 'published', 名片ID: 'MNG-PUBLISHED', 账号ID: 'ACC-PUBLISHED', 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
    row({ _id: 'pending', 名片ID: 'MNG-PENDING', 账号ID: 'ACC-PENDING', 审核状态: MORNING_CARD_STATUS.PENDING }),
    row({ _id: 'returned', 名片ID: 'MNG-RETURNED', 账号ID: 'ACC-RETURNED', 审核状态: MORNING_CARD_STATUS.RETURNED }),
  ], {
    blacklist: [blacklistEntry({ _id: 'blacklist-only', 黑名单ID: 'MNG-BLK-ONLY', 账号ID: 'ACC-BLACKLIST-ONLY' })],
    path: MORNING_MEMBERS_PREFIX,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.stats.published, 1);
  assert.equal(res.payload.stats.pending, 1);
  assert.equal(res.payload.stats.blacklisted, 1);
  assert.equal(res.payload.stats.total, 3);
  assert.equal(
    res.payload.stats.total,
    res.payload.stats.published + res.payload.stats.pending + res.payload.stats.blacklisted,
  );
  assert.ok(res.payload.members.some((member) => member.accountId === 'ACC-BLACKLIST-ONLY' && member.blacklisted));
  assert.ok(!res.payload.members.some((member) => member.accountId === 'ACC-RETURNED'));
});

test('拉黑成员会写入黑名单并撤下现有名片', async () => {
  const cards = [row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 发布时间: '2026-10-09T01:00:00.000Z' })];
  const state = await call(cards, {
    method: 'POST',
    path: MORNING_BLACKLIST_PREFIX,
    body: { accountId: 'ACC-2', reason: '确认骚扰其他成员', source: '举报处理' },
  });
  assert.equal(state.res.statusCode, 201);
  assert.equal(state.blacklist.length, 1);
  assert.equal(state.blacklist[0]['状态'], '生效');
  assert.equal(cards[0]['审核状态'], MORNING_CARD_STATUS.WITHDRAWN);
  assert.match(cards[0]['审核意见'], /确认骚扰/);
  assert.equal(state.audits[0][2], 'morning.member.blacklist');
});

test('解除拉黑保留历史记录并允许重新报名', async () => {
  const blacklist = [blacklistEntry()];
  const state = await call([row()], {
    blacklist,
    method: 'POST',
    path: `${MORNING_BLACKLIST_PREFIX}/MNG-BLK-1/release`,
    body: {},
  });
  assert.equal(state.res.statusCode, 200);
  assert.equal(blacklist[0]['状态'], '已解除');
  assert.ok(blacklist[0]['解除时间']);
  assert.equal(state.audits[0][2], 'morning.member.blacklist.release');
});
