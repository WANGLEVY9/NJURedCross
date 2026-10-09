import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MORNING_CARD_STATUS } from '../lib/morning/api.js';
import { MORNING_COMMENT_TABLE, morningCommentRoutes, toMorningCommentView } from '../lib/morning/comments.js';

const plazaSource = await readFile(new URL('../public/app/portal/pages/morning-plaza.js', import.meta.url), 'utf8');
const commentsSource = await readFile(new URL('../public/app/portal/morning-comments.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../public/app/core/api.js', import.meta.url), 'utf8');

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

function harness({ cards, comments = [], sendEmail = true } = {}) {
  const res = { statusCode: 0, payload: null };
  const mail = [];
  const audits = [];
  const client = {
    async appendRow(table, row) {
      if (table === MORNING_COMMENT_TABLE) comments.push({ ...row, _id: `row-${comments.length + 1}` });
      return { _id: `row-${comments.length}` };
    },
  };
  const ctx = {
    requirePortalSession: () => ({ username: 'local-member', role: 'member' }),
    requirePortalWrite: () => ({ username: 'local-member', role: 'member' }),
    actor: () => 'ACC-1',
    getBase: async () => client,
    listRows: async (_client, table) => table === MORNING_COMMENT_TABLE ? comments : cards,
    assertCompleteRows: () => {},
    readJsonObject: async () => ({
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

async function call({ cards, comments, sendEmail = true, method = 'GET' } = {}) {
  const state = harness({ cards, comments, sendEmail });
  await morningCommentRoutes({ method }, state.res, new URL('http://example.test/api/morning/cards/MNG-2/comments'), state.ctx);
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

test('早安晚安评论投影保持公开字段', () => {
  assert.deepEqual(toMorningCommentView(comment()), {
    id: 'MNG-CMT-1',
    content: '你好',
    createdAt: '2026-10-09T01:00:00.000Z',
  });
});

test('早安晚安评论前端入口已接入', () => {
  assert.ok(apiSource.includes('comments: (id)') && apiSource.includes('createComment: (id, body)'), 'comment API client missing');
  assert.ok(commentsSource.includes('sendEmail') && commentsSource.includes('shareStudentId') && commentsSource.includes('shareWechat'), 'comment options missing');
  assert.ok(commentsSource.includes('getAccountProfile') && commentsSource.includes('readonly: true'), 'contact defaults must come from profile with read-only student id/email');
  assert.ok(plazaSource.includes('buildMorningCommentsPanel'), 'plaza modal comment panel missing');
});
