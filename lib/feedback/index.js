import { randomUUID } from 'node:crypto';

export const FEEDBACK_TABLE = '问题反馈表';
export const FEEDBACK_CATEGORIES = Object.freeze(['活动', '物资', '内建', '宣传', '其他']);
export const FEEDBACK_MAX_LENGTH = 200;
export const FEEDBACK_COLUMNS = Object.freeze([
  '反馈ID',
  '分类',
  '反馈内容',
  '提交人',
  '提交人标识',
  '来源',
  '提交时间',
]);

export const FEEDBACK_SCHEMA = Object.freeze({
  name: FEEDBACK_TABLE,
  purpose: '活动平台用户按分类提交的问题反馈，由管理端集中查看',
  columns: FEEDBACK_COLUMNS,
});

const PAGE_SIZE = 500;
const MAX_ROWS = 20_000;

const fail = (statusCode, message, code = '') => Object.assign(
  new Error(message),
  { statusCode, ...(code ? { code } : {}) },
);

function cleanContent(value) {
  if (typeof value !== 'string') throw fail(400, '请填写反馈意见。');
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
}

/** Validate the public payload before any SeaTable write. */
export function normalizeFeedback(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw fail(400, '反馈内容格式不正确。');
  }
  const category = String(body.category ?? '').trim();
  if (!FEEDBACK_CATEGORIES.includes(category)) {
    throw fail(400, '请选择有效的问题分类。', 'feedback_category_invalid');
  }
  const content = cleanContent(body.content);
  if (!content) throw fail(400, '请填写反馈意见。');
  if (Array.from(content).length > FEEDBACK_MAX_LENGTH) {
    throw fail(400, `反馈意见不能超过 ${FEEDBACK_MAX_LENGTH} 字。`, 'feedback_too_long');
  }
  return { category, content };
}

export async function feedbackSchemaReady(base) {
  const table = (await base.getMetadata()).tables?.find((candidate) => candidate.name === FEEDBACK_TABLE);
  return Boolean(table && FEEDBACK_COLUMNS.every(
    (name) => table.columns?.some((column) => column.name === name && column.type === 'text'),
  ));
}

export async function feedbackRows(base) {
  const rows = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE_SIZE) {
    const page = await base.listRows(FEEDBACK_TABLE, '', '', false, start, PAGE_SIZE);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return {
    truncated: rows.length >= MAX_ROWS,
    items: rows
      .map((row) => ({
        id: String(row['反馈ID'] || row._id || ''),
        category: String(row['分类'] || '其他'),
        content: String(row['反馈内容'] || ''),
        submitter: String(row['提交人'] || '访客'),
        source: String(row['来源'] || '活动平台'),
        submittedAt: row['提交时间'] || '',
      }))
      .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt))),
  };
}

export function feedbackRow(body, { session = null, account = null } = {}) {
  const payload = normalizeFeedback(body);
  const submittedAt = new Date().toISOString();
  return {
    反馈ID: `FDB-${randomUUID()}`,
    分类: payload.category,
    反馈内容: payload.content,
    提交人: account?.realName || account?.displayName || session?.username || '访客',
    提交人标识: account?.accountId || session?.username || '',
    来源: session ? '活动平台成员' : '公众访客',
    提交时间: submittedAt,
  };
}

/**
 * Public submission and console read boundary. Authentication, rate limiting,
 * audit and SeaTable access are injected by server.js.
 */
export async function feedbackRoutes(req, res, url, {
  json,
  readJson,
  getBase,
  enforceLimit,
  recordAudit,
  getSession,
  getAccount,
  isAccountActive = () => true,
  requireConsoleAccess,
}) {
  const isPublic = url.pathname === '/api/public/feedback';
  const isConsole = url.pathname === '/api/console/feedback';
  if (!isPublic && !isConsole) return false;

  if (isPublic) {
    if (req.method !== 'POST') throw fail(405, '不支持此反馈操作。');
    if (req.headers?.origin) {
      let origin;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        throw fail(403, '请求来源不受信任。', 'origin_forbidden');
      }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) {
        throw fail(403, '请求来源不受信任。', 'origin_forbidden');
      }
    }
    const session = getSession?.(req) || null;
    enforceLimit(req, 'feedback', 5, session?.username || '');
    const body = await readJson(req, 4 * 1024);
    const row = feedbackRow(body, {
      session,
      account: session ? getAccount?.(session) : null,
    });
    const base = await getBase();
    if (!await feedbackSchemaReady(base)) {
      throw fail(503, '问题反馈暂未开放，请联系平台维护人。', 'feedback_unavailable');
    }
    const result = await base.appendRow(FEEDBACK_TABLE, row);
    await recordAudit(req, session, 'feedback.submit', result._id, 'success', {
      category: row['分类'],
    });
    return json(res, 201, {
      ok: true,
      feedback: { id: row['反馈ID'], category: row['分类'], submittedAt: row['提交时间'] },
      message: '反馈已提交，感谢你的建议。',
    });
  }

  const session = requireConsoleAccess(req, res);
  if (!session) return;
  if (!isAccountActive(getAccount?.(session))) {
    return json(res, 403, { ok: false, code: 'account_inactive', message: '账号未启用或已被移除。' });
  }
  if (req.method !== 'GET') throw fail(405, '问题反馈仅供查看，不支持此操作。');
  const base = await getBase();
  const ready = await feedbackSchemaReady(base);
  const result = ready ? await feedbackRows(base) : { items: [], truncated: false };
  return json(res, 200, {
    ok: true,
    ready,
    categories: FEEDBACK_CATEGORIES,
    ...result,
  });
}
