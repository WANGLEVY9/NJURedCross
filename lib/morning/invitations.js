import { toMorningPlazaDetailView } from './plaza.js';
import { readCommunityRows } from '../community/scoped-rows.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  MORNING_INVITE_MESSAGE_MAX_LENGTH,
  MORNING_INVITE_STATUS,
  MORNING_INVITE_TABLE,
  MORNING_INVITE_TTL_MS,
  isPublishedMorningCardStatus,
  normalizeMorningCardStatus,
  text,
  withMorningCardLocks,
} from './shared.js';

export const MORNING_INVITE_API_PATH = '/api/morning/invitations';
export const MORNING_INVITE_ADMIN_PATH = '/api/community/morning/invitations';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('base64url');
}

function signature(payload, secret) {
  return createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

export function createInvitationToken({ invitationId, expiresAt, secret }) {
  const payload = base64url(JSON.stringify({
    v: 1,
    id: String(invitationId),
    exp: Date.parse(String(expiresAt)),
  }));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyInvitationToken(token, secret, now = Date.now()) {
  const [payload, suppliedSignature, ...rest] = text(token).split('.');
  if (!payload || !suppliedSignature || rest.length) return null;
  const expected = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims?.v !== 1 || !text(claims.id) || !Number.isFinite(claims.exp) || claims.exp <= now) return null;
    return { invitationId: text(claims.id), expiresAt: claims.exp };
  } catch {
    return null;
  }
}

export function invitationTokenHash(token) {
  return digest(token);
}

function invitationId() {
  return `MNG-INV-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function maskEmail(value) {
  const email = text(value);
  const [local, domain] = email.split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 2)}***@${domain}`;
}

function cleanInviteMessage(value) {
  const message = text(value);
  if (message.length > MORNING_INVITE_MESSAGE_MAX_LENGTH) {
    throw Object.assign(new Error(`邀约附言不能超过 ${MORNING_INVITE_MESSAGE_MAX_LENGTH} 字。`), {
      code: 'invite_message_too_long',
      statusCode: 400,
    });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) {
    throw Object.assign(new Error('邀约附言包含不支持的控制字符。'), {
      code: 'invalid_invite_message',
      statusCode: 400,
    });
  }
  return message;
}

function normalizeBaseUrl(value) {
  const configured = text(value);
  if (!configured) throw new Error('PUBLIC_BASE_URL is required for invitation links');
  return configured.replace(/\/$/, '');
}

function statusOf(row, now = Date.now()) {
  if ([MORNING_INVITE_STATUS.FEEDBACK, MORNING_INVITE_STATUS.REJECTED].includes(text(row?.['状态']))) return text(row['状态']);
  const expires = Date.parse(String(row?.['过期时间'] || ''));
  return Number.isFinite(expires) && expires <= now
    ? MORNING_INVITE_STATUS.EXPIRED
    : MORNING_INVITE_STATUS.SENT;
}

export function toMorningInvitationView(row, { now = Date.now() } = {}) {
  return {
    id: text(row?.['邀约ID']),
    cardId: text(row?.['名片ID']),
    inviterCampus: text(row?.['发起人校区']),
    inviterAccountId: text(row?.['发起人账号ID']),
    inviterNickname: text(row?.['发起人昵称']),
    inviterEmail: maskEmail(row?.['发起人邮箱']),
    recipientAccountId: text(row?.['收件人账号ID']),
    recipientNickname: text(row?.['收件人昵称']),
    recipientEmail: maskEmail(row?.['收件人邮箱']),
    message: text(row?.['邀约附言']),
    status: statusOf(row, now),
    mailStatus: text(row?.['邮件状态']),
    expiresAt: row?.['过期时间'] || null,
    feedbackAt: row?.['反馈时间'] || null,
    coordinatorNotifyStatus: text(row?.['协调人通知状态']),
    createdAt: row?.['创建时间'] || null,
  };
}

function publishedCardForAccount(cards, accountId) {
  return cards.find((row) => String(row['账号ID'] || '') === String(accountId)
    && isPublishedMorningCardStatus(row['审核状态']));
}

function publishedOtherCard(cards, accountId, cardId) {
  return cards.find((row) => String(row['名片ID'] || '') === String(cardId)
    && String(row['账号ID'] || '') !== String(accountId)
    && normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED);
}

