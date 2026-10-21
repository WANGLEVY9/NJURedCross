import { randomUUID } from 'node:crypto';

// 首页千纸鹤寄语存放在 NJUTable 底表；审核通过后才会在首页展示。
export const CRANE_TABLE = '千纸鹤寄语表';
export const CRANE_COLUMNS = ['寄语ID', '内容', '署名', '来源', '状态', '创建人', '创建时间', '更新人', '更新时间'];
export const CRANE_STATES = ['待审核', '已发布', '已下架'];
export const CRANE_SOURCE = '首页千纸鹤';
const PENDING = '待审核';
const PUBLISHED = '已发布';
const DEFAULT_AUTHOR = '一位南大志愿者';
const FEED_LIMIT = 12;
const PAGE_SIZE = 500;

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Client-supplied status is ignored: every submission starts as pending review. */
export function cranePayload(body) {
  const content = String(body?.content ?? '').trim();
  const author = String(body?.author ?? '').trim() || DEFAULT_AUTHOR;
  if (!content || content.length > 200) throw fail(400, '请填写 1–200 字寄语。');
  if (author.length > 20) throw fail(400, '署名不超过 20 字。');
  return { 内容: content, 署名: author, 来源: CRANE_SOURCE };
}

export async function craneSchemaReady(base) {
  const table = (await base.getMetadata()).tables?.find(t => t.name === CRANE_TABLE);
  return Boolean(table && CRANE_COLUMNS.every(n => table.columns?.some(c => c.name === n && c.type === 'text')));
}

export async function craneRows(base) {
  const all = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const page = await base.listRows(CRANE_TABLE, '', '', false, start, PAGE_SIZE);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all
    .map(row => ({
      id: row._id,
      content: row['内容'] || '',
      author: row['署名'] || '',
      status: row['状态'] || PENDING,
      updatedAt: row['更新时间'] || row['创建时间'] || '',
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Only approved rows reach the homepage; account identity and timestamps never leave the server. */
export function publishedCranes(rows, limit = FEED_LIMIT) {
  return rows
    .filter(row => row.status === PUBLISHED)
    .slice(0, limit)
    .map(row => ({ id: row.id, content: row.content, author: row.author || DEFAULT_AUTHOR }));
}

/** Authentication, CSRF and rate limiting are enforced by the public API boundary. */
export async function craneRoutes(req, res, url, { base, session, json, readJson, audit }) {
  if (url.pathname !== '/api/public/cranes') return false;
  const ready = await craneSchemaReady(base);
  if (req.method === 'GET') return json(res, 200, { ok: true, ready, items: ready ? publishedCranes(await craneRows(base)) : [] });
  if (req.method !== 'POST') throw fail(405, '不支持此寄语操作');
  if (!ready) throw fail(503, '千纸鹤寄语数据表尚未配置，请联系平台维护人。');
  if (!session) throw fail(401, '请先登录，再写下寄语。');
  const body = await readJson(req);
  if (body.consent !== true) throw fail(400, '请确认寄语与署名将在审核通过后公开。');
  const now = new Date().toISOString();
  const row = {
    ...cranePayload(body),
    寄语ID: `CRANE-${randomUUID()}`,
    状态: PENDING,
    创建人: session.username,
    创建时间: now,
    更新人: session.username,
    更新时间: now,
  };
  const result = await base.appendRow(CRANE_TABLE, row);
  await audit(req, session, 'cranes.submit', result._id, 'success', { status: PENDING });
  return json(res, 201, { ok: true, item: { id: result._id }, items: [], message: '您的寄言已提交，正在审核中，审核通过后将在主页进行展示。' });
}
