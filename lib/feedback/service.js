/* ==========================================================================
   service.js — platform problem feedback (N1 平台问题反馈).
   One table, one state machine (待处理 → 处理中 → 已回复 → 已关闭). Closed is
   terminal and rejects every write. New issues and replies emit durable mail
   through an injected `notifications` object; a notify failure never blocks the
   underlying write (the caller catches, and sendMail already retries durable
   retryable kinds).
   ========================================================================== */

import { assertCompleteRows } from '../events/safety.js';
import { FEEDBACK_TABLE, FEEDBACK_STATUS, FEEDBACK_TRANSITIONS, feedbackFailure } from './schema.js';
import { FEEDBACK_CATEGORIES, FEEDBACK_SOURCE, categoryDomain, feedbackDomainOptions } from './dispatch.js';

const text = value => String(value ?? '').trim();

function fail(status, message, code = 'feedback_invalid') { const error = new Error(message); error.statusCode = status; error.code = code; throw error; }

function timestamp(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const parts = fmt.formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

const looksLikeEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));

function feedbackSummary(row) {
  return {
    id: row._id, code: `FB-${row._id}`, category: text(row['分类']), description: text(row['描述']),
    screenshot: text(row['截图']), contact: text(row['联系方式']), submitter: text(row['提交人姓名']) || '未填写',
    submitterAccount: text(row['提交人账号']), source: text(row['提交来源']), domain: text(row['业务域']),
    status: text(row['状态']) || FEEDBACK_STATUS.PENDING, handler: text(row['处理人']), note: text(row['处理说明']),
    submittedAt: text(row['提交时间']), startedAt: text(row['开始处理时间']), repliedAt: text(row['回复时间']), closedAt: text(row['关闭时间']),
  };
}