async function createInvitation(req, res, cardId, ctx, session) {
  ctx.enforcePublicLimit(req, 'morning-invite', 10, ctx.actor(session));
  let body;
  try {
    body = await ctx.readJsonObject(req);
  } catch (error) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_body', message: error.message || '请求体格式不正确。' });
  }
  let message;
  try {
    message = cleanInviteMessage(body.message);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_invite_message', message: error.message });
  }

  const actorId = ctx.actor(session);
  const client = await ctx.getBase();
  const cards = await readCommunityRows(client, MORNING_CARD_TABLE, [{ 账号ID: actorId }, { 名片ID: cardId }], ctx.listRows);
  ctx.assertCompleteRows(cards);
  const inviter = publishedCardForAccount(cards, actorId);
  if (!inviter) {
    return ctx.json(res, 403, { ok: false, code: 'morning_card_required', message: '先完成早安晚安报名并发布名片，才能发起邀约。' });
  }
  const target = publishedOtherCard(cards, actorId, cardId);
  if (!target) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在或尚未通过审核。' });

  const [inviterAccount, recipientAccount] = await Promise.all([
    ctx.accountForRef(actorId),
    ctx.accountForRef(target['账号ID']),
  ]);
  const recipientEmail = text(recipientAccount?.email);
  const inviterEmail = text(inviterAccount?.email);
  if (!recipientEmail) {
    return ctx.json(res, 409, { ok: false, code: 'recipient_email_missing', message: '对方账号暂未绑定可用于接收邀约的邮箱。' });
  }
  if (!inviterEmail) {
    return ctx.json(res, 409, { ok: false, code: 'inviter_email_missing', message: '你的账号暂未绑定邮箱，暂时不能发出邀约。' });
  }

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + MORNING_INVITE_TTL_MS).toISOString();
  const id = invitationId();
  const inviterCardId = text(inviter['名片ID']);
  const token = createInvitationToken({
    invitationId: id,
    expiresAt,
    secret: ctx.inviteSecret,
  });
  const baseUrl = normalizeBaseUrl(ctx.publicBaseUrl);
  const feedbackUrl = `${baseUrl}/morning/invite-feedback?token=${encodeURIComponent(token)}`;
  const row = {
    邀约ID: id,
    名片ID: inviterCardId,
    发起人校区: text(inviter['校区']),
    发起人账号ID: actorId,
    发起人昵称: text(inviter['昵称']),
    发起人邮箱: inviterEmail,
    收件人账号ID: text(target['账号ID']),
    收件人昵称: text(target['昵称']),
    收件人邮箱: recipientEmail,
    邀约附言: message,
    状态: MORNING_INVITE_STATUS.SENT,
    邮件状态: '待发送',
    反馈令牌哈希: invitationTokenHash(token),
    过期时间: expiresAt,
    反馈时间: '',
    反馈人账号ID: '',
    协调人通知状态: '',
    创建时间: createdAt,
    更新时间: createdAt,
  };
  const saved = await client.appendRow(MORNING_INVITE_TABLE, row);

  const mail = await ctx.sendMail({
    to: recipientEmail,
    subject: '南大红会·早安晚安：您有新的好友邀约',
    text: [
      `亲爱的${text(target['昵称']) || '同学'}：`,
      '',
      '您好！这里是南京大学红十字会「早安晚安」板块，我们希望通过同行名片，帮助同学认识志趣相投的伙伴。',
      `${text(inviter['昵称']) || '一位同学'}向您发起了好友邀约。`,
      `邀约附言：${message || '对方没有填写邀约附言。'}`,
      '',
      '请登录收到本邮件的账号，通过下方链接查看对方的早安晚安名片，并选择同意或拒绝邀约。',
      `查看并处理邀约：${feedbackUrl}`,
      '',
      '同意后，平台才会向您展示对方的邮箱，并自动记录成功结识；拒绝后不会展示邮箱。两种选择均会通知发起人。',
      '邀约处理链接有效期为 3 天，请按自己的意愿决定。',
      '',
      '南京大学红十字会',
    ].join('\n'),
    kind: 'morning-invitation',
    idempotencyKey: `MORNING-INVITE:${id}`,
  }).catch(() => ({ ok: false }));
  const mailStatus = mail?.ok ? '已发送' : '发送失败';
  if (saved?._id) await client.updateRow(MORNING_INVITE_TABLE, saved._id, {
    邮件状态: mailStatus,
    更新时间: new Date().toISOString(),
  });
  await ctx.recordAudit(req, session, 'morning.invitation.create', id, 'success', {
    cardId,
    recipientAccountId: row.收件人账号ID,
    messageLength: message.length,
    mailSent: Boolean(mail?.ok),
  });
  return ctx.json(res, 201, {
    ok: true,
    invitation: toMorningInvitationView({ ...row, 邮件状态: mailStatus }),
    message: mail?.ok ? '邀约邮件已发送。' : '邀约已记录，但邮件暂时未发送成功。',
  });
}

