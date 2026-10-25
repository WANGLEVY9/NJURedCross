import { readCommunityRows } from '../community/scoped-rows.js';
import { MORNING_PLAZA_DAILY_LIMIT, shanghaiDate } from './plaza-snapshot-store.js';
import {
  MORNING_CARD_TABLE,
  MORNING_CARD_STATUS,
  MORNING_PLAZA_API_PATH,
  MORNING_PLAZA_PATH,
  isActiveMorningCardStatus,
  isPublishedMorningCardStatus,
  normalizeMorningCardStatus,
  parseTags,
  text,
} from './shared.js';

export { MORNING_PLAZA_API_PATH, MORNING_PLAZA_PATH } from './shared.js';
export const MORNING_PLAZA_NOTE_PREVIEW_LENGTH = 80;
export const MORNING_PLAZA_PAGE_SIZE = MORNING_PLAZA_DAILY_LIMIT;
const MORNING_FAVORITES_PATH = '/api/morning/favorites';

function sourceGrade(row, sourceGrades) {
  if (row?.['展示年级'] !== '是') return '';
  if (sourceGrades instanceof Map) {
    return text(sourceGrades.get(text(row?.['学号快照'])));
  }
  return text(row?.['年级快照']);
}

export function toMorningPlazaCardView(row, sourceGrades = null) {
  const note = text(row?.['备注']);
  const showDepartment = row?.['展示院系'] === '是';
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    gender: text(row?.['性别快照']),
    campus: text(row?.['校区']),
    department: showDepartment ? text(row?.['院系快照']) : '',
    grade: sourceGrade(row, sourceGrades),
    interestTags: parseTags(row?.['兴趣标签']),
    notePreview: note.length > MORNING_PLAZA_NOTE_PREVIEW_LENGTH
      ? `${note.slice(0, MORNING_PLAZA_NOTE_PREVIEW_LENGTH - 1)}…`
      : note,
    hasMoreNote: note.length > MORNING_PLAZA_NOTE_PREVIEW_LENGTH,
    publishedAt: row?.['发布时间'] || null,
  };
}

