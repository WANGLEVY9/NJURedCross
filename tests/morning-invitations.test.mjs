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
  let invitationReads = 0;
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
      if (table === MORNING_INVITE_TABLE) {
        invitationReads++;
        return invitations;
      }
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
    resolveInviteCoordinators: async campus => campus === '苏州'
      ? ['suzhou-chair@example.test'] : ['nanjing-chair@example.test'],
  };
  return {
    cards,
    invitations,
    mails,
    ctx,
    setActor(value) { actorId = value; },
    invitationReads: () => invitationReads,
    resetInvitationReads() { invitationReads = 0; },
  };
}

async function call(ctx, method, path, body = {}, headers = {}) {
  const res = {};
  const result = await morningInvitationRoutes(
    { method, headers, body },
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

test('invitation mail links use PUBLIC_BASE_URL instead of the request Host header', async () => {
  const state = fixture();
  state.ctx.publicBaseUrl = 'https://platform.example';
  await call(
    state.ctx,
    'POST',
    '/api/morning/cards/MNG-2/invitations',
    { message: '' },
    { host: 'attacker.example' },
  );
  assert.match(state.mails[0].text, /https:\/\/platform\.example\/morning\/invite-feedback\?token=/);
  assert.doesNotMatch(state.mails[0].text, /attacker\.example/);
});

test('friend invitation sends one private decision link and records acceptance', async () => {
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
  assert.doesNotMatch(state.mails[0].text, /inviter@smail\.nju\.edu\.cn/);
  assert.match(state.mails[0].text, /查看并处理邀约：https:\/\/example\.test\/morning\/invite-feedback\?token=/);
  assert.match(state.mails[0].text, /邀约处理链接有效期为 3 天/);

  const feedbackUrl = state.mails[0].text.match(/查看并处理邀约：(https:\/\/\S+)/)?.[1];
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
  assert.ok(details.payload.invitation.createdAt);

  const confirmed = await call(
    state.ctx,
    'POST',
    `/api/morning/invitations/feedback/${encodeURIComponent(token)}`,
    { decision: 'accept' },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.invitation.status, MORNING_INVITE_STATUS.FEEDBACK);
  assert.equal(state.invitations[0].状态, MORNING_INVITE_STATUS.FEEDBACK);
  assert.equal(state.invitations[0].协调人通知状态, '');
  assert.equal(state.mails.length, 2);
  assert.equal(state.mails[1].to, 'inviter@smail.nju.edu.cn');
  assert.equal(confirmed.payload.invitation.inviterEmail, 'inviter@smail.nju.edu.cn');


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
  const feedbackUrl = state.mails[0].text.match(/查看并处理邀约：(https:\/\/\S+)/)?.[1];
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

test('feedback only reads token and locked invitation', async () => {
  const state = fixture();
  await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations', { message: '' });
  const feedbackUrl = state.mails[0].text.match(/查看并处理邀约：(https:\/\/\S+)/)?.[1];
  const token = new URL(feedbackUrl).searchParams.get('token');
  state.setActor('ACC-2');
  state.resetInvitationReads();
  const confirmed = await call(
    state.ctx,
    'POST',
    `/api/morning/invitations/feedback/${encodeURIComponent(token)}`,
    { decision: 'accept' },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(state.invitationReads(), 2, 'token lookup and lock refresh only');
  assert.equal(state.invitations[0].协调人通知状态, '');
});

test('decisions never resolve coordinators and notify only the inviter', async () => {
  for (const resolver of [undefined, async () => { throw Error('must not read roster'); }]) {
    const state = fixture();
    await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations');
    const feedbackUrl = state.mails[0].text.match(/查看并处理邀约：(https:\/\/\S+)/)[1];
    const path = `/api/morning/invitations/feedback/${encodeURIComponent(new URL(feedbackUrl).searchParams.get('token'))}`;
    state.setActor('ACC-2');
    state.ctx.resolveInviteCoordinators = resolver;
    assert.equal((await call(state.ctx, 'POST', path, { decision: 'accept', to: 'attacker@example.test' })).status, 200);
    assert.equal((await call(state.ctx, 'POST', path, { decision: 'accept' })).payload.alreadyReported, true);
    assert.equal(state.invitations[0].状态, MORNING_INVITE_STATUS.FEEDBACK);
    assert.equal(state.mails.length, 3);
    assert.equal(state.invitations[0].协调人通知状态, '');
  }
});

test('invitation creation still requires the sender card to be published', async () => {
  const state = fixture();
  state.cards[0].审核状态 = MORNING_CARD_STATUS.PENDING;
  const denied = await call(
    state.ctx,
    'POST',
    '/api/morning/cards/MNG-2/invitations',
    { message: '名片还在审核中。' },
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.code, 'morning_card_required');
  assert.equal(state.invitations.length, 0);
  assert.equal(state.mails.length, 0);
});

test('invitation SMTP failure is recorded without claiming delivery', async () => {
  const state = fixture();
  state.ctx.sendMail = async () => ({ ok: false });
  const created = await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations', { message: '' });
  assert.equal(created.status, 201);
  assert.equal(created.payload.invitation.mailStatus, '发送失败');
  assert.match(created.payload.message, /暂时未发送成功/);
  assert.equal(state.invitations[0].邮件状态, '发送失败');
});

test('expired feedback links are rejected without changing invitation state', async () => {
  const state = fixture();
  await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations', { message: '' });
  const feedbackUrl = state.mails[0].text.match(/查看并处理邀约：(https:\/\/\S+)/)?.[1];
  const token = new URL(feedbackUrl).searchParams.get('token');
  state.invitations[0].过期时间 = '2020-01-01T00:00:00.000Z';
  state.setActor('ACC-2');
  const expired = await call(state.ctx, 'GET', `/api/morning/invitations/feedback/${encodeURIComponent(token)}`);
  assert.equal(expired.status, 410);
  assert.equal(expired.payload.code, 'invite_expired');
  assert.equal(state.invitations[0].状态, MORNING_INVITE_STATUS.SENT);
});

for (const decision of ['accept', 'reject']) {
 test(`invitation ${decision} hides contact until accepted and cannot be reversed`, async () => {
  const state = fixture();
  const delivered = new Set();
  const send = state.ctx.sendMail;
  state.ctx.sendMail = async message => {
   if (delivered.has(message.idempotencyKey)) return { ok: true, skipped: true };
   delivered.add(message.idempotencyKey); return send(message);
  };
  await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations');
  assert.equal(state.mails[0].subject, '南大红会·早安晚安：您有新的好友邀约');
  assert.ok(!state.mails[0].text.includes('inviter@smail.nju.edu.cn'));
  assert.equal((state.mails[0].text.match(/https?:/g) || []).length, 1);
  const token = new URL(state.mails[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  const path = `/api/morning/invitations/feedback/${encodeURIComponent(token)}`;
  state.setActor('ACC-2');
  const before = await call(state.ctx, 'GET', path);
  assert.equal(before.payload.invitation.card.nickname, '发起者');
  assert.ok(!JSON.stringify(before.payload).includes('inviter@smail.nju.edu.cn'));
  assert.equal((await call(state.ctx, 'POST', path, {})).status, 400);
  const result = await call(state.ctx, 'POST', path, { decision });
  assert.equal(result.status, 200);
  assert.equal(Boolean(result.payload.invitation.inviterEmail), decision === 'accept');
  assert.equal(state.mails.length, 2);
  assert.equal(state.mails[1].to, 'inviter@smail.nju.edu.cn');
  assert.ok(state.mails[1].text.includes('南京大学红十字会'));
  assert.ok(state.mails[1].subject.includes(decision === 'accept' ? '已被同意' : '已被拒绝'));
  await call(state.ctx, 'POST', path, { decision });
  assert.equal(state.mails.length, 2);
  assert.equal((await call(state.ctx, 'POST', path, { decision: decision === 'accept' ? 'reject' : 'accept' })).status, 409);
  const after = await call(state.ctx, 'GET', path);
  assert.equal(Boolean(after.payload.invitation.inviterEmail), decision === 'accept');
  const admin = await call(state.ctx, 'GET', '/api/community/morning/invitations');
  assert.equal(admin.payload.stats.success, decision === 'accept' ? 1 : 0);
 });
}

test('concurrent accept and reject save only one decision and unavailable cards cannot reveal contact', async () => {
 const state = fixture();
 await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations');
 const token = new URL(state.mails[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
 const path = `/api/morning/invitations/feedback/${encodeURIComponent(token)}`;
 state.setActor('ACC-2');
 const results = await Promise.all(['accept', 'reject'].map(decision => call(state.ctx, 'POST', path, { decision })));
 assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
 assert.equal(state.mails.length, 2);
 const other = fixture();
 await call(other.ctx, 'POST', '/api/morning/cards/MNG-2/invitations');
 const otherToken = new URL(other.mails[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
 other.setActor('ACC-2'); other.cards[0].审核状态 = MORNING_CARD_STATUS.WITHDRAWN;
 const blocked = await call(other.ctx, 'POST', `/api/morning/invitations/feedback/${encodeURIComponent(otherToken)}`, { decision: 'accept' });
 assert.equal(blocked.status, 409);
 assert.ok(!JSON.stringify(blocked.payload).includes('inviter@smail.nju.edu.cn'));
 assert.equal(other.mails.length, 1);
});