async function invitationForToken(client, token, ctx) {
  if (!text(ctx.inviteSecret)) return { error: 'invite_secret_missing' };
  const claims = verifyInvitationToken(token, ctx.inviteSecret);
  if (!claims) return { error: 'invite_link_invalid' };
  const rows = await readCommunityRows(client, MORNING_INVITE_TABLE, { 邀约ID: claims.invitationId }, ctx.listRows);
  ctx.assertCompleteRows(rows);
  const row = rows.find((item) => text(item['邀约ID']) === claims.invitationId
    && text(item['反馈令牌哈希']) === invitationTokenHash(token));
  if (!row) return { error: 'invite_link_invalid' };
  return { row };
}

async function notifyInvitationDecision(row, ctx) {
  try {
    const account = await ctx.accountForRef(text(row['发起人账号ID']));
    if (!text(account?.email)) return;
    const accepted = row['状态'] === MORNING_INVITE_STATUS.FEEDBACK;
    await ctx.sendMail({ to: text(account.email),
      subject: `南大红会·早安晚安：您的好友邀约${accepted ? '已被同意' : '已被拒绝'}`,
      text: `您好！这里是南京大学红十字会「早安晚安」板块。\n\n您向「${text(row['收件人昵称']) || '一位同学'}」发出的好友邀约${accepted ? '已被同意。平台已记录双方成功结识，对方现在可以查看您的邮箱并与您联系。' : '已被拒绝。请尊重对方的选择，也愿您在同行广场遇到合适的伙伴。'}\n\n邀约编号：${text(row['邀约ID'])}\n\n感谢您参与南大红会早安晚安，愿每一份善意都得到温柔回应。\n\n南京大学红十字会`,
      kind: 'community-notification', idempotencyKey: `MORNING-INVITE-DECISION:${text(row['邀约ID'])}`,
    }, { renderTemplate: false });
  } catch { /* Notification failure does not undo the saved decision. */ }
}

async function invitationFeedback(req, res, token, ctx, session, { confirm }) {
  const client = await ctx.getBase();
  const found = await invitationForToken(client, token, ctx);
  if (found.error) {
    return ctx.json(res, 410, { ok: false, code: found.error, message: '邀约链接无效或已过期。' });
  }
  const row = found.row;
  const accountId = ctx.actor(session);
  ctx.enforcePublicLimit(req, confirm ? 'morning-invite-feedback' : 'morning-invite-feedback-read', confirm ? 20 : 60, accountId);
  if (text(row['收件人账号ID']) !== accountId) {
    return ctx.json(res, 403, { ok: false, code: 'invite_recipient_mismatch', message: '该邀约不属于当前登录账号。' });
  }
  const currentStatus = statusOf(row);
  if (currentStatus === MORNING_INVITE_STATUS.EXPIRED) {
    return ctx.json(res, 410, { ok: false, code: 'invite_expired', message: '该邀约链接已超过 3 天有效期。' });
  }
  const cards = await readCommunityRows(client, MORNING_CARD_TABLE, [{ 账号ID: accountId }, { 名片ID: text(row['名片ID']) }], ctx.listRows);
  ctx.assertCompleteRows(cards);
  const ownCard = publishedCardForAccount(cards, accountId);
  const view = {
    id: text(row['邀约ID']),
    cardId: text(row['名片ID']),
    inviterNickname: text(row['发起人昵称']),
    recipientNickname: text(ownCard?.['昵称']) || text(row['收件人昵称']),
    message: text(row['邀约附言']),
    status: currentStatus,
    createdAt: row['创建时间'] || null,
    expiresAt: row['过期时间'] || null,
    feedbackAt: row['反馈时间'] || null,
  };
  const terminal = [MORNING_INVITE_STATUS.FEEDBACK, MORNING_INVITE_STATUS.REJECTED].includes(currentStatus);
  const inviterCard = cards.find(item => text(item['名片ID']) === text(row['名片ID']) && text(item['账号ID']) === text(row['发起人账号ID']));
  if (!inviterCard || !isPublishedMorningCardStatus(inviterCard['审核状态'])) return ctx.json(res, 409, { ok: false, message: '对方名片暂不可用。' });
  view.card = toMorningPlazaDetailView(inviterCard);
  if (currentStatus === MORNING_INVITE_STATUS.FEEDBACK) view.inviterEmail = text(row['发起人邮箱']);
  if (!confirm) return ctx.json(res, 200, { ok: true, invitation: view });
  let body;
  try { body = await ctx.readJsonObject(req); }
  catch { return ctx.json(res, 400, { ok: false, message: '请求体格式不正确。' }); }
  const decision = body.decision;
  if (!['accept', 'reject'].includes(decision)) return ctx.json(res, 400, { ok: false, message: '请选择同意或拒绝邀约。' });
  const nextStatus = decision === 'accept' ? MORNING_INVITE_STATUS.FEEDBACK : MORNING_INVITE_STATUS.REJECTED;
  if (terminal) {
    if (currentStatus !== nextStatus) return ctx.json(res, 409, { ok: false, message: '邀约已处理，不能更改选择。' });
    await notifyInvitationDecision(row, ctx);
    return ctx.json(res, 200, { ok: true, alreadyReported: true, invitation: view, message: '该邀约结果已经记录。' });
  }
  const now = new Date().toISOString();
  try {
    await withMorningCardLocks([accountId, text(row['发起人账号ID'])], async () => {
      const freshRows = await readCommunityRows(client, MORNING_INVITE_TABLE, { 邀约ID: text(row['邀约ID']) }, ctx.listRows);
      ctx.assertCompleteRows(freshRows);
      const fresh = freshRows.find((item) => text(item['邀约ID']) === text(row['邀约ID']));
      if (!fresh || statusOf(fresh) !== MORNING_INVITE_STATUS.SENT) {
        throw Object.assign(new Error('邀约状态已变化，请刷新后重试。'), { statusCode: 409 });
      }
      const freshCards = await readCommunityRows(client, MORNING_CARD_TABLE, { 名片ID: text(fresh['名片ID']) }, ctx.listRows);
      ctx.assertCompleteRows(freshCards);
      if (!freshCards.some(card => text(card['名片ID']) === text(fresh['名片ID']) && text(card['账号ID']) === text(fresh['发起人账号ID']) && isPublishedMorningCardStatus(card['审核状态']))) throw Object.assign(new Error('对方名片暂不可用。'), { statusCode: 409 });
      await client.updateRow(MORNING_INVITE_TABLE, fresh._id, {
        状态: nextStatus,
        反馈时间: now,
        反馈人账号ID: accountId,
        更新时间: now,
      });
    });
  } catch (error) {
    if (error?.statusCode) {
      return ctx.json(res, error.statusCode, { ok: false, code: 'invite_state_changed', message: error.message });
    }
    throw error;
  }

  await ctx.recordAudit(req, session, 'morning.invitation.feedback', view.id, 'success', {
    inviterAccountId: text(row['发起人账号ID']), decision,
  });
  await notifyInvitationDecision({ ...row, 状态: nextStatus, 反馈时间: now }, ctx);
  return ctx.json(res, 200, {
    ok: true,
    invitation: {
      ...view,
      status: nextStatus,
      ...(decision === 'accept' ? { inviterEmail: text(row['发起人邮箱']) } : {}),
      feedbackAt: now,
      recipientNickname: view.recipientNickname,
      inviterNickname: view.inviterNickname,
    },
    message: decision === 'accept' ? '已同意邀约，并自动记录成功结识。' : '已拒绝邀约。',
  });
}

