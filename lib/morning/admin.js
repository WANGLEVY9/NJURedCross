import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  normalizeMorningCardStatus,
  toMorningCardView,
} from './api.js';
import {
  MORNING_COMMENT_REPORT_REASON_MAX_LENGTH,
  MORNING_COMMENT_REPORT_STATUS,
  MORNING_COMMENT_TABLE,
  text,
  withMorningCardLock,
} from './shared.js';

export const MORNING_ADMIN_PREFIX = '/api/community/morning/cards';
export const MORNING_REPORTS_PREFIX = '/api/community/morning/reports';
export const MORNING_REVIEW_NOTE_MAX_LENGTH = 300;

const REVIEW_DECISIONS = Object.freeze({
  approve: MORNING_CARD_STATUS.PUBLISHED,
  return: MORNING_CARD_STATUS.RETURNED,
  reject: MORNING_CARD_STATUS.REJECTED,
});

function ownsPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function cleanReviewNote(value) {
  const note = text(value);
  if (note.length > MORNING_REVIEW_NOTE_MAX_LENGTH) {
    throw Object.assign(new Error(`审核意见不能超过 ${MORNING_REVIEW_NOTE_MAX_LENGTH} 字。`), {
      code: 'review_note_too_long',
      statusCode: 400,
    });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)) {
    throw Object.assign(new Error('审核意见包含不支持的控制字符。'), {
      code: 'invalid_review_note',
      statusCode: 400,
    });
  }
  return note;
}

function cleanReportNote(value) {
  const note = text(value);
  if (!note) {
    throw Object.assign(new Error('处理举报必须填写处理意见。'), {
      code: 'report_note_required',
      statusCode: 400,
    });
  }
  if (note.length > MORNING_COMMENT_REPORT_REASON_MAX_LENGTH) {
    throw Object.assign(new Error(`处理意见不能超过 ${MORNING_COMMENT_REPORT_REASON_MAX_LENGTH} 字。`), {
      code: 'report_note_too_long',
      statusCode: 400,
    });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)) {
    throw Object.assign(new Error('处理意见包含不支持的控制字符。'), {
      code: 'invalid_report_note',
      statusCode: 400,
    });
  }
  return note;
}

export function toMorningAdminCardView(row) {
  const card = toMorningCardView(row);
  return {
    ...card,
    status: normalizeMorningCardStatus(row?.['审核状态']),
    reviewedBy: text(row?.['审核人']),
  };
}

export function toMorningAdminCardListItem(row) {
  const card = toMorningAdminCardView(row);
  return {
    id: card.id,
    nickname: card.nickname,
    campus: card.campus,
    interestTags: card.interestTags,
    status: card.status,
    submittedAt: card.submittedAt,
    publishedAt: card.publishedAt,
    reviewedBy: card.reviewedBy,
    reviewedAt: card.reviewedAt,
  };
}

export function summarizeMorningCards(views) {
  const count = (status) => views.filter((item) => item.status === status).length;
  return {
    pending: count(MORNING_CARD_STATUS.PENDING),
    published: count(MORNING_CARD_STATUS.PUBLISHED),
    returned: count(MORNING_CARD_STATUS.RETURNED),
    rejected: count(MORNING_CARD_STATUS.REJECTED),
    exited: count(MORNING_CARD_STATUS.WITHDRAWN),
  };
}

export function summarizeMorningReports(rows) {
  const count = (status) => rows.filter((row) => text(row?.['举报状态']) === status).length;
  return {
    total: rows.length,
    pending: count(MORNING_COMMENT_REPORT_STATUS.PENDING),
    handled: count(MORNING_COMMENT_REPORT_STATUS.RESOLVED),
    dismissed: count(MORNING_COMMENT_REPORT_STATUS.DISMISSED),
  };
}

