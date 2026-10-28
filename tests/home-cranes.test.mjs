import test from 'node:test';
import assert from 'node:assert/strict';
import { craneRoutes, CRANE_TABLE, CRANE_COLUMNS } from '../lib/community/cranes.js';

const url = new URL('http://synthetic/api/public/cranes');

function fixture({ ready = true, rows = [] } = {}) {
  const base = {
    async getMetadata() {
      return { tables: ready ? [{ name: CRANE_TABLE, columns: CRANE_COLUMNS.map(name => ({ name, type: 'text' })) }] : [] };
    },
    async listRows(_table, _view, _order, _convert, start = 0, limit = 500) {
      return rows.slice(start, start + limit).map(row => ({ ...row }));
    },
    async appendRow(_table, row) {
      const item = { ...row, _id: `row-${rows.length + 1}` };
      rows.push(item);
      return { _id: item._id };
    },
  };
  return { rows, base, session: { username: 'synthetic-member' },
    json: (_res, status, body) => ({ status, body }), readJson: async req => req.body, audit: async () => {} };
}

test('submissions land in NJUTable as pending and stay hidden until approved', async () => {
  const context = fixture();
  const result = await craneRoutes({ method: 'POST', body: { content: '愿善意传递', consent: true, status: '已发布' } }, {}, url, context);
  assert.equal(result.status, 201);
  assert.equal(result.body.items.length, 0);
  assert.match(result.body.message, /正在审核中/);
  assert.equal(context.rows.length, 1);
  assert.equal(context.rows[0]['状态'], '待审核');
  assert.equal(context.rows[0]['内容'], '愿善意传递');
  assert.equal(context.rows[0]['署名'], '一位南大志愿者');
  assert.equal(context.rows[0]['创建人'], 'synthetic-member');
  assert.match(context.rows[0]['寄语ID'], /^CRANE-/);

  const pending = await craneRoutes({ method: 'GET' }, {}, url, { ...context, session: null });
  assert.deepEqual(pending.body.items, []);

  context.rows[0]['状态'] = '已发布';
  const approved = await craneRoutes({ method: 'GET' }, {}, url, { ...context, session: null });
  assert.deepEqual(approved.body.items, [{ id: 'row-1', content: '愿善意传递', author: '一位南大志愿者' }]);
  assert.deepEqual(Object.keys(approved.body.items[0]).sort(), ['author', 'content', 'id']);
});

test('withdrawn and pending rows never reach the homepage feed', async () => {
  const context = fixture({ rows: [
    { _id: 'a', 内容: '已发布', 状态: '已发布', 更新时间: '2026-10-12T03:00:00.000Z' },
    { _id: 'b', 内容: '待审核', 状态: '待审核', 更新时间: '2026-10-12T02:00:00.000Z' },
    { _id: 'c', 内容: '已下架', 状态: '已下架', 更新时间: '2026-10-12T01:00:00.000Z' },
  ] });
  const feed = await craneRoutes({ method: 'GET' }, {}, url, { ...context, session: null });
  assert.deepEqual(feed.body.items.map(item => item.content), ['已发布']);
});

test('anonymous, oversized and unconsented writes never persist', async () => {
  const context = fixture();
  await assert.rejects(craneRoutes({ method: 'POST', body: {} }, {}, url, { ...context, session: null }), e => e.statusCode === 401);
  for (const body of [{ content: 'hello' }, { content: '', consent: true }, { content: 'a'.repeat(201), consent: true }, { content: 'hello', author: 'a'.repeat(21), consent: true }]) {
    await assert.rejects(craneRoutes({ method: 'POST', body }, {}, url, context), e => e.statusCode === 400);
  }
  assert.deepEqual(context.rows, []);
});

test('wall routes are outside the crane domain; the feed caps at twelve newest rows', async () => {
  const context = fixture();
  assert.equal(await craneRoutes({ method: 'GET' }, {}, new URL('http://synthetic/api/community/messages'), context), false);
  context.rows.push(...Array.from({ length: 15 }, (_, i) => ({
    _id: `row-${i}`, 内容: `寄语${i}`, 署名: '合成署名', 状态: '已发布',
    更新时间: `2026-10-12T${String(i).padStart(2, '0')}:00:00.000Z`,
  })));
  const feed = await craneRoutes({ method: 'GET' }, {}, url, { ...context, session: null });
  assert.equal(feed.body.items.length, 12);
  assert.equal(feed.body.items[0].content, '寄语14');
  assert.equal(feed.body.items.at(-1).content, '寄语3');
});

test('an unconfigured crane table rejects writes and serves an empty feed', async () => {
  const context = fixture({ ready: false });
  const feed = await craneRoutes({ method: 'GET' }, {}, url, { ...context, session: null });
  assert.deepEqual(feed.body, { ok: true, ready: false, items: [] });
  await assert.rejects(craneRoutes({ method: 'POST', body: { content: '愿善意传递', consent: true } }, {}, url, context), e => e.statusCode === 503);
  assert.deepEqual(context.rows, []);
});