async function listInvitations(req, res, ctx) {
  const session = ctx.requireConsoleAccess(req, res, 'community');
  if (!session) return true;
  const rows = await ctx.listRows(await ctx.getBase(), MORNING_INVITE_TABLE);
  ctx.assertCompleteRows(rows);
  const now = Date.now();
  const views = rows.map((row) => toMorningInvitationView(row, { now }))
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  const success = views.filter((item) => item.status === MORNING_INVITE_STATUS.FEEDBACK).length;
  return ctx.json(res, 200, {
    ok: true,
    stats: {
      total: views.length,
      sent: views.filter((item) => item.status === MORNING_INVITE_STATUS.SENT).length,
      success,
      expired: views.filter((item) => item.status === MORNING_INVITE_STATUS.EXPIRED).length,
      successRate: views.length ? Math.round((success / views.length) * 100) : 0,
    },
    invitations: views.slice(0, 100),
  });
}

export async function morningInvitationRoutes(req, res, url, ctx) {
  if (url.pathname === MORNING_INVITE_ADMIN_PATH && req.method === 'GET') {
    return listInvitations(req, res, ctx);
  }

  const createMatch = url.pathname.match(/^\/api\/morning\/cards\/([^/]+)\/invitations$/);
  if (createMatch && req.method === 'POST') {
    const session = ctx.requirePortalWrite(req, res);
    if (!session) return true;
    return createInvitation(req, res, decodeURIComponent(createMatch[1]), ctx, session);
  }

  const feedbackMatch = url.pathname.match(/^\/api\/morning\/invitations\/feedback\/([^/]+)$/);
  if (feedbackMatch && ['GET', 'POST'].includes(req.method)) {
    const session = req.method === 'GET'
      ? ctx.requirePortalSession(req, res)
      : ctx.requirePortalWrite(req, res);
    if (!session) return true;
    return invitationFeedback(
      req,
      res,
      decodeURIComponent(feedbackMatch[1]),
      ctx,
      session,
      { confirm: req.method === 'POST' },
    );
  }

  return false;
}