export function toMorningReportView(row, card = null) {
  return {
    id: text(row?.['评论ID']),
    cardId: text(row?.['名片ID']),
    cardNickname: text(card?.['昵称']),
    content: text(row?.['内容']),
    commentStatus: text(row?.['状态']) || '可见',
    status: text(row?.['举报状态']),
    reason: text(row?.['举报原因']),
    reporterAccountId: text(row?.['举报人账号ID']),
    reportedAccountId: text(row?.['评论人账号ID']),
    submittedAt: row?.['举报时间'] || null,
    handledBy: text(row?.['处理人']),
    handledAt: row?.['处理时间'] || null,
    resolutionNote: text(row?.['处理意见']),
  };
}

export function morningReviewPatch({ currentStatus, decision, note, reviewer, now }) {
  const status = normalizeMorningCardStatus(currentStatus);
  if (status !== MORNING_CARD_STATUS.PENDING) {
    return { error: { statusCode: 409, code: 'card_not_pending', message: '只有「待审核」的名片可以审核。' } };
  }
  if (!Object.hasOwn(REVIEW_DECISIONS, decision)) {
    return { error: { statusCode: 400, code: 'invalid_decision', message: '审核结果必须是 approve、return 或 reject。' } };
  }
  if (decision !== 'approve' && !note) {
    return { error: { statusCode: 400, code: 'review_note_required', message: decision === 'reject' ? '拒绝名片必须填写理由。' : '退回名片必须填写审核意见。' } };
  }
  const patch = {
    审核状态: REVIEW_DECISIONS[decision],
    审核意见: decision === 'approve' ? '' : note,
    审核人: reviewer,
    审核时间: now,
  };
  if (decision === 'approve') patch.发布时间 = now;
  return { patch };
}

function matchesQuery(view, query) {
  if (!query) return true;
  const haystack = [
    view.id,
    view.nickname,
    view.realName,
    view.studentId,
    view.campus,
    ...(view.interestTags || []),
  ].map(text).join('\n').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function cardViewForStorage(row) {
  return toMorningAdminCardView(row);
}

async function listCards(req, res, url, ctx) {
  const rows = await ctx.listRows(await ctx.getBase(), MORNING_CARD_TABLE);
  ctx.assertCompleteRows(rows);
  const active = rows.filter((row) => row['审核状态'] !== MORNING_CARD_STATUS.DELETED);
  const entries = active.map((row) => ({ row, view: cardViewForStorage(row) }));
  const requested = text(url.searchParams.get('status')) || MORNING_CARD_STATUS.PENDING;
  const query = text(url.searchParams.get('q'));
  const filtered = entries
    .filter(({ view }) => requested === '全部' || view.status === requested)
    .filter(({ view }) => matchesQuery(view, query))
    .sort((left, right) => String(right.view.submittedAt || '').localeCompare(String(left.view.submittedAt || '')));
  return ctx.json(res, 200, {
    ok: true,
    source: `seatable:${MORNING_CARD_TABLE}`,
    stats: summarizeMorningCards(entries.map(({ view }) => view)),
    cards: filtered.map(({ row }) => toMorningAdminCardListItem(row)),
  });
}

async function cardDetail(req, res, cardId, ctx) {
  const rows = await ctx.listRows(await ctx.getBase(), MORNING_CARD_TABLE);
  ctx.assertCompleteRows(rows);
  const row = rows.find((item) => String(item['名片ID'] || '') === cardId);
  if (!row) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在。' });
  return ctx.json(res, 200, { ok: true, card: toMorningAdminCardView(row) });
}

async function reviewCard(req, res, cardId, ctx, session) {
  let body;
  try {
    body = await ctx.readJsonObject(req);
  } catch (error) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_body', message: error.message || '请求体格式不正确。' });
  }
  const decision = text(body.decision);
  let note;
  try {
    note = cleanReviewNote(body.note);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_review_note', message: error.message });
  }
  const client = await ctx.getBase();
  const initialRows = await ctx.listRows(client, MORNING_CARD_TABLE);
  ctx.assertCompleteRows(initialRows);
  const initial = initialRows.find((item) => String(item['名片ID'] || '') === cardId);
  if (!initial) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在。' });
  const outcome = await withMorningCardLock(String(initial['账号ID'] || cardId), async () => {
    const rows = await ctx.listRows(client, MORNING_CARD_TABLE);
    ctx.assertCompleteRows(rows);
    const row = rows.find((item) => String(item['名片ID'] || '') === cardId);
    if (!row) return { statusCode: 404, payload: { ok: false, code: 'card_not_found', message: '名片不存在。' } };
    const reviewerRef = ctx.actor(session);
    if (String(row['账号ID'] || '') === reviewerRef && session.role !== 'super_admin') {
      return { statusCode: 409, payload: { ok: false, code: 'self_review_forbidden', message: '不能审核自己的名片。' } };
    }
    const now = new Date().toISOString();
    const result = morningReviewPatch({
      currentStatus: row['审核状态'],
      decision,
      note,
      reviewer: session.username,
      now,
    });
    if (result.error) return { statusCode: result.error.statusCode, payload: { ok: false, code: result.error.code, message: result.error.message } };
    await client.updateRow(MORNING_CARD_TABLE, row._id, result.patch);
    await ctx.recordAudit(req, session, `morning.card.review.${decision}`, cardId, 'success', {
      fromStatus: normalizeMorningCardStatus(row['审核状态']),
      toStatus: result.patch['审核状态'],
      noteLength: note.length,
      campus: row['校区'] || '',
      tagCount: toMorningCardView(row).interestTags.length,
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        card: toMorningAdminCardView({ ...row, ...result.patch }),
        message: decision === 'approve' ? '名片已通过审核。' : decision === 'reject' ? '名片已拒绝。' : '名片已退回修改。',
      },
    };
  });
  return ctx.json(res, outcome.statusCode, outcome.payload);
}

