import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_COLUMNS,
  FEEDBACK_TABLE,
  feedbackRow,
  feedbackRoutes,
  feedbackSchemaReady,
  normalizeFeedback,
} from '../lib/feedback/index.js';

function syntheticBase({ ready = true, rows = [] } = {}) {
  const appended = [];
  const updates = [];
  return {
    appended,
    updates,
    async getMetadata() {
      return {
        tables: ready ? [{
          name: FEEDBACK_TABLE,
          columns: FEEDBACK_COLUMNS.map((name) => ({ name, type: 'text' })),
        }] : [],
      };
    },
    async appendRow(table, row) {
      assert.equal(table, FEEDBACK_TABLE);
      appended.push(row);
      return { _id: 'row-1' };
    },
    async listRows() {
      return rows;
    },
    async getRow(table, id) {
      assert.equal(table, FEEDBACK_TABLE);
      return rows.find((row) => row._id === id) || null;
    },
    async updateRow(table, id, patch) {
      assert.equal(table, FEEDBACK_TABLE);
      updates.push({ id, patch });
      Object.assign(rows.find((row) => row._id === id), patch);
    },
  };
}

function context(base, overrides = {}) {
  return {
    json: (_res, status, body) => ({ status, body }),
    readJson: async (req) => req.body,
    getBase: async () => base,
    enforceLimit: () => {},
    recordAudit: async () => {},
    getSession: () => null,
    getAccount: () => null,
    isAccountActive: () => true,
    requireConsoleAccess: (_req, res) => res.consoleSession || null,
    requireCsrf: () => true,
    ...overrides,
  };
}

test('feedback categories and payload are validated at the public boundary', () => {
  assert.deepEqual(FEEDBACK_CATEGORIES, ['活动', '物资', '内建', '宣传', '其他']);
  assert.deepEqual(normalizeFeedback({ category: '活动', content: '  希望报名页更清楚  ' }), {
    category: '活动',
    content: '希望报名页更清楚',
  });
  assert.throws(() => normalizeFeedback({ category: '系统', content: '内容' }), /有效的问题分类/);
  assert.throws(() => normalizeFeedback({ category: '活动', content: '   ' }), /请填写反馈意见/);
  assert.throws(() => normalizeFeedback({ category: '活动', content: '字'.repeat(201) }), /不能超过 200 字/);
  assert.equal(normalizeFeedback({ category: '其他', content: '😀'.repeat(200) }).content.length, 400);
  assert.doesNotThrow(() => normalizeFeedback({ category: '其他', content: '😀'.repeat(200) }));
});

test('anonymous and signed-in submissions keep only the intended attribution', () => {
  const anonymous = feedbackRow({ category: '宣传', content: '建议增加往期内容' });
  assert.equal(anonymous['提交人'], '访客');
  assert.equal(anonymous['提交人标识'], '');
  assert.equal(anonymous['来源'], '公众访客');
  assert.equal(anonymous['状态'], '待解决');

  const signedIn = feedbackRow(
    { category: '内建', content: '希望内建活动有更多说明' },
    { session: { username: 'synthetic-user' }, account: { accountId: 'ACC-1', realName: '合成成员', email: 'private@example.invalid' } },
  );
  assert.equal(signedIn['提交人'], '合成成员');
  assert.equal(signedIn['提交人标识'], 'ACC-1');
  assert.equal(signedIn['来源'], '活动平台成员');
  assert.equal(Object.hasOwn(signedIn, '邮箱'), false);
});

test('public submission writes, audits, and never trusts client attribution', async () => {
  const base = syntheticBase();
  const audits = [];
  const limits = [];
  const result = await feedbackRoutes(
    { method: 'POST', body: { category: '物资', content: '借用流程可以更清楚', submitter: '伪造身份' } },
    {},
    { pathname: '/api/public/feedback' },
    context(base, {
      recordAudit: async (_req, session, action, target, outcome, metadata) => {
        audits.push({ session, action, target, outcome, metadata });
      },
      enforceLimit: (_req, bucket, limit) => limits.push({ bucket, limit }),
    }),
  );
  assert.equal(result.status, 201);
  assert.equal(base.appended.length, 1);
  assert.equal(base.appended[0]['提交人'], '访客');
  assert.equal(audits[0].action, 'feedback.submit');
  assert.deepEqual(audits[0].metadata, { category: '物资' });
  assert.deepEqual(limits, [{ bucket: 'feedback', limit: 5 }]);
});

test('cross-origin public feedback is refused before writing', async () => {
  const base = syntheticBase();
  const result = await feedbackRoutes(
    {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'njuredcross.cn' },
      body: { category: '活动', content: '合成跨站提交' },
    },
    {},
    { pathname: '/api/public/feedback' },
    context(base),
  ).catch((error) => error);
  assert.equal(result.statusCode, 403);
  assert.equal(result.code, 'origin_forbidden');
  assert.equal(base.appended.length, 0);
});

