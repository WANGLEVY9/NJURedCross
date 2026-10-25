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
import { MORNING_COORDINATORS, readMorningInviteCoordinators } from '../lib/morning/coordinators.js';

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
  assert.match(state.mails[0].text, /https:\/\/platform\.example\/morning\/plaza\?card=/);
  assert.doesNotMatch(state.mails[0].text, /attacker\.example/);
});

test('friend invitation sends a direct profile link and three-day feedback link, then records success', async () => {
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
  assert.match(state.mails[0].text, /对方主页：https:\/\/example\.test\/morning\/plaza\?card=MNG-1(?:\n|$)/);
  assert.match(state.mails[0].text, /反馈链接：https:\/\/example\.test\/morning\/invite-feedback\?token=/);
  assert.match(state.mails[0].text, /个人主页可登录浏览；反馈链接有效期为 3 天/);

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
  assert.ok(details.payload.invitation.createdAt);

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

test('feedback reuses the locked invitation row for chair notification status', async () => {
  const state = fixture();
  await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations', { message: '' });
  const feedbackUrl = state.mails[0].text.match(/反馈链接：(https:\/\/\S+)/)?.[1];
  const token = new URL(feedbackUrl).searchParams.get('token');
  state.setActor('ACC-2');
  state.resetInvitationReads();
  const confirmed = await call(
    state.ctx,
    'POST',
    `/api/morning/invitations/feedback/${encodeURIComponent(token)}`,
    {},
  );
  assert.equal(confirmed.status, 200);
  assert.equal(state.invitationReads(), 2, 'token lookup and lock refresh only');
  assert.equal(state.invitations[0].协调人通知状态, '已发送');
});

test('feedback sends only to the fixed roster group for the inviter campus and ignores caller recipients', async () => {
  for (const [campus, region] of [['仙林', 'nanjing'], ['苏州', 'suzhou']]) {
    const state = fixture();
    state.cards[0].校区 = campus;
    const rows = MORNING_COORDINATORS[region].map((person, index) => ({
      _id: person.rowId, 姓名: person.name, 邮箱: `synthetic-${region}-${index}@smail.nju.edu.cn`,
    }));
    let resolutions = 0;
    state.ctx.resolveInviteCoordinators = async selectedCampus => {
      resolutions++;
      assert.equal(selectedCampus, campus);
      return readMorningInviteCoordinators({ query: async () => rows }, selectedCampus);
    };
    await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations');
    const feedbackUrl = state.mails[0].text.match(/反馈链接：(https:\/\/\S+)/)[1];
    const path = `/api/morning/invitations/feedback/${encodeURIComponent(new URL(feedbackUrl).searchParams.get('token'))}`;
    state.setActor('ACC-2');
    assert.equal((await call(state.ctx, 'POST', path, { to: 'attacker@example.test', campus: '未知' })).status, 200);
    assert.equal(state.mails[1].to, rows.map(row => row.邮箱).join(','));
    assert.equal((await call(state.ctx, 'POST', path)).payload.alreadyReported, true);
    assert.equal(resolutions, 1);
    assert.equal(state.mails.length, 2);
  }
});

test('unavailable coordinators leave feedback pending and send no notification', async () => {
  for (const resolver of [undefined, async () => [], async () => { throw Object.assign(Error('unavailable'), { statusCode: 503 }); }]) {
    const state = fixture();
    await call(state.ctx, 'POST', '/api/morning/cards/MNG-2/invitations');
    const feedbackUrl = state.mails[0].text.match(/反馈链接：(https:\/\/\S+)/)[1];
    state.setActor('ACC-2');
    state.ctx.resolveInviteCoordinators = resolver;
    await assert.rejects(call(state.ctx, 'POST', `/api/morning/invitations/feedback/${encodeURIComponent(new URL(feedbackUrl).searchParams.get('token'))}`), { statusCode: 503 });
    assert.equal(state.invitations[0].状态, MORNING_INVITE_STATUS.SENT);
    assert.equal(state.invitations[0].反馈时间, '');
    assert.equal(state.mails.length, 1);
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
  const feedbackUrl = state.mails[0].text.match(/反馈链接：(https:\/\/\S+)/)?.[1];
  const token = new URL(feedbackUrl).searchParams.get('token');
  state.invitations[0].过期时间 = '2020-01-01T00:00:00.000Z';
  state.setActor('ACC-2');
  const expired = await call(state.ctx, 'GET', `/api/morning/invitations/feedback/${encodeURIComponent(token)}`);
  assert.equal(expired.status, 410);
  assert.equal(expired.payload.code, 'invite_expired');
  assert.equal(state.invitations[0].状态, MORNING_INVITE_STATUS.SENT);
});