async function listReports(req, res, url, ctx) {
  const client = await ctx.getBase();
  const [cards, comments] = await Promise.all([
    ctx.listRows(client, MORNING_CARD_TABLE),
    ctx.listRows(client, MORNING_COMMENT_TABLE),
  ]);
  ctx.assertCompleteRows(cards);
  ctx.assertCompleteRows(comments);
  const cardById = new Map(cards.map((row) => [text(row['名片ID']), row]));
  const reports = comments.filter((row) => text(row['举报状态']));
  const requested = text(url.searchParams.get('status')) || MORNING_COMMENT_REPORT_STATUS.PENDING;
  const filtered = reports
    .filter((row) => requested === '全部' || text(row['举报状态']) === requested)
    .sort((left, right) => String(right['举报时间'] || '').localeCompare(String(left['举报时间'] || '')));
  return ctx.json(res, 200, {
    ok: true,
    source: `seatable:${MORNING_COMMENT_TABLE}`,
    stats: summarizeMorningReports(reports),
    reports: filtered.map((row) => toMorningReportView(row, cardById.get(text(row['名片ID'])))),
  });
}

async function decideReport(req, res, commentId, action, ctx, session) {
  let body;
  try {
    body = await ctx.readJsonObject(req);
  } catch (error) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_body', message: error.message || '请求体格式不正确。' });
  }
  let note;
  try {
    note = cleanReportNote(body.note);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_report_note', message: error.message });
  }
  if (!['handle', 'dismiss'].includes(action)) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_report_action', message: '举报处理结果不正确。' });
  }

  const client = await ctx.getBase();
  const initialComments = await ctx.listRows(client, MORNING_COMMENT_TABLE);
  ctx.assertCompleteRows(initialComments);
  const initial = initialComments.find((row) => text(row['评论ID']) === commentId);
  if (!initial) return ctx.json(res, 404, { ok: false, code: 'report_not_found', message: '举报记录不存在。' });
  const initialCards = await ctx.listRows(client, MORNING_CARD_TABLE);
  ctx.assertCompleteRows(initialCards);
  const card = initialCards.find((row) => text(row['名片ID']) === text(initial['名片ID']));
  const lockKey = text(card?.['账号ID']) || text(initial['名片ID']) || commentId;
  const outcome = await withMorningCardLock(lockKey, async () => {
    const [cards, comments] = await Promise.all([
      ctx.listRows(client, MORNING_CARD_TABLE),
      ctx.listRows(client, MORNING_COMMENT_TABLE),
    ]);
    ctx.assertCompleteRows(cards);
    ctx.assertCompleteRows(comments);
    const row = comments.find((item) => text(item['评论ID']) === commentId);
    if (!row) return { statusCode: 404, payload: { ok: false, code: 'report_not_found', message: '举报记录不存在。' } };
    if (text(row['举报状态']) !== MORNING_COMMENT_REPORT_STATUS.PENDING) {
      return { statusCode: 409, payload: { ok: false, code: 'report_not_pending', message: '只有待处理举报可以处理。' } };
    }
    const now = new Date().toISOString();
    const patch = {
      状态: action === 'dismiss' ? '可见' : '已举报',
      举报状态: action === 'dismiss' ? MORNING_COMMENT_REPORT_STATUS.DISMISSED : MORNING_COMMENT_REPORT_STATUS.RESOLVED,
      处理人: session.username,
      处理时间: now,
      处理意见: note,
      更新时间: now,
    };
    await client.updateRow(MORNING_COMMENT_TABLE, row._id, patch);
    await ctx.recordAudit(req, session, `morning.comment.report.${action}`, commentId, 'success', {
      cardId: text(row['名片ID']),
      reportedAccountId: text(row['评论人账号ID']),
      noteLength: note.length,
    });
    const currentCard = cards.find((item) => text(item['名片ID']) === text(row['名片ID'])) || card;
    return {
      statusCode: 200,
      payload: {
        ok: true,
        report: toMorningReportView({ ...row, ...patch }, currentCard),
        message: action === 'handle' ? '举报已确认，评论保持隐藏。' : '举报已驳回，评论已恢复公开。',
      },
    };
  });
  return ctx.json(res, outcome.statusCode, outcome.payload);
}

