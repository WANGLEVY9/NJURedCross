import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  MORNING_INVITE_TABLE,
  MORNING_PLAZA_API_PATH,
  MORNING_PLAZA_PATH,
  isPublishedMorningCardStatus,
  normalizeMorningCardStatus,
  parseTags,
  text,
} from './shared.js';
import { invitationTokenHash, verifyInvitationToken } from './invitations.js';

export { MORNING_PLAZA_API_PATH, MORNING_PLAZA_PATH } from './shared.js';
export const MORNING_PLAZA_NOTE_PREVIEW_LENGTH = 80;
export const MORNING_PLAZA_PAGE_SIZE = 6;
export const MORNING_PLAZA_SEARCH_MAX_LENGTH = 60;

export function toMorningPlazaCardView(row) {
  const note = text(row?.['备注']);
  const showDepartment = row?.['展示院系'] === '是';
  const showGrade = row?.['展示年级'] === '是';
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    gender: text(row?.['性别快照']),
    campus: text(row?.['校区']),
    department: showDepartment ? text(row?.['院系快照']) : '',
    grade: showGrade ? text(row?.['年级快照']) : '',
    interestTags: parseTags(row?.['兴趣标签']),
    notePreview: note.length > MORNING_PLAZA_NOTE_PREVIEW_LENGTH
      ? `${note.slice(0, MORNING_PLAZA_NOTE_PREVIEW_LENGTH - 1)}…`
      : note,
    hasMoreNote: note.length > MORNING_PLAZA_NOTE_PREVIEW_LENGTH,
    publishedAt: row?.['发布时间'] || null,
  };
}

export function morningPlazaTagTokens(value) {
  return text(value)
    .slice(0, MORNING_PLAZA_SEARCH_MAX_LENGTH)
    .split(/[,，、\s]+/)
    .map((item) => text(item).toLowerCase())
    .filter(Boolean)
    .slice(0, 5);
}

export function morningPlazaMatchesTags(tags, query) {
  const tokens = morningPlazaTagTokens(query);
  if (!tokens.length) return true;
  const normalizedTags = (Array.isArray(tags) ? tags : []).map((tag) => text(tag).toLowerCase()).filter(Boolean);
  return tokens.every((token) => normalizedTags.some((tag) => tag.includes(token)));
}

export function toMorningPlazaDetailView(row) {
  const showDepartment = row?.['展示院系'] === '是';
  const showGrade = row?.['展示年级'] === '是';
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    gender: text(row?.['性别快照']),
    campus: text(row?.['校区']),
    department: showDepartment ? text(row?.['院系快照']) : '',
    grade: showGrade ? text(row?.['年级快照']) : '',
    interestTags: parseTags(row?.['兴趣标签']),
    note: text(row?.['备注']),
    publishedAt: row?.['发布时间'] || null,
  };
}

function findViewableCard(rows, accountId, cardId) {
  return rows.find((row) => String(row['名片ID'] || '') === cardId
    && String(row['账号ID'] || '') !== accountId
    && normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED);
}

export async function morningPlazaRoutes(req, res, url, ctx) {
  if (url.pathname !== MORNING_PLAZA_API_PATH && !url.pathname.startsWith(`${MORNING_PLAZA_API_PATH}/`)) return false;
  if (req.method !== 'GET') return false;

  const session = ctx.requirePortalSession(req, res);
  if (!session) return true;
  const accountId = ctx.actor(session);
  ctx.enforcePublicLimit(req, 'morning-plaza-read', 120, accountId);
  const client = await ctx.getBase();
  const rows = await ctx.listRows(client, MORNING_CARD_TABLE);
  ctx.assertCompleteRows(rows);

  const ownCard = rows.find((row) => String(row['账号ID'] || '') === accountId
    && isPublishedMorningCardStatus(row['审核状态']));

  if (url.pathname.startsWith(`${MORNING_PLAZA_API_PATH}/`)) {
    const cardId = decodeURIComponent(url.pathname.slice(MORNING_PLAZA_API_PATH.length + 1));
    const inviteToken = text(url.searchParams.get('invite'));
    let inviteAccess = false;
    if (inviteToken) {
      const claims = verifyInvitationToken(inviteToken, ctx.inviteSecret);
      if (claims) {
        const invitations = await ctx.listRows(client, MORNING_INVITE_TABLE);
        ctx.assertCompleteRows(invitations);
        inviteAccess = invitations.some((row) => text(row['邀约ID']) === claims.invitationId
          && text(row['反馈令牌哈希']) === invitationTokenHash(inviteToken)
          && text(row['收件人账号ID']) === accountId
          && text(row['名片ID']) === cardId);
      }
    }
    if (inviteToken && !inviteAccess) {
      return ctx.json(res, 410, { ok: false, code: 'invite_link_invalid', message: '邀约主页链接无效或已超过 3 天有效期。' });
    }
    if (!ownCard && !inviteAccess) {
      return ctx.json(res, 403, {
        ok: false,
        code: 'morning_card_required',
        message: '先完成早安晚安报名，才能进入广场浏览。',
      });
    }
    const row = findViewableCard(rows, accountId, cardId);
    if (!row) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在或尚未通过审核。' });
    return ctx.json(res, 200, { ok: true, card: toMorningPlazaDetailView(row) });
  }

  if (!ownCard) {
    return ctx.json(res, 403, {
      ok: false,
      code: 'morning_card_required',
      message: '先完成早安晚安报名，才能进入广场浏览。',
    });
  }
  const query = text(url.searchParams.get('q')).slice(0, MORNING_PLAZA_SEARCH_MAX_LENGTH);
  const sortedCards = rows
    .filter((row) => String(row['账号ID'] || '') !== accountId)
    .filter((row) => normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED)
    .filter((row) => morningPlazaMatchesTags(parseTags(row['兴趣标签']), query))
    .map((row) => toMorningPlazaCardView(row))
    .sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || ''))
      || String(left.id).localeCompare(String(right.id)));

  const total = sortedCards.length;
  const totalPages = Math.max(1, Math.ceil(total / MORNING_PLAZA_PAGE_SIZE));
  const requestedPage = Number(url.searchParams.get('page') || 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, totalPages)
    : 1;
  const start = (page - 1) * MORNING_PLAZA_PAGE_SIZE;
  const cards = sortedCards.slice(start, start + MORNING_PLAZA_PAGE_SIZE);

  return ctx.json(res, 200, {
    ok: true,
    source: `seatable:${MORNING_CARD_TABLE}`,
    stats: {
      published: total,
      total,
      page,
      pageSize: MORNING_PLAZA_PAGE_SIZE,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
      sort: 'published_at',
      query,
    },
    cards,
  });
}
