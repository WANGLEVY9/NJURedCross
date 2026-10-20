import { randomBytes } from 'node:crypto';
import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  MORNING_REVISION_STATUS,
  MORNING_REVISION_TABLE,
  normalizeMorningCardStatus,
  parseTags,
  text,
  withMorningCardLock,
} from './shared.js';

export const MORNING_REVISION_ADMIN_PATH = '/api/community/morning/revisions';

function revisionId() {
  return `MNG-REV-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function revisionRow({ id, card, accountId, account, input, now }) {
  return {
    修订ID: id,
    名片ID: text(card['名片ID']),
    账号ID: accountId,
    真实姓名快照: text(account?.realName || card['真实姓名快照']),
    学号快照: text(account?.studentId || card['学号快照']),
    性别快照: text(account?.gender || card['性别快照']),
    院系快照: text(account?.department || card['院系快照']),
    年级快照: text(account?.grade || card['年级快照']),
    展示院系: input.showDepartment && text(account?.department || card['院系快照']) ? '是' : '否',
    展示年级: input.showGrade && text(account?.grade || card['年级快照']) ? '是' : '否',
    校区: input.campus,
    昵称: input.nickname,
    兴趣标签: JSON.stringify(input.interestTags),
    备注: input.note,
    审核状态: MORNING_REVISION_STATUS.PENDING,
    审核意见: '',
    审核人: '',
    审核时间: '',
    提交时间: now,
    更新时间: now,
  };
}

export function toMorningRevisionView(row) {
  return {
    id: text(row?.['修订ID']),
    cardId: text(row?.['名片ID']),
    accountId: text(row?.['账号ID']),
    realName: text(row?.['真实姓名快照']),
    studentId: text(row?.['学号快照']),
    gender: text(row?.['性别快照']),
    nickname: text(row?.['昵称']),
    campus: text(row?.['校区']),
    department: text(row?.['院系快照']),
    grade: text(row?.['年级快照']),
    showDepartment: row?.['展示院系'] === '是',
    showGrade: row?.['展示年级'] === '是',
    interestTags: parseTags(row?.['兴趣标签']),
    note: text(row?.['备注']),
    status: text(row?.['审核状态']) || MORNING_REVISION_STATUS.PENDING,
    reviewNote: text(row?.['审核意见']),
    reviewedBy: text(row?.['审核人']),
    reviewedAt: row?.['审核时间'] || null,
    submittedAt: row?.['提交时间'] || null,
    updatedAt: row?.['更新时间'] || null,
  };
}

export async function savePublishedCardRevision({ client, listRows, assertCompleteRows, card, accountId, account, input, now }) {
  const rows = await listRows(client, MORNING_REVISION_TABLE);
  assertCompleteRows(rows);
  const existing = rows
    .filter((row) => text(row['名片ID']) === text(card['名片ID'])
      && text(row['账号ID']) === accountId
      && [MORNING_REVISION_STATUS.PENDING, MORNING_REVISION_STATUS.RETURNED, MORNING_REVISION_STATUS.REJECTED].includes(text(row['审核状态'])))
    .sort((left, right) => String(right['更新时间'] || '').localeCompare(String(left['更新时间'] || '')))[0];
  const id = text(existing?.['修订ID']) || revisionId();
  const row = revisionRow({ id, card, accountId, account, input, now });
  if (existing) await client.updateRow(MORNING_REVISION_TABLE, existing._id, row);
  else await client.appendRow(MORNING_REVISION_TABLE, row);
  return { ...row, _id: existing?._id || null };
}

function cleanReviewNote(value) {
  const note = text(value);
  if (note.length > 300) {
    throw Object.assign(new Error('审核意见不能超过 300 字。'), { statusCode: 400 });
  }
  return note;
}

async function listRevisions(req, res, url, ctx) {
  const rows = await ctx.listRows(await ctx.getBase(), MORNING_REVISION_TABLE);
  ctx.assertCompleteRows(rows);
  const requested = text(url.searchParams.get('status'));
  const filtered = rows
    .filter((row) => !requested || text(row['审核状态']) === requested)
    .map(toMorningRevisionView)
    .sort((left, right) => String(right.submittedAt || '').localeCompare(String(left.submittedAt || '')));
  return ctx.json(res, 200, {
    ok: true,
    stats: {
      pending: rows.filter((row) => text(row['审核状态']) === MORNING_REVISION_STATUS.PENDING).length,
      returned: rows.filter((row) => text(row['审核状态']) === MORNING_REVISION_STATUS.RETURNED).length,
      rejected: rows.filter((row) => text(row['审核状态']) === MORNING_REVISION_STATUS.REJECTED).length,
      approved: rows.filter((row) => text(row['审核状态']) === MORNING_REVISION_STATUS.APPROVED).length,
    },
    revisions: filtered.slice(0, 100),
  });
}

async function revisionDetail(req, res, id, ctx) {
  const rows = await ctx.listRows(await ctx.getBase(), MORNING_REVISION_TABLE);
  ctx.assertCompleteRows(rows);
  const row = rows.find((item) => text(item['修订ID']) === id);
  if (!row) return ctx.json(res, 404, { ok: false, code: 'revision_not_found', message: '名片修订不存在。' });
  return ctx.json(res, 200, { ok: true, revision: toMorningRevisionView(row) });
}

async function reviewRevision(req, res, id, ctx, session) {
  let body;
  try {
    body = await ctx.readJsonObject(req);
  } catch (error) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_body', message: error.message || '请求体格式不正确。' });
  }
  const decision = text(body.decision);
  if (!['approve', 'return', 'reject'].includes(decision)) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_revision_decision', message: '请选择通过、退回或拒绝。' });
  }
  let note;
  try {
    note = cleanReviewNote(body.note);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, message: error.message });
  }
  if (decision !== 'approve' && !note) {
    return ctx.json(res, 400, { ok: false, code: 'review_note_required', message: '退回或拒绝必须填写审核意见。' });
  }

  const client = await ctx.getBase();
  const initialRows = await ctx.listRows(client, MORNING_REVISION_TABLE);
  ctx.assertCompleteRows(initialRows);
  const initial = initialRows.find((item) => text(item['修订ID']) === id);
  if (!initial) return ctx.json(res, 404, { ok: false, code: 'revision_not_found', message: '名片修订不存在。' });
  if (text(initial['审核状态']) !== MORNING_REVISION_STATUS.PENDING) {
    return ctx.json(res, 409, { ok: false, code: 'revision_not_pending', message: '只有待审核的修订可以处理。' });
  }

  const now = new Date().toISOString();
  const outcome = await withMorningCardLock(text(initial['名片ID']), async () => {
    const [revisions, cards] = await Promise.all([
      ctx.listRows(client, MORNING_REVISION_TABLE),
      ctx.listRows(client, MORNING_CARD_TABLE),
    ]);
    ctx.assertCompleteRows(revisions);
    ctx.assertCompleteRows(cards);
    const row = revisions.find((item) => text(item['修订ID']) === id);
    if (!row || text(row['审核状态']) !== MORNING_REVISION_STATUS.PENDING) {
      return { statusCode: 409, payload: { ok: false, code: 'revision_not_pending', message: '修订状态已变化，请刷新后重试。' } };
    }
    const card = cards.find((item) => text(item['名片ID']) === text(row['名片ID']));
    if (!card || normalizeMorningCardStatus(card['审核状态']) !== MORNING_CARD_STATUS.PUBLISHED) {
      return { statusCode: 409, payload: { ok: false, code: 'card_not_published', message: '原名片已不在发布状态，无法应用本次修订。' } };
    }
    const revisionStatus = decision === 'approve'
      ? MORNING_REVISION_STATUS.APPROVED
      : decision === 'return'
        ? MORNING_REVISION_STATUS.RETURNED
        : MORNING_REVISION_STATUS.REJECTED;
    if (decision === 'approve') {
      await client.updateRow(MORNING_CARD_TABLE, card._id, {
        真实姓名快照: text(row['真实姓名快照']),
        学号快照: text(row['学号快照']),
        性别快照: text(row['性别快照']),
        院系快照: text(row['院系快照']),
        年级快照: text(row['年级快照']),
        展示院系: row['展示院系'],
        展示年级: row['展示年级'],
        校区: text(row['校区']),
        昵称: text(row['昵称']),
        兴趣标签: text(row['兴趣标签']),
        备注: text(row['备注']),
        审核意见: note,
        审核人: session.username,
        审核时间: now,
        更新时间: now,
      });
    }
    const patch = {
      审核状态: revisionStatus,
      审核意见: note,
      审核人: session.username,
      审核时间: now,
      更新时间: now,
    };
    await client.updateRow(MORNING_REVISION_TABLE, row._id, patch);
    await ctx.recordAudit(req, session, `morning.revision.${decision}`, id, 'success', {
      cardId: text(row['名片ID']),
      accountId: text(row['账号ID']),
      noteLength: note.length,
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        revision: toMorningRevisionView({ ...row, ...patch }),
        message: decision === 'approve' ? '名片资料已更新到广场。' : decision === 'return' ? '名片资料已退回修改，原广场名片保持不变。' : '名片资料修订已拒绝，原广场名片保持不变。',
      },
    };
  });
  return ctx.json(res, outcome.statusCode, outcome.payload);
}

export async function morningRevisionRoutes(req, res, url, ctx) {
  if (url.pathname === MORNING_REVISION_ADMIN_PATH && req.method === 'GET') {
    const session = ctx.requireConsoleAccess(req, res, 'community');
    if (!session) return true;
    return listRevisions(req, res, url, ctx);
  }
  const detail = url.pathname.match(/^\/api\/community\/morning\/revisions\/([^/]+)$/);
  if (detail && req.method === 'GET') {
    const session = ctx.requireConsoleAccess(req, res, 'community');
    if (!session) return true;
    return revisionDetail(req, res, decodeURIComponent(detail[1]), ctx);
  }
  const review = url.pathname.match(/^\/api\/community\/morning\/revisions\/([^/]+)\/review$/);
  if (review && req.method === 'POST') {
    const session = ctx.requireConsoleAccess(req, res, 'community');
    if (!session || !ctx.requireCsrf(req, res, session)) return true;
    return reviewRevision(req, res, decodeURIComponent(review[1]), ctx, session);
  }
  return false;
}

export async function pendingRevisionForCard({ listRows, assertCompleteRows, client, cardId, accountId }) {
  const rows = await listRows(client, MORNING_REVISION_TABLE);
  assertCompleteRows(rows);
  return rows.find((row) => text(row['名片ID']) === cardId
    && text(row['账号ID']) === accountId
    && text(row['审核状态']) === MORNING_REVISION_STATUS.PENDING) || null;
}
