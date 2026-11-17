import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackService, FEEDBACK_STATUS, FEEDBACK_CATEGORIES, categoryDomain } from '../lib/feedback/service.js';
import { FEEDBACK_TABLE } from '../lib/feedback/schema.js';

function fixture() {
  const tables = { [FEEDBACK_TABLE]: [] };
  let sequence = 0;
  const writes = [];
  const client = {
    async appendRow(table, row) { const result = { ...structuredClone(row), _id: `fb-${++sequence}` }; tables[table].push(result); writes.push({ type: 'append', id: result._id }); return structuredClone(result); },
    async updateRow(table, id, patch) { const row = tables[table].find(item => item._id === id); if (!row) throw new Error('not-found'); Object.assign(row, structuredClone(patch)); writes.push({ type: 'update', id }); return structuredClone(row); },
  };
  const listRows = async table => { const rows = structuredClone(tables[table]); Object.defineProperty(rows, 'readMeta', { value: { total: rows.length, truncated: false } }); return rows; };
  const notifications = { calls: [], notifyNewIssue: async issue => { notifications.calls.push(['new', issue]); }, notifyReply: async (issue, to) => { notifications.calls.push(['reply', issue, to]); } };
  const options = { client, listRows, actor: '测试管理员', now: () => '2026-11-17 10:00:00', locks: new Map(), notifications };
  const createService = overrides => createFeedbackService({ ...options, ...overrides });
  const service = createService();
  return { tables, client, listRows, service, createService, notifications, writes, locks: options.locks };
}

test('提交问题创建待处理记录并触发新问题通知', async () => {
  const f = fixture();
  const result = await f.service.submit({ category: 'Bug', description: '报名页报错', contact: 'a@b.c' }, { account: 'u1', realName: '张三' });
  assert.equal(result.issue.status, FEEDBACK_STATUS.PENDING);
  assert.equal(result.issue.category, 'Bug');
  assert.equal(result.issue.domain, '综事中心');
  assert.equal(f.tables[FEEDBACK_TABLE][0]['提交来源'], '公众端');
  assert.equal(f.notifications.calls.length, 1);
  assert.equal(f.notifications.calls[0][0], 'new');
});

test('分类与描述校验', async () => {
  const f = fixture();
  await assert.rejects(f.service.submit({ category: '不存在', description: 'x' }, { account: 'u1', realName: '张三' }), /分类/);
  await assert.rejects(f.service.submit({ category: 'Bug', description: '' }, { account: 'u1', realName: '张三' }), /描述/);
});

test('状态机流转 待处理→处理中→已回复→已关闭', async () => {
  const f = fixture();
  const { issue } = await f.service.submit({ category: '时长', description: '时长不更新', contact: 'a@b.c' }, { account: 'u1', realName: '张三' });
  const id = issue.id;
  const started = await f.service.transition(id, { action: 'start' });
  assert.equal(started.issue.status, FEEDBACK_STATUS.PROCESSING);
  assert.equal(started.issue.handler, '测试管理员');
  const replied = await f.service.transition(id, { action: 'reply', note: '已修复' });
  assert.equal(replied.issue.status, FEEDBACK_STATUS.REPLIED);
  assert.equal(f.notifications.calls.some(call => call[0] === 'reply'), true);
  const closed = await f.service.transition(id, { action: 'close' });
  assert.equal(closed.issue.status, FEEDBACK_STATUS.CLOSED);
  await assert.rejects(f.service.transition(id, { action: 'start' }), /不能转为/);
});

test('回复需说明，关闭为终态拒绝一切写', async () => {
  const f = fixture();
  const { issue } = await f.service.submit({ category: '注册', description: '收不到验证码', contact: 'a@b.c' }, { account: 'u1', realName: '张三' });
  await f.service.transition(issue.id, { action: 'start' }); // → 处理中
  await assert.rejects(f.service.transition(issue.id, { action: 'reply' }), /说明/);
  assert.equal((await f.service.transition(issue.id, { action: 'close' })).issue.status, FEEDBACK_STATUS.CLOSED);
  await assert.rejects(f.service.transition(issue.id, { action: 'reply', note: 'x' }), /不能转为/);
});

test('概览统计各状态数量与待办列表', async () => {
  const f = fixture();
  const a = await f.service.submit({ category: 'Bug', description: 'x', contact: '' }, { account: 'u1', realName: '张三' });
  await f.service.transition(a.issue.id, { action: 'start' });
  await f.service.submit({ category: '报名', description: 'y', contact: '' }, { account: 'u2', realName: '李四' });
  const summary = await f.service.summary();
  assert.equal(summary.total, 2);
  assert.equal(summary.counts[FEEDBACK_STATUS.PENDING], 1);
  assert.equal(summary.counts[FEEDBACK_STATUS.PROCESSING], 1);
  assert.equal(summary.pending.length, 1);
});

test('分派选项返回分类与业务域映射，未知分类兜底综事中心', async () => {
  assert.equal(categoryDomain('时长'), '生命中心');
  assert.equal(categoryDomain('Bug'), '综事中心');
  assert.equal(categoryDomain('未知'), '综事中心');
  const f = fixture();
  const opts = f.service.dispatchOptions();
  assert.deepEqual(opts.categories, FEEDBACK_CATEGORIES);
  assert.ok(opts.domains.some(d => d.category === '时长' && d.domain === '生命中心'));
});

test('列表按分类与关键词过滤', async () => {
  const f = fixture();
  await f.service.submit({ category: 'Bug', description: '报名页报错', contact: '' }, { account: 'u1', realName: '张三' });
  await f.service.submit({ category: '时长', description: '时长不更新', contact: '' }, { account: 'u2', realName: '李四' });
  assert.equal((await f.service.list({})).total, 2);
  assert.equal((await f.service.list({ category: 'Bug' })).total, 1);
  assert.equal((await f.service.list({ q: '报名' })).total, 1);
});

test('通知失败不阻塞提交', async () => {
  const f = fixture();
  const service = f.createService({ notifications: { notifyNewIssue: async () => { throw new Error('smtp down'); }, notifyReply: async () => {} } });
  const result = await service.submit({ category: 'Bug', description: 'x', contact: '' }, { account: 'u1', realName: '张三' });
  assert.equal(result.issue.status, FEEDBACK_STATUS.PENDING);
});

test('截断的操作数据拒绝读取', async () => {
  const f = fixture();
  const truncated = f.createService({ listRows: async table => { const rows = structuredClone(f.tables[table]); Object.defineProperty(rows, 'readMeta', { value: { total: rows.length, truncated: true } }); return rows; } });
  await assert.rejects(truncated.list({}), error => error.statusCode === 503);
});