export async function morningAdminRoutes(req, res, url, ctx) {
  const ownsCards = ownsPrefix(url.pathname, MORNING_ADMIN_PREFIX);
  const ownsReports = ownsPrefix(url.pathname, MORNING_REPORTS_PREFIX);
  if (!ownsCards && !ownsReports) return false;

  const session = ctx.requireConsoleAccess(req, res, 'community');
  if (!session) return true;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !ctx.requireCsrf(req, res, session)) return true;

  if (ownsReports) {
    if (req.method === 'GET' && url.pathname === MORNING_REPORTS_PREFIX) {
      return listReports(req, res, url, ctx);
    }
    const decision = url.pathname.match(/^\/api\/community\/morning\/reports\/([^/]+)\/(handle|dismiss)$/);
    if (decision && req.method === 'POST') {
      return decideReport(req, res, decodeURIComponent(decision[1]), decision[2], ctx, session);
    }
    return ctx.json(res, 404, { ok: false, code: 'not_found', message: '早安晚安举报接口不存在。' });
  }

  if (req.method === 'GET' && url.pathname === MORNING_ADMIN_PREFIX) {
    return listCards(req, res, url, ctx);
  }

  const detail = url.pathname.match(/^\/api\/community\/morning\/cards\/([^/]+)$/);
  if (detail && req.method === 'GET') {
    return cardDetail(req, res, decodeURIComponent(detail[1]), ctx);
  }

  const review = url.pathname.match(/^\/api\/community\/morning\/cards\/([^/]+)\/review$/);
  if (review && req.method === 'POST') {
    return reviewCard(req, res, decodeURIComponent(review[1]), ctx, session);
  }

  return ctx.json(res, 404, { ok: false, code: 'not_found', message: '早安晚安管理接口不存在。' });
}
