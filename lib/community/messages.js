import { randomUUID } from 'node:crypto';

// 旧语录表通过受 UUID 保护的原地改名迁移；建表工具不创建平行表。
export const MESSAGE_TABLE = '红会留言墙';
export const MESSAGE_COLUMNS = ['留言ID', '内容', '署名', '来源', '状态', '创建人', '创建时间', '更新人', '更新时间'];
const states = ['草稿', '已发布', '已下架'];
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export function messagePayload(body) {
  const result = {};
  for (const [key, column, max, required] of [['content', '内容', 1000, true], ['author', '署名', 80, true], ['source', '来源', 200, false]]) {
    const value = String(body[key] ?? '').trim();
    if ((required && !value) || value.length > max) throw fail(400, `${column}${!value ? '不能为空' : `不能超过 ${max} 字`}`);
    result[column] = value;
  }
  if (!states.includes(body.status || '草稿')) throw fail(400, '无效留言状态');
  result['状态'] = body.status || '草稿';
  return result;
}

export async function messageSchemaReady(base) {
  const table = (await base.getMetadata()).tables?.find(t => t.name === MESSAGE_TABLE);
  return Boolean(table && MESSAGE_COLUMNS.every(n => table.columns?.some(c => c.name === n && c.type === 'text')));
}

export async function messageRows(base) {
  const all = [];
  for (let start = 0; ; start += 500) {
    const page = await base.listRows(MESSAGE_TABLE, '', '', false, start, 500);
    all.push(...page);
    if (page.length < 500) break;
  }
  return all
    .map(r => ({ id: r._id, content: r['内容'] || '', author: r['署名'] || '', source: r['来源'] || '', status: r['状态'] || '草稿', updatedAt: r['更新时间'] || r['创建时间'] || '' }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Authentication, scope, CSRF and audit are provided by the console API boundary. */
export async function messageRoutes(req, res, url, { base, session, json, readJson, audit }) {
  const root = '/api/community/messages';
  if (url.pathname !== root && !url.pathname.startsWith(root + '/')) return false;
  const ready = await messageSchemaReady(base);
  if (req.method === 'GET' && url.pathname === root) return json(res, 200, { ok: true, ready, items: ready ? await messageRows(base) : [] });
  if (!ready) throw fail(503, '红会留言墙数据表尚未配置，请联系平台维护人。');
  const now = new Date().toISOString();
  if (req.method === 'POST' && url.pathname === root) {
    const row = { ...messagePayload(await readJson(req)), 留言ID: `MSG-${randomUUID()}`, 创建人: session.username, 创建时间: now, 更新人: session.username, 更新时间: now };
    const result = await base.appendRow(MESSAGE_TABLE, row);
    await audit(req, session, 'messages.create', result._id, 'success', {});
    return json(res, 201, { ok: true });
  }
  const match = url.pathname.match(/^\/api\/community\/messages\/([^/]+)$/);
  if (match && req.method === 'PATCH') {
    const id = decodeURIComponent(match[1]);
    if (!(await messageRows(base)).some(r => r.id === id)) throw fail(404, '留言不存在');
    const row = { ...messagePayload(await readJson(req)), 更新人: session.username, 更新时间: now };
    await base.updateRow(MESSAGE_TABLE, id, row);
    await audit(req, session, 'messages.update', id, 'success', { status: row['状态'] });
    return json(res, 200, { ok: true });
  }
  throw fail(405, '不支持此留言操作');
}
