import { randomBytes } from 'node:crypto';
import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  MORNING_COMMENT_MAX_LENGTH,
  MORNING_COMMENT_REPORT_REASON_MAX_LENGTH,
  MORNING_COMMENT_REPORT_STATUS,
  MORNING_COMMENT_TABLE,
  MORNING_PLAZA_API_PATH,
  isActiveMorningCardStatus,
  normalizeMorningCardStatus,
  text,
  withMorningCardLock,
} from './shared.js';

const MORNING_COMMENT_PREFIX = `${MORNING_PLAZA_API_PATH}/`;
export { MORNING_COMMENT_MAX_LENGTH, MORNING_COMMENT_TABLE } from './shared.js';

function truthyFlag(value) {
  return value === true || ['true', '是', '1'].includes(text(value).toLowerCase());
}

function flagValue(value) {
  return value ? '是' : '否';
}

function commentId() {
  return `MNG-CMT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function cleanComment(value) {
  const raw = text(value);
  if (!raw) throw Object.assign(new Error('评论内容不能为空。'), { code: 'comment_required', statusCode: 400 });
  if (raw.length > MORNING_COMMENT_MAX_LENGTH) {
    throw Object.assign(new Error(`评论不能超过 ${MORNING_COMMENT_MAX_LENGTH} 字。`), { code: 'comment_too_long', statusCode: 400 });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) {
    throw Object.assign(new Error('评论包含不支持的控制字符。'), { code: 'invalid_comment', statusCode: 400 });
  }
  return raw;
}

function cleanReportReason(value) {
  const raw = text(value);
  if (!raw) {
    throw Object.assign(new Error('举报原因不能为空。'), { code: 'report_reason_required', statusCode: 400 });
  }
  if (raw.length > MORNING_COMMENT_REPORT_REASON_MAX_LENGTH) {
    throw Object.assign(new Error(`举报原因不能超过 ${MORNING_COMMENT_REPORT_REASON_MAX_LENGTH} 字。`), {
      code: 'report_reason_too_long',
      statusCode: 400,
    });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) {
    throw Object.assign(new Error('举报原因包含不支持的控制字符。'), { code: 'invalid_report_reason', statusCode: 400 });
  }
  return raw;
}

function optionalContact(value, label, max = 60) {
  const raw = text(value);
  if (!raw) return '';
  if (raw.length > max) {
    throw Object.assign(new Error(`${label}不能超过 ${max} 字。`), { code: 'contact_too_long', statusCode: 400 });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) {
    throw Object.assign(new Error(`${label}包含不支持的控制字符。`), { code: 'invalid_contact', statusCode: 400 });
  }
  return raw;
}

export function toMorningCommentView(row) {
  return {
    id: text(row?.['评论ID']),
    content: text(row?.['内容']),
    createdAt: row?.['创建时间'] || null,
  };
}

export function toMorningOwnerCommentView(row, viewerAccountId) {
  const reportStatus = text(row?.['举报状态']);
  return {
    ...toMorningCommentView(row),
    status: text(row?.['状态']) || '可见',
    reportStatus,
    canReport: (text(row?.['状态']) || '可见') === '可见'
      && !reportStatus
      && String(row?.['评论人账号ID'] || '') !== String(viewerAccountId || ''),
  };
}

function findPublishedOther(rows, accountId, cardId) {
  return rows.find((row) => String(row['名片ID'] || '') === cardId
    && String(row['账号ID'] || '') !== accountId
    && normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED);
}

function isVisibleComment(row) {
  return (text(row?.['状态']) || '可见') === '可见';
}

function selectedContactLines(account, body) {
  const lines = [];
  if (body.shareStudentId && text(account?.studentId)) lines.push(`学号：${text(account.studentId)}`);
  if (body.shareEmail && text(account?.email)) lines.push(`邮箱：${text(account.email)}`);
  if (body.shareQq) {
    const qq = text(body.qq) || text(account?.qq);
    if (qq) lines.push(`QQ：${qq}`);
  }
  if (body.shareWechat) {
    const wechat = text(body.wechat) || text(account?.wechat);
    if (wechat) lines.push(`微信：${wechat}`);
  }
  return lines;
}

async function reportMorningComment(req, res, { cardId, commentId, ctx, session, client, accountId }) {
  ctx.enforcePublicLimit(req, 'morning-comment-report', 20, accountId);
  let body;
  try {
    body = await ctx.readJsonObject(req);
  } catch (error) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_body', message: error.message || '请求体格式不正确。' });
  }

  let reason;
  try {
    reason = cleanReportReason(body.reason);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_report_reason', message: error.message });
  }

  const outcome = await withMorningCardLock(accountId, async () => {
    const [cards, comments] = await Promise.all([
      ctx.listRows(client, MORNING_CARD_TABLE),
      ctx.listRows(client, MORNING_COMMENT_TABLE),
    ]);
    ctx.assertCompleteRows(cards);
    ctx.assertCompleteRows(comments);
    const ownCard = cards.find((row) => String(row['账号ID'] || '') === accountId
      && isActiveMorningCardStatus(row['审核状态']));
    if (!ownCard) {
      return { statusCode: 403, payload: { ok: false, code: 'morning_card_required', message: '只有报名用户可以举报自己名片的评论。' } };
    }
    if (String(ownCard['名片ID'] || '') !== cardId) {
      return { statusCode: 403, payload: { ok: false, code: 'not_card_owner', message: '只能举报自己名片收到的评论。' } };
    }
    const target = comments.find((row) => String(row['名片ID'] || '') === cardId
      && String(row['评论ID'] || '') === commentId);
    if (!target) {
      return { statusCode: 404, payload: { ok: false, code: 'comment_not_found', message: '评论不存在。' } };
    }
    if (String(target['评论人账号ID'] || '') === accountId) {
      return { statusCode: 409, payload: { ok: false, code: 'cannot_report_own_comment', message: '不能举报自己发表的评论。' } };
    }
    if (text(target['举报状态'])) {
      return { statusCode: 409, payload: { ok: false, code: 'comment_already_reported', message: '这条评论已经举报过。' } };
    }
    if (!isVisibleComment(target)) {
      return { statusCode: 409, payload: { ok: false, code: 'comment_not_reportable', message: '这条评论当前不能举报。' } };
    }

    const now = new Date().toISOString();
    const patch = {
      状态: '已举报',
      举报状态: MORNING_COMMENT_REPORT_STATUS.PENDING,
      举报人账号ID: accountId,
      举报原因: reason,
      举报时间: now,
      更新时间: now,
    };
    await client.updateRow(MORNING_COMMENT_TABLE, target._id, patch);
    await ctx.recordAudit(req, session, 'morning.comment.report', commentId, 'success', {
      cardId,
      reportedAccountId: String(target['评论人账号ID'] || ''),
      reasonLength: reason.length,
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        comment: toMorningOwnerCommentView({ ...target, ...patch }, accountId),
        message: '举报已提交；该评论已退出公开列表，等待管理员处理。',
      },
    };
  });
  return ctx.json(res, outcome.statusCode, outcome.payload);
}

export async function morningCommentRoutes(req, res, url, ctx) {
  if (!url.pathname.startsWith(MORNING_COMMENT_PREFIX)) return false;
  const commentsMatch = url.pathname.match(/^\/api\/morning\/cards\/([^/]+)\/comments$/);
  const reportMatch = url.pathname.match(/^\/api\/morning\/cards\/([^/]+)\/comments\/([^/]+)\/report$/);
  if (!commentsMatch && !reportMatch) return false;
  if (reportMatch && req.method !== 'POST') return false;
  if (commentsMatch && !['GET', 'POST'].includes(req.method)) return false;

  const session = req.method === 'GET'
    ? ctx.requirePortalSession(req, res)
    : ctx.requirePortalWrite(req, res);
  if (!session) return true;

  const cardId = decodeURIComponent((commentsMatch || reportMatch)[1]);
  const accountId = ctx.actor(session);
  const client = await ctx.getBase();
  if (reportMatch) {
    return reportMorningComment(req, res, {
      cardId,
      commentId: decodeURIComponent(reportMatch[2]),
      ctx,
      session,
      client,
      accountId,
    });
  }

  const [cards, comments] = await Promise.all([
    ctx.listRows(client, MORNING_CARD_TABLE),
    ctx.listRows(client, MORNING_COMMENT_TABLE),
  ]);
  ctx.assertCompleteRows(cards);
  ctx.assertCompleteRows(comments);

  const ownCard = cards.find((row) => String(row['账号ID'] || '') === accountId
    && isActiveMorningCardStatus(row['审核状态']));
  if (!ownCard) {
    return ctx.json(res, 403, {
      ok: false,
      code: 'morning_card_required',
      message: '先完成早安晚安报名，才能评论。',
    });
  }
  const ownerView = String(ownCard['名片ID'] || '') === cardId;
  const card = ownerView ? ownCard : findPublishedOther(cards, accountId, cardId);
  if (!card) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在或尚未通过审核。' });

  const rowsForCard = comments.filter((row) => String(row['名片ID'] || '') === cardId);
  if (req.method === 'GET') {
    const cardComments = rowsForCard
      .filter((row) => ownerView ? text(row['状态']) !== '已删除' : isVisibleComment(row))
      .map((row) => ownerView ? toMorningOwnerCommentView(row, accountId) : toMorningCommentView(row))
      .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
    return ctx.json(res, 200, {
      ok: true,
      viewer: ownerView ? 'owner' : 'member',
      comments: cardComments,
      total: cardComments.length,
    });
  }

  ctx.enforcePublicLimit(req, 'morning-comment', 20, accountId);
  let body;
  try {
    body = await ctx.readJsonObject(req);
  } catch (error) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_body', message: error.message || '请求体格式不正确。' });
  }

  let content;
  try {
    content = cleanComment(body.content);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_comment', message: error.message });
  }

  const sendEmail = body.sendEmail === true;
  const shareStudentId = sendEmail && body.shareStudentId === true;
  const shareEmail = sendEmail && body.shareEmail === true;
  const shareQq = sendEmail && body.shareQq === true;
  const shareWechat = sendEmail && body.shareWechat === true;
  let qq = '';
  let wechat = '';
  try {
    qq = optionalContact(body.qq, 'QQ', 40);
    wechat = optionalContact(body.wechat, '微信', 60);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_contact', message: error.message });
  }
  const now = new Date().toISOString();
  const id = commentId();
  const row = {
    评论ID: id,
    名片ID: cardId,
    评论人账号ID: accountId,
    内容: content,
    状态: '可见',
    是否发邮件: flagValue(sendEmail),
    公开学号: flagValue(shareStudentId),
    公开邮箱: flagValue(shareEmail),
    公开QQ: flagValue(shareQq),
    公开微信: flagValue(shareWechat),
    举报状态: '',
    举报人账号ID: '',
    举报原因: '',
    举报时间: '',
    处理人: '',
    处理时间: '',
    处理意见: '',
    创建时间: now,
    更新时间: now,
  };
  await client.appendRow(MORNING_COMMENT_TABLE, row);

  let notified = { ok: false, skipped: true };
  let ownerEmail = '';
  if (sendEmail) {
    const owner = ctx.accountForRef(card['账号ID']);
    ownerEmail = text(owner?.email);
    const ownerAllowsEmail = card['允许评论邮件'] !== '否';
    const commenter = ctx.accountForRef(accountId);
    if (ownerAllowsEmail) {
      const contactLines = selectedContactLines(commenter, {
        shareStudentId,
        shareEmail,
        shareQq,
        shareWechat,
        qq,
        wechat,
      });
      const contactText = contactLines.length
        ? `\n\n对方选择向你提供：\n${contactLines.join('\n')}`
        : '';
      notified = await ctx.sendMail({
        to: ownerEmail,
        subject: '你的早安晚安名片收到一条评论',
        text: `有人给你写了一条评论：\n\n${content}${contactText}\n\n你可以回到平台的早安晚安同行广场查看。\n\n南京大学红十字会`,
        kind: 'morning-comment',
        idempotencyKey: `MORNING-COMMENT:${id}`,
      });
    }
  }

  await ctx.recordAudit(req, session, 'morning.comment.create', id, 'success', {
    cardId,
    emailRequested: sendEmail,
    notified: notified.ok,
    shareStudentId,
    shareEmail,
    shareQq,
    shareWechat,
  });
  return ctx.json(res, 201, {
    ok: true,
    comment: toMorningCommentView(row),
    notified: notified.ok,
    message: sendEmail
      ? (card['允许评论邮件'] === '否'
          ? '评论已发布；对方已关闭邮件通知。'
          : notified.ok
            ? '评论已发布，邮件已发送。'
            : ownerEmail ? '评论已发布；邮件暂时未发送成功。' : '评论已发布；对方暂未绑定账号邮箱，未发送邮件。')
      : '评论已发布。',
  });
}
