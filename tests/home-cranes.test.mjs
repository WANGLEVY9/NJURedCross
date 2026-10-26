import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openCraneStore, craneRoutes } from '../lib/community/cranes.js';

const url = new URL('http://synthetic/api/public/cranes');
async function fixture(t) {
  const store = await openCraneStore(':memory:');
  t.after(() => store.close());
  return { store, session: { username: 'synthetic-member' },
    json: (_res, status, body) => ({ status, body }), readJson: async req => req.body, audit: async () => {} };
}
test('paper cranes publish immediately, expose no account identity and have no moderation state', async t => {
  const context = await fixture(t);
  const result = await craneRoutes({ method: 'POST', body: { content: '愿善意传递', consent: true, status: '草稿' } }, {}, url, context);
  assert.equal(result.status, 201);
  assert.equal(result.body.item.author, '一位南大志愿者');
  const feed = await craneRoutes({ method: 'GET' }, {}, url, { ...context, session: null });
  assert.deepEqual(feed.body.items, [result.body.item]);
  assert.deepEqual(Object.keys(feed.body.items[0]).sort(), ['author', 'content', 'id']);
});
test('anonymous, oversized and unconsented writes never persist', async t => {
  const context = await fixture(t);
  await assert.rejects(craneRoutes({ method: 'POST', body: {} }, {}, url, { ...context, session: null }), e => e.statusCode === 401);
  for (const body of [{ content: 'hello' }, { content: '', consent: true }, { content: 'a'.repeat(201), consent: true }, { content: 'hello', author: 'a'.repeat(21), consent: true }]) {
    await assert.rejects(craneRoutes({ method: 'POST', body }, {}, url, context), e => e.statusCode === 400);
  }
  assert.deepEqual(context.store.list(), []);
});
test('wall routes are outside the crane domain; latest twelve are returned newest first', async t => {
  const context = await fixture(t);
  assert.equal(await craneRoutes({ method: 'GET' }, {}, new URL('http://synthetic/api/community/messages'), context), false);
  for (let i = 0; i < 15; i++) context.store.create({ content: `寄语${i}`, author: '合成署名', actor: 'private-account' });
  assert.equal(context.store.list().length, 12);
  assert.equal(context.store.list()[0].content, '寄语14');
  assert.equal(context.store.list().at(-1).content, '寄语3');
});
test('independent crane data survives a server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'njurc-cranes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'cranes.sqlite');
  const first = await openCraneStore(file);
  const item = first.create({ content: '重启后还在', author: '合成署名', actor: 'private-account' });
  first.close();
  const reopened = await openCraneStore(file);
  try { assert.deepEqual(reopened.list(), [item]); } finally { reopened.close(); }
});
