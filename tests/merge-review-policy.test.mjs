import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { applyReviewStep, authorizeReviewStep, requireReviewChecklist } from '../lib/attachment/review-policy.js';
import { createMutationQueue } from '../lib/events/safety.js';
import { assertSchemaTarget } from '../lib/schema-target.js';

const directory = [
  { category: '全部', role: '对接人', email: 'liaison@example.invalid', enabled: true },
  { category: '全部', role: '审核人', email: 'final@example.invalid', enabled: true },
];

test('schema writes require an explicit authenticated UUID match', () => {
  const uuid = '11111111-1111-1111-1111-111111111111';
  assertSchemaTarget(uuid, undefined);
  assert.throws(() => assertSchemaTarget(uuid, undefined, { apply: true }), /explicit/);
  assert.throws(() => assertSchemaTarget(uuid, '22222222-2222-2222-2222-222222222222'), /differs/);
  assert.doesNotThrow(() => assertSchemaTarget(uuid, uuid, { apply: true }));
});

test('unconfigured/ambiguous assignments and incomplete templates fail closed', () => {
  const shape = { category: '红会新闻' }, account = { email: directory[0].email };
  for (const rows of [[], [{ ...directory[0], email: '' }], [...directory, directory[0]]]) {
    assert.throws(() => authorizeReviewStep(shape, account, rows), e => e.statusCode === 503);
  }
  for (const rows of [[], [{ id: '' }], [{ id: 'x' }, { id: 'x' }]]) {
    assert.throws(() => requireReviewChecklist(rows), e => e.statusCode === 503);
  }
});

test('HTTP review step: wrong identity, missing checklist, forged role and concurrent stale step', async t => {
  let row = { _id: 'r1', 投稿ID: 's1', 类别: '红会新闻' }, template = [{ id: 'check-1' }], writes = 0;
  const serial = createMutationQueue();
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const result = await serial(() => applyReviewStep({
        client: { async updateRow(_table, _id, patch) { writes++; row = { ...row, ...patch }; } },
        table: 'synthetic', contentId: 's1', body,
        account: { email: req.headers['x-test-account'] }, reviewer: req.headers['x-test-account'],
        readRows: async () => [structuredClone(row)], readAssignees: async () => directory,
        readChecklist: async () => template,
        shapeOf: r => ({ category: r.类别, status: r.审核状态, reviewTrail: r.审核轨迹 }),
      }));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.advance.entry));
    } catch (error) { res.writeHead(error.statusCode || 500); res.end(error.code || 'error'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (email, extra = {}) => fetch(`http://127.0.0.1:${server.address().port}/step`, {
    method: 'POST', headers: { 'x-test-account': email },
    body: JSON.stringify({ decision: 'approve', checklist: ['check-1'], expectedLevel: 1, ...extra }),
  });
  assert.equal((await post('unassigned@example.invalid', { role: 'outreach_liaison' })).status, 403);
  template = []; assert.equal((await post(directory[0].email)).status, 503); assert.equal(writes, 0);
  template = [{ id: 'check-1' }];
  const first = await post(directory[0].email, { role: 'invented-role' });
  assert.equal(first.status, 200); assert.equal((await first.json()).role, 'outreach_liaison');
  assert.equal((await post(directory[0].email, { expectedLevel: 2 })).status, 403);
  assert.equal((await post(directory[1].email)).status, 409);
  const results = await Promise.all([post(directory[1].email, { expectedLevel: 2 }), post(directory[1].email, { expectedLevel: 2 })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(writes, 2);
  row = { _id: 'r1', 投稿ID: 's1', 类别: '文创设计', 发布形式: '文创设计' };
  // Design deliberately uses the same liaison for its first two stages.
  const shape = { category: '文创设计', publishForm: '文创设计', reviewTrail: JSON.stringify([{ decision: 'approve', level: 1 }]) };
  assert.equal(authorizeReviewStep(shape, { email: directory[0].email }, directory).role, 'outreach_liaison');
});
