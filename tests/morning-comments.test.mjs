import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MORNING_CARD_STATUS } from '../lib/morning/api.js';
import { MORNING_COMMENT_TABLE, morningCommentRoutes, toMorningCommentView } from '../lib/morning/comments.js';
import { STATE_SCHEMA } from '../lib/production-schema.js';
import { MORNING_SCHEMA } from '../lib/morning/schema.js';
import { MORNING_COMMENT_REPORT_STATUS } from '../lib/morning/shared.js';

const plazaSource = await readFile(new URL('../public/app/portal/pages/morning-plaza.js', import.meta.url), 'utf8');
const morningPageSource = await readFile(new URL('../public/app/portal/pages/morning.js', import.meta.url), 'utf8');
const warmthSource = await readFile(new URL('../public/app/portal/pages/warmth.js', import.meta.url), 'utf8');
const meSource = await readFile(new URL('../public/app/portal/pages/me.js', import.meta.url), 'utf8');
const commentsSource = await readFile(new URL('../public/app/portal/morning-comments.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../public/app/core/api.js', import.meta.url), 'utf8');
const reportSchemaScript = await readFile(new URL('../scripts/apply-morning-comment-report-schema.mjs', import.meta.url), 'utf8');
const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');

function card(overrides = {}) {
  return {
    _id: 'card-own',
    名片ID: 'MNG-OWN',
    账号ID: 'ACC-1',
    校区: '仙林',
    昵称: '自己',
    兴趣标签: '[]',
    备注: '',
    审核状态: MORNING_CARD_STATUS.PENDING,
    提交时间: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

function comment(overrides = {}) {
  return {
    _id: 'comment-1',
    评论ID: 'MNG-CMT-1',
    名片ID: 'MNG-2',
    评论人账号ID: 'ACC-2',
    内容: '你好',
    状态: '可见',
    是否发邮件: '否',
    公开学号: '否',
    公开邮箱: '否',
    公开QQ: '否',
    公开微信: '否',
    创建时间: '2026-10-09T01:00:00.000Z',
    更新时间: '2026-10-09T01:00:00.000Z',
    ...overrides,
  };
}

function harness({ cards, comments = [], sendEmail = true, body = null } = {}) {
  const res = { statusCode: 0, payload: null };
  const mail = [];
  const audits = [];
  const client = {
    async appendRow(table, row) {
      if (table === MORNING_COMMENT_TABLE) comments.push({ ...row, _id: `row-${comments.length + 1}` });
      return { _id: `row-${comments.length}` };
    },
    async updateRow(table, id, patch) {
      if (table !== MORNING_COMMENT_TABLE) throw new Error(`unexpected table: ${table}`);
      const target = comments.find((item) => item._id === id || item.评论ID === id);
      if (!target) throw new Error('comment not found');
      Object.assign(target, patch);
      return target;
    },
  };
  const ctx = {
    requirePortalSession: () => ({ username: 'local-member', role: 'member' }),
    requirePortalWrite: () => ({ username: 'local-member', role: 'member' }),
    actor: () => 'ACC-1',
    getBase: async () => client,
    listRows: async (_client, table) => table === MORNING_COMMENT_TABLE ? comments : cards,
    assertCompleteRows: () => {},
    readJsonObject: async () => body || ({
      content: '很高兴认识你',
      sendEmail,
      shareStudentId: true,
      shareEmail: true,
      shareQq: true,
      shareWechat: true,
      qq: '654321',
      wechat: 'form-wechat',
    }),
    enforcePublicLimit: () => {},
    accountForRef: (ref) => ref === 'ACC-2'
      ? { email: 'owner@smail.nju.edu.cn' }
      : { studentId: '999990002', email: 'member@smail.nju.edu.cn', qq: '123456', wechat: 'member-wechat' },
    sendMail: async (message) => {
      mail.push(message);
      return { ok: true, transport: 'console' };
    },
    recordAudit: (...args) => audits.push(args),
    json: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      return payload;
    },
  };
  return { ctx, res, mail, audits, comments };
}

async function call({
  cards,
  comments,
  sendEmail = true,
  method = 'GET',
  body = null,
  path = '/api/morning/cards/MNG-2/comments',
} = {}) {
  const state = harness({ cards, comments, sendEmail, body });
  await morningCommentRoutes({ method }, state.res, new URL(`http://example.test${path}`), state.ctx);
  return state;
}

test('早安晚安评论要求报名并只读取已发布他人名片', async () => {
  const denied = await call({ cards: [card({ _id: 'card-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED })] });
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.res.payload.code, 'morning_card_required');

  const visible = await call({
    cards: [card(), card({ _id: 'card-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED })],
    comments: [comment(), comment({ _id: 'comment-2', 评论ID: 'MNG-CMT-2', 内容: '另一条' })],
  });
  assert.equal(visible.res.statusCode, 200);
  assert.equal(visible.res.payload.comments.length, 2);
});

test('早安晚安评论支持发邮件与选择邮件联系方式', async () => {
  const state = await call({
    cards: [card(), card({ _id: 'card-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED })],
    method: 'POST',
  });
  assert.equal(state.res.statusCode, 201);
  assert.match(state.mail[0].text, /999990002/);
  assert.match(state.mail[0].text, /member@smail\.nju\.edu\.cn/);
  assert.match(state.mail[0].text, /654321/);
  assert.match(state.mail[0].text, /form-wechat/);
  assert.equal(state.comments[0]['是否发邮件'], '是');
  assert.equal(state.comments[0]['公开微信'], '是');
  assert.equal(state.audits[0][2], 'morning.comment.create');
});

test('早安晚安评论不选择发邮件时不发送邮件', async () => {
  const state = await call({
    cards: [card(), card({ _id: 'card-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED })],
    method: 'POST',
    sendEmail: false,
  });
  assert.equal(state.res.statusCode, 201);
  assert.equal(state.mail.length, 0);
  assert.equal(state.comments[0]['是否发邮件'], '否');
  assert.equal(state.comments[0]['公开邮箱'], '否');
});

test('名片关闭评论邮件后即使评论者请求也不发送邮件', async () => {
  const state = await call({
    cards: [
      card(),
      card({ _id: 'card-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 允许评论邮件: '否' }),
    ],
    method: 'POST',
  });
  assert.equal(state.res.statusCode, 201);
  assert.equal(state.mail.length, 0);
  assert.match(state.res.payload.message, /关闭邮件通知/);
});

test('早安晚安评论投影保持公开字段', () => {
  assert.deepEqual(toMorningCommentView(comment()), {
    id: 'MNG-CMT-1',
    content: '你好',
    createdAt: '2026-10-09T01:00:00.000Z',
  });
});

test('早安晚安举报字段同时进入模块与生产表结构声明', () => {
  const required = ['举报状态', '举报人账号ID', '举报原因', '举报时间', '处理人', '处理时间', '处理意见'];
  const moduleTable = MORNING_SCHEMA.find((table) => table.name === MORNING_COMMENT_TABLE);
  const productionTable = STATE_SCHEMA.find((table) => table.name === MORNING_COMMENT_TABLE);
  assert.ok(moduleTable && productionTable, 'morning comment schema missing');
  for (const field of required) {
    assert.ok(moduleTable.columns.includes(field), `module schema missing ${field}`);
    assert.ok(productionTable.columns.includes(field), `production schema missing ${field}`);
  }
  assert.ok(reportSchemaScript.includes("ADD-MORNING-REPORT-COLUMNS") && reportSchemaScript.includes('base.insertColumn'), 'report column migration script missing');
  assert.ok(packageSource.includes('morning:report-schema:preview') && packageSource.includes('morning:report-schema:apply'), 'report schema scripts missing');
});

test('名片本人可以读取自己名片的评论并获得举报能力', async () => {
  const state = await call({
    cards: [card({ _id: 'card-own', 名片ID: 'MNG-OWN', 账号ID: 'ACC-1', 审核状态: MORNING_CARD_STATUS.PUBLISHED })],
    comments: [comment({ _id: 'comment-own', 名片ID: 'MNG-OWN', 评论人账号ID: 'ACC-2' })],
    path: '/api/morning/cards/MNG-OWN/comments',
  });
  assert.equal(state.res.statusCode, 200);
  assert.equal(state.res.payload.viewer, 'owner');
  assert.equal(state.res.payload.comments[0].canReport, true);
  assert.equal(state.res.payload.comments[0].reportStatus, '');
});

test('名片本人举报评论后评论退出公开列表并进入待处理', async () => {
  const comments = [comment({ _id: 'comment-own', 名片ID: 'MNG-OWN', 评论人账号ID: 'ACC-2' })];
  const reported = await call({
    cards: [card({ _id: 'card-own', 名片ID: 'MNG-OWN', 账号ID: 'ACC-1', 审核状态: MORNING_CARD_STATUS.PUBLISHED })],
    comments,
    method: 'POST',
    path: '/api/morning/cards/MNG-OWN/comments/MNG-CMT-1/report',
    body: { reason: '评论包含不当骚扰内容' },
  });
  assert.equal(reported.res.statusCode, 200);
  assert.equal(comments[0]['状态'], '已举报');
  assert.equal(comments[0]['举报状态'], MORNING_COMMENT_REPORT_STATUS.PENDING);
  assert.equal(comments[0]['举报人账号ID'], 'ACC-1');
  assert.equal(reported.audits[0][2], 'morning.comment.report');
  assert.equal(reported.res.payload.comment.canReport, false);

  const publicView = await call({
    cards: [card(), card({ _id: 'card-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED })],
    comments: [{ ...comments[0], 名片ID: 'MNG-2', 评论人账号ID: 'ACC-3' }],
  });
  assert.equal(publicView.res.payload.comments.length, 0);
});

test('举报只允许名片本人且必须来自报名账号', async () => {
  const notOwner = await call({
    cards: [card({ _id: 'card-own', 名片ID: 'MNG-OWN', 账号ID: 'ACC-1' })],
    comments: [comment({ _id: 'comment-own', 名片ID: 'MNG-OWN' })],
    method: 'POST',
    path: '/api/morning/cards/MNG-OTHER/comments/MNG-CMT-1/report',
    body: { reason: '不当内容' },
  });
  assert.equal(notOwner.res.statusCode, 403);
  assert.equal(notOwner.res.payload.code, 'not_card_owner');
});

test('举报原因必填且同一条评论不能重复举报', async () => {
  const missingReason = await call({
    cards: [card({ _id: 'card-own', 名片ID: 'MNG-OWN', 账号ID: 'ACC-1' })],
    comments: [comment({ _id: 'comment-own', 名片ID: 'MNG-OWN' })],
    method: 'POST',
    path: '/api/morning/cards/MNG-OWN/comments/MNG-CMT-1/report',
    body: { reason: '' },
  });
  assert.equal(missingReason.res.statusCode, 400);
  assert.equal(missingReason.res.payload.code, 'report_reason_required');

  const duplicate = await call({
    cards: [card({ _id: 'card-own', 名片ID: 'MNG-OWN', 账号ID: 'ACC-1' })],
    comments: [comment({ _id: 'comment-own', 名片ID: 'MNG-OWN', 举报状态: MORNING_COMMENT_REPORT_STATUS.PENDING })],
    method: 'POST',
    path: '/api/morning/cards/MNG-OWN/comments/MNG-CMT-1/report',
    body: { reason: '重复举报' },
  });
  assert.equal(duplicate.res.statusCode, 409);
  assert.equal(duplicate.res.payload.code, 'comment_already_reported');
});

test('早安晚安评论前端入口已接入', () => {
  assert.ok(apiSource.includes('comments: (id)') && apiSource.includes('createComment: (id, body)') && apiSource.includes('reportComment:'), 'comment API client missing');
  assert.ok(commentsSource.includes('sendEmail') && commentsSource.includes('shareStudentId') && commentsSource.includes('shareWechat'), 'comment options missing');
  assert.ok(commentsSource.includes('getAccountProfile') && commentsSource.includes('readonly: true'), 'contact defaults must come from profile with read-only student id/email');
  assert.ok(commentsSource.includes('allowEmail') && commentsSource.includes('对方已关闭评论邮件通知'), 'comment form must reflect owner email preference');
  assert.ok(commentsSource.includes('buildMorningOwnerCommentsPanel') && commentsSource.includes('openMorningReportDrawer'), 'owner comment report panel missing');
  assert.ok(commentsSource.includes('举报评论人') && commentsSource.includes('已退出公开列表'), 'report action and impact copy missing');
  assert.ok(morningPageSource.includes('buildMorningOwnerCommentsPanel(card)'), 'morning signup page must expose owner comment reports');
  assert.ok(warmthSource.includes("label: '我的评论'") && warmthSource.includes('openMyMorningComments()'), 'community home must open the owner comment preview');
  assert.ok(warmthSource.includes('buildMorningOwnerCommentsPanel(myMorningCard') && warmthSource.includes("eyebrow: '早安晚安 · 我的评论'"), 'community home owner comment preview missing');
  assert.ok(commentsSource.includes("text: '我收到的评论'") && commentsSource.includes('只有遇到不当内容时'), 'comment panel must lead with viewing comments');
  assert.ok(!meSource.includes("label: '评论与举报'"), 'member centre must not own the comment report entry');
  assert.ok(plazaSource.includes('buildMorningCommentsPanel'), 'plaza modal comment panel missing');
});
