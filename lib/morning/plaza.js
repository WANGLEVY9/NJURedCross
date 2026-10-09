import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  MORNING_COMMENT_TABLE,
  MORNING_PLAZA_API_PATH,
  MORNING_PLAZA_PATH,
  isActiveMorningCardStatus,
  normalizeMorningCardStatus,
  parseTags,
  text,
} from './shared.js';

export { MORNING_PLAZA_API_PATH, MORNING_PLAZA_PATH } from './shared.js';
export const MORNING_PLAZA_NOTE_PREVIEW_LENGTH = 80;
export const MORNING_PLAZA_PAGE_SIZE = 6;
export const MORNING_PLAZA_HEAT_COMMENT_WEIGHT = 10;
export const MORNING_PLAZA_RECENCY_WINDOW_DAYS = 14;
export const MORNING_PLAZA_SEARCH_MAX_LENGTH = 60;

export function toMorningPlazaCardView(row, { commentCount = 0 } = {}) {
  const note = text(row?.['备注']);
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    campus: text(row?.['校区']),
    interestTags: parseTags(row?.['兴趣标签']),
    notePreview: note.length > MORNING_PLAZA_NOTE_PREVIEW_LENGTH
      ? `${note.slice(0, MORNING_PLAZA_NOTE_PREVIEW_LENGTH - 1)}…`
      : note,
    hasMoreNote: note.length > MORNING_PLAZA_NOTE_PREVIEW_LENGTH,
    publishedAt: row?.['发布时间'] || null,
    commentCount,
  };
}

export function morningPlazaHeatScore({ commentCount = 0, publishedAt = null, now = Date.now() } = {}) {
  const published = Date.parse(String(publishedAt || ''));
  const ageDays = Number.isFinite(published) ? Math.max(0, Math.floor((now - published) / 86_400_000)) : Infinity;
  const recency = Math.max(0, MORNING_PLAZA_RECENCY_WINDOW_DAYS - ageDays);
  return commentCount * MORNING_PLAZA_HEAT_COMMENT_WEIGHT + recency;
}

function isVisibleComment(row) {
  return (text(row?.['状态']) || '可见') === '可见';
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
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    campus: text(row?.['校区']),
    interestTags: parseTags(row?.['兴趣标签']),
    note: text(row?.['备注']),
    allowEmail: row?.['允许评论邮件'] !== '否',
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
  const client = await ctx.getBase();
  const [rows, commentRows] = await Promise.all([
    ctx.listRows(client, MORNING_CARD_TABLE),
    ctx.listRows(client, MORNING_COMMENT_TABLE),
  ]);
  ctx.assertCompleteRows(rows);
  ctx.assertCompleteRows(commentRows);

  const ownCard = rows.find((row) => String(row['账号ID'] || '') === accountId
    && isActiveMorningCardStatus(row['审核状态']));
  if (!ownCard) {
    return ctx.json(res, 403, {
      ok: false,
      code: 'morning_card_required',
      message: '先完成早安晚安报名，才能进入广场浏览。',
    });
  }

  if (url.pathname.startsWith(`${MORNING_PLAZA_API_PATH}/`)) {
    const cardId = decodeURIComponent(url.pathname.slice(MORNING_PLAZA_API_PATH.length + 1));
    const row = findViewableCard(rows, accountId, cardId);
    if (!row) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在或尚未通过审核。' });
    return ctx.json(res, 200, { ok: true, card: toMorningPlazaDetailView(row) });
  }

  const commentCountByCard = new Map();
  for (const comment of commentRows) {
    if (!isVisibleComment(comment)) continue;
    const cardId = text(comment?.['名片ID']);
    if (!cardId) continue;
    commentCountByCard.set(cardId, (commentCountByCard.get(cardId) || 0) + 1);
  }
  const now = Date.now();
  const query = text(url.searchParams.get('q')).slice(0, MORNING_PLAZA_SEARCH_MAX_LENGTH);
  const sortedCards = rows
    .filter((row) => String(row['账号ID'] || '') !== accountId)
    .filter((row) => normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED)
    .filter((row) => morningPlazaMatchesTags(parseTags(row['兴趣标签']), query))
    .map((row) => {
      const commentCount = commentCountByCard.get(text(row['名片ID'])) || 0;
      return {
        card: toMorningPlazaCardView(row, { commentCount }),
        score: morningPlazaHeatScore({ commentCount, publishedAt: row['发布时间'], now }),
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const byPublished = String(right.card.publishedAt || '').localeCompare(String(left.card.publishedAt || ''));
      return byPublished || String(left.card.id).localeCompare(String(right.card.id));
    })
    .map((entry) => entry.card);

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
      sort: 'comments_and_published_at',
      query,
    },
    cards,
  });
}