test('missing schema blocks writes and the console reports readiness', async () => {
  const base = syntheticBase({ ready: false });
  const write = await feedbackRoutes(
    { method: 'POST', body: { category: '活动', content: '测试' } },
    {},
    { pathname: '/api/public/feedback' },
    context(base),
  ).catch((error) => error);
  assert.equal(write.statusCode, 503);

  const read = await feedbackRoutes(
    { method: 'GET' },
    { consoleSession: { username: 'synthetic-admin', role: 'platform_admin' } },
    { pathname: '/api/console/feedback' },
    context(base),
  );
  assert.equal(read.status, 200);
  assert.equal(read.body.ready, false);
  assert.deepEqual(read.body.items, []);
});

test('console feedback is newest-first and requires a console session', async () => {
  const base = syntheticBase({
    rows: [
      { _id: 'old', 反馈ID: 'FDB-OLD', 分类: '活动', 反馈内容: '旧反馈', 提交时间: '2026-11-17T10:00:00.000Z' },
      { _id: 'new', 反馈ID: 'FDB-NEW', 分类: '宣传', 反馈内容: '新反馈', 提交人: '合成成员', 提交时间: '2026-11-18T10:00:00.000Z' },
    ],
  });
  const denied = await feedbackRoutes(
    { method: 'GET' },
    {},
    { pathname: '/api/console/feedback' },
    context(base),
  );
  assert.equal(denied, undefined);

  const read = await feedbackRoutes(
    { method: 'GET' },
    { consoleSession: { username: 'synthetic-admin', role: 'platform_admin' } },
    { pathname: '/api/console/feedback' },
    context(base),
  );
  assert.equal(read.status, 200);
  assert.equal(read.body.ready, true);
  assert.deepEqual(read.body.items.map((item) => item.id), ['new', 'old']);
  assert.deepEqual(read.body.items.map((item) => item.feedbackId), ['FDB-NEW', 'FDB-OLD']);
  assert.equal(read.body.items[0].status, '待解决');

  const inactive = await feedbackRoutes(
    { method: 'GET' },
    { consoleSession: { username: 'disabled-admin', role: 'platform_admin' } },
    { pathname: '/api/console/feedback' },
    context(base, {
      getAccount: () => ({ status: '停用' }),
      isAccountActive: () => false,
    }),
  );
  assert.equal(inactive.status, 403);
  assert.equal(inactive.body.code, 'account_inactive');
});

test('console resolution updates are audited and require CSRF', async () => {
  const rows = [{
    _id: 'feedback-row',
    反馈ID: 'FDB-RESOLVE',
    分类: '宣传',
    反馈内容: '已经修正的反馈',
    提交时间: '2026-11-18T10:00:00.000Z',
    状态: '待解决',
    解决人: '',
    解决时间: '',
  }];
  const base = syntheticBase({ rows });
  const audits = [];
  const request = {
    method: 'PATCH',
    body: { resolved: true },
  };
  const response = {
    consoleSession: { username: 'synthetic-admin', role: 'platform_admin' },
  };
  const route = (overrides = {}) => feedbackRoutes(
    request,
    response,
    { pathname: '/api/console/feedback/feedback-row' },
    context(base, {
      getAccount: () => ({ accountId: 'ACC-ADMIN', realName: '合成管理员' }),
      recordAudit: async (_req, _session, action, target, result, metadata) => {
        audits.push({ action, target, result, metadata });
      },
      ...overrides,
    }),
  );

  assert.equal(await route({ requireCsrf: () => false }), undefined);
  assert.equal(base.updates.length, 0);
  const resolved = await route();
  assert.equal(resolved.status, 200);
  assert.equal(rows[0]['状态'], '已解决');
  assert.equal(rows[0]['解决人'], '合成管理员');
  assert.match(rows[0]['解决时间'], /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(base.updates.length, 1);
  assert.equal(audits[0].action, 'feedback.resolve');
  assert.equal(audits[0].metadata.feedbackId, 'FDB-RESOLVE');

  request.body = { resolved: false };
  const reopened = await route();
  assert.equal(reopened.status, 200);
  assert.equal(rows[0]['状态'], '待解决');
  assert.equal(rows[0]['解决人'], '');
  assert.equal(rows[0]['解决时间'], '');
  assert.equal(audits[1].action, 'feedback.reopen');
});

test('schema readiness requires every declared text column', async () => {
  assert.equal(await feedbackSchemaReady(syntheticBase()), true);
  assert.equal(await feedbackSchemaReady({
    async getMetadata() {
      return { tables: [{ name: FEEDBACK_TABLE, columns: [{ name: '反馈ID', type: 'text' }] }] };
    },
  }), false);
});
