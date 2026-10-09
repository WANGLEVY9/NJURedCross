import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  isActiveMorningCardStatus,
  normalizeMorningCardStatus,
} from './api.js';

export const MORNING_PLAZA_PATH = '/morning/plaza';
export const MORNING_PLAZA_API_PATH = '/api/morning/cards';

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
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    campus: text(row?.['校区']),
    interestTags: parseTags(row?.['兴趣标签']),
    note: text(row?.['备注']),
    publishedAt: row?.['发布时间'] || null,
  };
}

export async function morningPlazaRoutes(req, res, url, ctx) {
  if (url.pathname !== MORNING_PLAZA_API_PATH || req.method !== 'GET') return false;

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
