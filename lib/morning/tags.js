import { randomBytes } from 'node:crypto';
import { text } from './shared.js';

export const MORNING_TAG_TABLE = '早安晚安兴趣标签表';
export const MORNING_TAG_MAX_LENGTH = 5;
export const MORNING_TAG_PRESETS = Object.freeze([
  '摄影', '跑步', '读书', '音乐', '桌游', '旅行', '电影', '编程', '羽毛球', '公益',
  '健身', '动漫', '咖啡', '博物馆', '志愿',
]);

function tagId() {
  return `MNG-TAG-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function normalizeMorningTag(value) {
  const tag = text(value);
  if (!tag) throw Object.assign(new Error('标签不能为空。'), { code: 'tag_required', statusCode: 400 });
  if (tag.length > MORNING_TAG_MAX_LENGTH) {
    throw Object.assign(new Error(`单个标签不能超过 ${MORNING_TAG_MAX_LENGTH} 字。`), { code: 'tag_too_long', statusCode: 400 });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(tag)) {
    throw Object.assign(new Error('标签包含不支持的控制字符。'), { code: 'invalid_tag', statusCode: 400 });
  }
  return tag;
}

export function toMorningTagView(row) {
  return {
    id: text(row?.['标签ID']),
    tag: text(row?.['标签']),
    createdAt: row?.['创建时间'] || null,
  };
}

export async function listMorningTags(client, listRows, assertCompleteRows = () => {}) {
  const rows = await listRows(client, MORNING_TAG_TABLE);
  assertCompleteRows(rows);
  const tags = [...MORNING_TAG_PRESETS];
  const seen = new Set(tags.map((tag) => tag.toLowerCase()));
  for (const row of rows) {
    if (text(row['状态']) !== '启用') continue;
    const tag = text(row['标签']);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export async function ensureMorningTags(client, values, accountId, listRows) {
  const rows = await listRows(client, MORNING_TAG_TABLE);
  const existing = new Set(rows
    .filter((row) => text(row['状态']) !== '停用')
    .map((row) => text(row['标签']).toLowerCase())
    .filter(Boolean));
  const now = new Date().toISOString();
  for (const value of values) {
    const tag = normalizeMorningTag(value);
    const key = tag.toLowerCase();
    if (existing.has(key)) continue;
    await client.appendRow(MORNING_TAG_TABLE, {
      标签ID: tagId(),
      标签: tag,
      来源账号ID: accountId,
      状态: '启用',
      创建时间: now,
      更新时间: now,
    });
    existing.add(key);
  }
}

export async function morningTagRoutes(req, res, url, ctx) {
  if (url.pathname !== '/api/morning/tags' || !['GET', 'POST'].includes(req.method)) return false;
  const session = req.method === 'GET'
    ? ctx.requirePortalSession(req, res)
    : ctx.requirePortalWrite(req, res);
  if (!session) return true;

  const client = await ctx.getBase();
  if (req.method === 'GET') {
    const tags = await listMorningTags(client, ctx.listRows, ctx.assertCompleteRows);
    return ctx.json(res, 200, { ok: true, tags });
  }

  let body;
  try {
    body = await ctx.readJsonObject(req);
  } catch (error) {
    return ctx.json(res, 400, { ok: false, code: 'invalid_body', message: error.message || '请求体格式不正确。' });
  }
  let tag;
  try {
    tag = normalizeMorningTag(body.tag);
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_tag', message: error.message });
  }
  await ensureMorningTags(client, [tag], ctx.actor(session), ctx.listRows);
  await ctx.recordAudit(req, session, 'morning.tag.ensure', tag, 'success', {});
  return ctx.json(res, 201, { ok: true, tag });
}
