import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  isActiveMorningCardStatus,
  normalizeMorningCardStatus,
} from './api.js';

export const MORNING_PLAZA_PATH = '/morning/plaza';
export const MORNING_PLAZA_API_PATH = '/api/morning/cards';
export const MORNING_PLAZA_NOTE_PREVIEW_LENGTH = 80;

function text(value) {
  return String(value ?? '').trim();
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function toMorningPlazaCardView(row) {
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
  };
}

export function toMorningPlazaDetailView(row) {
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    campus: text(row?.['校区']),
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
  const rows = await ctx.listRows(await ctx.getBase(), MORNING_CARD_TABLE);
  ctx.assertCompleteRows(rows);

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

  const cards = rows
    .filter((row) => String(row['账号ID'] || '') !== accountId)
    .filter((row) => normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED)
    .map(toMorningPlazaCardView)
    .sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')));

  return ctx.json(res, 200, {
    ok: true,
    source: `seatable:${MORNING_CARD_TABLE}`,
    stats: { published: cards.length },
    cards,
  });
}
