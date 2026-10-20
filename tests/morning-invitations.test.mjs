import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInvitationToken,
  morningInvitationRoutes,
  verifyInvitationToken,
} from '../lib/morning/invitations.js';
import {
  MORNING_CARD_STATUS,
  MORNING_INVITE_STATUS,
  MORNING_INVITE_TABLE,
} from '../lib/morning/shared.js';

function card(id, accountId, nickname, campus = '仙林') {
  return {
    _id: `row-${id}`,
    名片ID: id,
    账号ID: accountId,
    昵称: nickname,
    校区: campus,
    审核状态: MORNING_CARD_STATUS.PUBLISHED,
  };
}

function fixture() {
  const cards = [
    card('MNG-1', 'ACC-1', '发起者'),
    card('MNG-2', 'ACC-2', '收件者', '苏州'),
  ];
  const invitations = [];
  const mails = [];
  let actorId = 'ACC-1';
  let sequence = 0;
  const client = {
    async appendRow(table, row) {
      assert.equal(table, MORNING_INVITE_TABLE);
      const created = { ...row, _id: `invite-${++sequence}` };
      invitations.push(created);
      return { _id: created._id };
    },
    async updateRow(table, id, patch) {
      assert.equal(table, MORNING_INVITE_TABLE);
      const row = invitations.find(item => item._id === id);
      assert.ok(row, 'updated invitation must exist');
      Object.assign(row, patch);
    },
  };
  const session = { username: 'tester' };
  const ctx = {
    getBase: async () => client,
    listRows: async (_client, table) => {
      if (table === '早安晚安名片表') return cards;
      if (table === MORNING_INVITE_TABLE) return invitations;
      return [];
    },
    assertCompleteRows: () => {},
    requirePortalSession: () => session,
    requirePortalWrite: () => session,
    requireConsoleAccess: () => session,
    requireCsrf: () => true,
    enforcePublicLimit: () => {},
    actor: requestSession => requestSession === session ? actorId : null,
    accountForRef: async accountId => ({
      'ACC-1': { accountId: 'ACC-1', email: 'inviter@smail.nju.edu.cn', label: '发起者' },
      'ACC-2': { accountId: 'ACC-2', email: 'recipient@smail.nju.edu.cn', label: '收件者' },
    })[accountId] || null,
    readJsonObject: async req => req.body || {},
    sendMail: async message => {
      mails.push(message);
      return { ok: true };
    },
    recordAudit: () => {},
    json: (res, status, payload) => {
      res.status = status;
      res.payload = payload;
      return payload;
    },
    inviteSecret: 'synthetic-morning-secret',
    publicBaseUrl: 'https://example.test',
    inviteCoordinators: {
      nanjing: ['nanjing-chair@example.test'],
      suzhou: ['suzhou-chair@example.test'],
    },
  };
  return {
    cards,
    invitations,
    mails,
    ctx,
    setActor(value) { actorId = value; },
  };
}

async function call(ctx, method, path, body = {}) {
  const res = {};
  const result = await morningInvitationRoutes(
    { method, headers: {}, body },
    res,
    new URL(`https://example.test${path}`),
    ctx,
  );
  assert.notEqual(result, false);
  return res;
}

test('invitation tokens expire after three days and reject tampering', () => {
  const expiresAt = new Date('2030-01-04T00:00:00.000Z').toISOString();
  const token = createInvitationToken({
    invitationId: 'MNG-INV-1',
    expiresAt,
    secret: 'secret',
  });
  assert.equal(
    verifyInvitationToken(token, 'secret', Date.parse('2030-01-03T00:00:00.000Z')).invitationId,
    'MNG-INV-1',
  );
  assert.equal(verifyInvitationToken(token, 'secret', Date.parse('2030-01-04T00:00:00.000Z')), null);
  assert.equal(verifyInvitationToken(`${token}x`, 'secret', Date.parse('2030-01-03T00:00:00.000Z')), null);
});

test('friend invitation sends a three-day profile and feedback link, then records success', async () => {
  const state = fixture();
  const created = await call(
    state.ctx,
    'POST',
    '/api/morning/cards/MNG-2/invitations',
    { message: '想和你一起逛展。' },
  );
  assert.equal(created.status, 201);
  assert.equal(created.payload.invitation.status, MORNING_INVITE_STATUS.SENT);
  assert.equal(state.invitations.length, 1);
  assert.equal(state.invitations[0].名片ID, 'MNG-1');
  assert.equal(state.invitations[0].收件人账号ID, 'ACC-2');
  assert.equal(state.invitations[0].邀约附言, '想和你一起逛展。');
  assert.equal(state.mails.length, 1);
  assert.match(state.mails[0].text, /inviter@smail\.nju\.edu\.cn/);
  assert.match(state.mails[0].text, /对方主页：https:\/\/example\.test\/morning\/plaza\?card=MNG-1&invite=/);
  assert.match(state.mails[0].text, /反馈链接：https:\/\/example\.test\/morning\/invite-feedback\?token=/);
  assert.match(state.mails[0].text, /有效期为 3 天/);

  const feedbackUrl = state.mails[0].text.match(/反馈链接：(https:\/\/\S+)/)?.[1];
  const token = new URL(feedbackUrl).searchParams.get('token');
  state.setActor('ACC-2');
  const details = await call(
    state.ctx,
    'GET',
    `/api/morning/invitations/feedback/${encodeURIComponent(token)}`,
  );
  assert.equal(details.status, 200);
  assert.equal(details.payload.invitation.cardId, 'MNG-1');
  assert.equal(details.payload.invitation.inviterNickname, '发起者');
  assert.equal(details.payload.invitation.recipientNickname, '收件者');

  const confirmed = await call(
    state.ctx,
    'POST',
    `/api/morning/invitations/feedback/${encodeURIComponent(token)}`,
    {},
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.invitation.status, MORNING_INVITE_STATUS.FEEDBACK);
  assert.equal(state.invitations[0].状态, MORNING_INVITE_STATUS.FEEDBACK);
  assert.equal(state.invitations[0].协调人通知状态, '已发送');
  assert.equal(state.mails.length, 2);
  assert.equal(state.mails[1].to, 'nanjing-chair@example.test');

  const admin = await call(state.ctx, 'GET', '/api/community/morning/invitations');
  assert.equal(admin.status, 200);
  assert.equal(admin.payload.stats.total, 1);
  assert.equal(admin.payload.stats.success, 1);
  assert.equal(admin.payload.stats.successRate, 100);
  assert.equal(admin.payload.invitations[0].inviterEmail, 'in***@smail.nju.edu.cn');
  assert.equal(admin.payload.invitations[0].recipientEmail, 're***@smail.nju.edu.cn');
});

test('feedback is restricted to the invited recipient', async () => {
  const state = fixture();
  await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations', { message: '' });
  const feedbackUrl = state.mails[0].text.match(/反馈链接：(https:\/\/\S+)/)?.[1];
  const token = new URL(feedbackUrl).searchParams.get('token');
  state.setActor('ACC-1');
  const denied = await call(
    state.ctx,
    'GET',
    `/api/morning/invitations/feedback/${encodeURIComponent(token)}`,
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.code, 'invite_recipient_mismatch');
});