export function createFeedbackService({ client, listRows, actor = '管理员', locks = new Map(), now = () => timestamp(), notifications = null } = {}) {
  const listTable = async table => { try { return await listRows(table); } catch { fail(502, '数据服务读取失败，请稍后重试。', 'feedback_storage_failed'); } };
  const append = async (table, row) => {
    let result;
    try { result = await client.appendRow(table, row); } catch { fail(502, '数据服务写入失败，请稍后重试。', 'feedback_storage_failed'); }
    if (!result?._id) fail(502, '数据服务未确认记录结果，请核查后重试。', 'feedback_storage_failed');
    return result;
  };
  const update = async (table, id, patch) => {
    let result;
    try { result = await client.updateRow(table, id, patch); } catch { fail(502, '数据服务更新失败，请稍后重试。', 'feedback_storage_failed'); }
    if (result?.success === false || result?.updated_row_count === 0) fail(502, '数据服务未确认更新结果，请核查后重试。', 'feedback_storage_failed');
    const rows = await listTable(table); assertCompleteRows(rows);
    const persisted = rows.find(row => row._id === id);
    const confirmed = persisted && Object.entries(patch).every(([key, value]) => String(persisted[key] ?? '') === String(value ?? ''));
    if (!confirmed) fail(502, '数据服务更新结果尚未确认，请刷新核查后重试。', 'feedback_storage_failed');
    return result;
  };
  async function withLocks(keys, task) {
    const ordered = [...new Set(keys.filter(Boolean))].sort();
    async function acquire(index) {
      if (index === ordered.length) return task();
      const key = ordered[index], previous = locks.get(key) || Promise.resolve();
      let release; const current = new Promise(resolve => { release = resolve; }); locks.set(key, current);
      await previous;
      try { return await acquire(index + 1); } finally { release(); if (locks.get(key) === current) locks.delete(key); }
    }
    return acquire(0);
  }
  function actorName() { return typeof actor === 'function' ? actor() : actor; }

  async function submit(body, submitter) {
    const category = text(body.category);
    if (!FEEDBACK_CATEGORIES.includes(category)) fail(400, '请选择有效的问题分类');
    const description = text(body.description);
    if (!description || description.length > 2000) fail(400, '问题描述应为 1 至 2000 个字符');
    const contact = text(body.contact); if (contact.length > 200) fail(400, '联系方式不能超过 200 个字符');
    const screenshot = text(body.screenshot); if (screenshot.length > 1000) fail(400, '截图地址过长');
    const source = FEEDBACK_SOURCE[text(body.source) === 'console' ? 'CONSOLE' : 'PORTAL'];
    const domain = categoryDomain(category);
    const row = {
      '分类': category, '描述': description, '截图': screenshot, '联系方式': contact,
      '提交人姓名': submitter?.realName || '未填写', '提交人账号': submitter?.account || submitter?.id || '',
      '提交来源': source, '业务域': domain, '状态': FEEDBACK_STATUS.PENDING, '提交时间': now(),
    };
    const result = await append(FEEDBACK_TABLE, row);
    const issue = feedbackSummary({ ...row, ...result });
    try { await notifications?.notifyNewIssue(issue); } catch { /* 通知失败不阻塞提交。 */ }
    return { ok: true, issue, message: '问题已提交，我们会尽快处理。' };
  }

  async function list(params = {}) {
    const get = key => text(typeof params.get === 'function' ? params.get(key) : params[key]);
    const rows = await listTable(FEEDBACK_TABLE); assertCompleteRows(rows);
    let items = rows.slice().sort((a, b) => text(b['提交时间']).localeCompare(text(a['提交时间'])));
    if (get('status')) items = items.filter(row => (text(row['状态']) || FEEDBACK_STATUS.PENDING) === get('status'));
    if (get('category')) items = items.filter(row => text(row['分类']) === get('category'));
    if (get('domain')) items = items.filter(row => text(row['业务域']) === get('domain'));
    if (get('q')) items = items.filter(row => [row['描述'], row['提交人姓名'], row['处理说明'], row['分类']].some(value => text(value).toLowerCase().includes(get('q').toLowerCase())));
    return { ok: true, issues: items.map(feedbackSummary), total: items.length };
  }

  async function get(id) {
    const rows = await listTable(FEEDBACK_TABLE); assertCompleteRows(rows);
    const row = rows.find(item => item._id === id);
    if (!row) fail(404, '问题反馈不存在');
    return { ok: true, issue: feedbackSummary(row) };
  }

  async function transition(id, { action = '', note = '' } = {}) {
    return withLocks([`feedback:${id}`], async () => {
      const rows = await listTable(FEEDBACK_TABLE); assertCompleteRows(rows);
      const row = rows.find(item => item._id === id);
      if (!row) fail(404, '问题反馈不存在');
      const status = text(row['状态']) || FEEDBACK_STATUS.PENDING;
      const target = { start: FEEDBACK_STATUS.PROCESSING, reply: FEEDBACK_STATUS.REPLIED, close: FEEDBACK_STATUS.CLOSED }[action];
      if (!target) fail(400, '不支持该处理动作');
      const allowed = FEEDBACK_TRANSITIONS[status];
      if (!allowed || !allowed.has(target)) fail(409, `当前状态「${status}」不能转为「${target}」`);
      const noteText = text(note);
      if (action === 'reply' && (!noteText || noteText.length > 2000)) fail(400, '回复说明应为 1 至 2000 个字符');
      const patch = { '状态': target, '处理人': actorName() };
      const stamp = now();
      if (action === 'start') patch['开始处理时间'] = stamp;
      if (action === 'reply') { patch['处理说明'] = noteText; patch['回复时间'] = stamp; }
      if (action === 'close') { patch['关闭时间'] = stamp; if (noteText) patch['处理说明'] = noteText; }
      await update(FEEDBACK_TABLE, id, patch);
      const issue = feedbackSummary({ ...row, ...patch });
      if (action === 'reply') {
        const recipient = looksLikeEmail(text(row['联系方式'])) ? text(row['联系方式']) : null;
        try { await notifications?.notifyReply(issue, recipient); } catch { /* 回复先落库，通知失败不阻塞。 */ }
      }
      return { ok: true, issue, message: action === 'start' ? '已开始处理。' : action === 'reply' ? '已回复提交人。' : '问题已关闭。' };
    });
  }

  async function summary() {
    const rows = await listTable(FEEDBACK_TABLE); assertCompleteRows(rows);
    const counts = { [FEEDBACK_STATUS.PENDING]: 0, [FEEDBACK_STATUS.PROCESSING]: 0, [FEEDBACK_STATUS.REPLIED]: 0, [FEEDBACK_STATUS.CLOSED]: 0 };
    for (const row of rows) { const status = text(row['状态']) || FEEDBACK_STATUS.PENDING; counts[status] = (counts[status] || 0) + 1; }
    const pending = rows.filter(row => (text(row['状态']) || FEEDBACK_STATUS.PENDING) === FEEDBACK_STATUS.PENDING)
      .sort((a, b) => text(b['提交时间']).localeCompare(text(a['提交时间']))).map(feedbackSummary);
    return { ok: true, counts, total: rows.length, pending };
  }

  function dispatchOptions() { return { ok: true, categories: FEEDBACK_CATEGORIES, domains: feedbackDomainOptions() }; }

  return { submit, list, get, transition, summary, dispatchOptions };
}

export { FEEDBACK_STATUS, FEEDBACK_CATEGORIES, FEEDBACK_SOURCE, categoryDomain };
