import { readCommunityRows } from '../community/scoped-rows.js';
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
export const MORNING_PLAZA_PAGE_SIZE = 6;
export const MORNING_PLAZA_SEARCH_MAX_LENGTH = 60;

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
  if (url.pathname !== MORNING_PLAZA_API_PATH && !url.pathname.startsWith(`${MORNING_PLAZA_API_PATH}/`)) return false;
  if (req.method !== 'GET') return false;

  const session = ctx.requirePortalSession(req, res);
  if (!session) return true;
  const accountId = ctx.actor(session);
  ctx.enforcePublicLimit(req, 'morning-plaza-read', 120, accountId);
  const client = await ctx.getBase();
  const detailId = url.pathname.startsWith(`${MORNING_PLAZA_API_PATH}/`)
    ? decodeURIComponent(url.pathname.slice(MORNING_PLAZA_API_PATH.length + 1)) : null;
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

  if (url.pathname.startsWith(`${MORNING_PLAZA_API_PATH}/`)) {
    const cardId = decodeURIComponent(url.pathname.slice(MORNING_PLAZA_API_PATH.length + 1));
    const row = findViewableCard(rows, accountId, cardId);
    if (!row) return ctx.json(res, 404, { ok: false, code: 'card_not_found', message: '名片不存在或尚未通过审核。' });
    const sourceGrades = await resolveGrades([row]);
    return ctx.json(res, 200, { ok: true, viewer, card: toMorningPlazaDetailView(row, sourceGrades) });
  }

  const query = text(url.searchParams.get('q')).slice(0, MORNING_PLAZA_SEARCH_MAX_LENGTH);
  const sortedRows = rows
    .filter((row) => String(row['账号ID'] || '') !== accountId)
    .filter((row) => normalizeMorningCardStatus(row['审核状态']) === MORNING_CARD_STATUS.PUBLISHED)
    .filter((row) => morningPlazaMatchesTags(parseTags(row['兴趣标签']), query))
    .sort((left, right) => String(right['发布时间'] || '').localeCompare(String(left['发布时间'] || ''))
      || text(left['名片ID']).localeCompare(text(right['名片ID'])));

  const total = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / MORNING_PLAZA_PAGE_SIZE));
  const requestedPage = Number(url.searchParams.get('page') || 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, totalPages)
    : 1;
  const start = (page - 1) * MORNING_PLAZA_PAGE_SIZE;
  const pageRows = sortedRows.slice(start, start + MORNING_PLAZA_PAGE_SIZE);
  const sourceGrades = await resolveGrades(pageRows);
  const cards = pageRows.map((row) => toMorningPlazaCardView(row, sourceGrades));

  return ctx.json(res, 200, {
    ok: true,
    source: `seatable:${MORNING_CARD_TABLE}`,
    viewer,
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