export function toMorningPlazaDetailView(row, sourceGrades = null) {
  const showDepartment = row?.['展示院系'] === '是';
  return {
    id: text(row?.['名片ID']),
    nickname: text(row?.['昵称']),
    gender: text(row?.['性别快照']),
    campus: text(row?.['校区']),
    department: showDepartment ? text(row?.['院系快照']) : '',
    grade: sourceGrade(row, sourceGrades),
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

export function toMorningPlazaViewer(rows, accountId) {
  const ownCard = rows.find((row) => String(row['账号ID'] || '') === accountId
    && isActiveMorningCardStatus(row['审核状态']));
  return {
    canBrowse: true,
    canInvite: Boolean(ownCard && isPublishedMorningCardStatus(ownCard['审核状态'])),
    cardStatus: ownCard ? normalizeMorningCardStatus(ownCard['审核状态']) : null,
  };
}

export async function morningPlazaRoutes(req, res, url, ctx) {
  const isFavoriteList = url.pathname === MORNING_FAVORITES_PATH && req.method === 'GET';
  const favoriteMatch = url.pathname.match(/^\/api\/morning\/favorites\/([^/]+)$/);
  const isFavoriteWrite = favoriteMatch && ['POST', 'DELETE'].includes(req.method);
  const detailMatch = url.pathname.match(/^\/api\/morning\/cards\/([^/]+)$/);
  const isPlazaRead = req.method === 'GET' && (url.pathname === MORNING_PLAZA_API_PATH || detailMatch);
  if (!isFavoriteList && !isFavoriteWrite && !isPlazaRead) return false;

  const session = req.method === 'GET' ? ctx.requirePortalSession(req, res) : ctx.requirePortalWrite(req, res);
  if (!session) return true;
  const accountId = ctx.actor(session);
  ctx.enforcePublicLimit(req, 'morning-plaza-read', 120, accountId);
  let requestedCardId = null;
  if (favoriteMatch || detailMatch) {
    try {
      requestedCardId = decodeURIComponent((favoriteMatch || detailMatch)[1]);
      if (!requestedCardId.trim() || requestedCardId.length > 200 || /[/\\\u0000-\u001f\u007f]/.test(requestedCardId)) throw new URIError();
    } catch {
      return ctx.json(res, 400, { ok: false, code: 'invalid_card_id', message: '名片编号格式不正确。' });
    }
  }
  const store = ctx.morningPlazaSnapshotStore;
  if (!store?.listFavorites || !store?.addFavorite || !store?.removeFavorite) {
    return ctx.json(res, 503, { ok: false, code: 'plaza_favorites_unavailable', message: '名片收藏暂不可用。' });
  }
  if (isFavoriteList) {
    const favoriteIds = store.listFavorites(accountId);
    if (!favoriteIds.length) return ctx.json(res, 200, { ok: true, favorites: [] });
    const client = await ctx.getBase();
    const rows = await readCommunityRows(client, MORNING_CARD_TABLE, [{ 账号ID: accountId }, { 名片ID: favoriteIds }], ctx.listRows);
    ctx.assertCompleteRows(rows);
    const published = rows.filter(row => String(row['账号ID'] || '') !== accountId
      && favoriteIds.includes(text(row['名片ID']))
      && normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED);
    const sourceGrades = await (async () => {
      if (typeof ctx.resolveMorningGrades !== 'function') return null;
      const eligible = published.filter(row => row['展示年级'] === '是');
      if (!eligible.length) return new Map();
      return ctx.resolveMorningGrades(eligible.map(row => ({ studentId: text(row['学号快照']), realName: text(row['真实姓名快照']) })));
    })();
    const byId = new Map(published.map(row => [text(row['名片ID']), toMorningPlazaCardView(row, sourceGrades)]));
    return ctx.json(res, 200, { ok: true, favorites: favoriteIds.map(id => byId.get(id)).filter(Boolean) });
  }
  if (isFavoriteWrite) {
    const cardId = requestedCardId;
    if (req.method === 'DELETE') {
      return ctx.json(res, 200, { ok: true, favoriteIds: store.removeFavorite(accountId, cardId) });
    }
    const client = await ctx.getBase();
    const candidateRows = await readCommunityRows(client, MORNING_CARD_TABLE, [{ 账号ID: accountId }, { 名片ID: cardId }], ctx.listRows);
    ctx.assertCompleteRows(candidateRows);
    const candidate = findViewableCard(candidateRows, accountId, cardId);
    if (!candidate) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '只有已发布的他人名片可以收藏。' });
    return ctx.json(res, 200, { ok: true, favoriteIds: store.addFavorite(accountId, cardId) });
  }

  const client = await ctx.getBase();
  const detailId = requestedCardId;
  const rows = await readCommunityRows(client, MORNING_CARD_TABLE,
    [{ 账号ID: accountId }, detailId !== null ? { 名片ID: detailId } : { 审核状态: MORNING_CARD_STATUS.PUBLISHED }], ctx.listRows);
  ctx.assertCompleteRows(rows);
  const viewer = toMorningPlazaViewer(rows, accountId);
  const resolveGrades = async (cardRows) => {
    if (typeof ctx.resolveMorningGrades !== 'function') return null;
    const publicGradeRows = cardRows.filter((row) => row['展示年级'] === '是');
    if (!publicGradeRows.length) return new Map();
    return ctx.resolveMorningGrades(publicGradeRows.map((row) => ({
      studentId: text(row['学号快照']),
      realName: text(row['真实姓名快照']),
    })));
  };

  if (detailMatch) {
    const cardId = detailId;
    const row = findViewableCard(rows, accountId, cardId);
    if (!row) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在或尚未通过审核。' });
    const sourceGrades = await resolveGrades([row]);
    return ctx.json(res, 200, { ok: true, viewer, favorite: store.listFavorites(accountId).includes(cardId), card: toMorningPlazaDetailView(row, sourceGrades) });
  }

  const sortedRows = rows
    .filter((row) => String(row['账号ID'] || '') !== accountId)
    .filter((row) => normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED)
    .sort((left, right) => String(right['发布时间'] || '').localeCompare(String(left['发布时间'] || ''))
      || text(left['名片ID']).localeCompare(text(right['名片ID'])));
  if (!ctx.morningPlazaSnapshotStore?.getOrCreate) {
    throw Object.assign(new Error('同行广场今日名片暂不可用。'), { statusCode: 503, code: 'plaza_snapshot_unavailable' });
  }
  const snapshotDate = shanghaiDate();
  const snapshotIds = ctx.morningPlazaSnapshotStore.getOrCreate(
    accountId,
    snapshotDate,
    sortedRows.map(row => text(row['名片ID'])).filter(Boolean),
  );
  const rowById = new Map(sortedRows.map(row => [text(row['名片ID']), row]));
  const snapshotRows = snapshotIds.map(id => rowById.get(id)).filter(Boolean);
  const sourceGrades = await resolveGrades(snapshotRows);
  const cards = snapshotRows.map((row) => toMorningPlazaCardView(row, sourceGrades));

  return ctx.json(res, 200, {
    ok: true,
    source: `seatable:${MORNING_CARD_TABLE}`,
    viewer,
    stats: {
      published: snapshotRows.length,
      total: snapshotRows.length,
      snapshotDate,
      sort: 'daily_random',
    },
    cards,
  });
}
