import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_COLUMNS,
  FEEDBACK_BLOOD_ACTIVITY_ID,
  FEEDBACK_TABLE,
  feedbackActivityChoices,
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
      const saved = { ...row, _id: `row-${appended.length + 1}` };
      appended.push(saved);
      rows.push(saved);
      return { _id: saved._id };
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
    resolveFeedbackEmail: async ({ session, account, body }) => (
      session ? String(account?.email || '') : String(body?.contactEmail || '')
    ),
    resolveReplyEmail: async (row) => String(row?.['反馈人邮箱'] || ''),
    sendResolutionMail: async () => ({ ok: true }),
    canViewActivity: async () => true,
    ...overrides,
  };
}

test('feedback categories and payload are validated at the public boundary', () => {
  assert.deepEqual(FEEDBACK_CATEGORIES, ['活动', '物资', '内建', '宣传', '其他']);
  assert.deepEqual(normalizeFeedback({ category: '活动', activityId: 'workflow:event-1', content: '  希望报名页更清楚  ' }), {
    category: '活动',
    content: '希望报名页更清楚',
    activityId: 'workflow:event-1',
  });
  assert.throws(() => normalizeFeedback({ category: '系统', content: '内容' }), /有效的问题分类/);
  assert.throws(() => normalizeFeedback({ category: '活动', content: '   ' }), /请填写反馈意见/);
  assert.throws(() => normalizeFeedback({ category: '活动', content: '缺少活动' }), /选择反馈对应的活动/);
  assert.throws(() => normalizeFeedback({ category: '活动', content: '字'.repeat(201) }), /不能超过 200 字/);
  assert.equal(normalizeFeedback({ category: '其他', content: '😀'.repeat(200) }).content.length, 400);
  assert.doesNotThrow(() => normalizeFeedback({ category: '其他', content: '😀'.repeat(200) }));
});

test('feedback activity choices group blood into one programme with fixed sites and keep centre categories', () => {
  const choices = feedbackActivityChoices([
    { eventId: 'blood-a', name: '合成献血车一', type: '献血车专项', status: '报名中', location: '新街口中央' },
    { eventId: 'blood-b', name: '合成献血车二', type: '献血车专项', status: '进行中', location: '仙林学则路' },
    { eventId: 'care', name: '合成急救活动', activityCategory: '生命中心', type: '公益活动', status: '报名中', location: '合成教室' },
  ]);
  assert.equal(choices.filter((choice) => choice.center === '献血车专项').length, 1);
  const blood = choices.find((choice) => choice.id === FEEDBACK_BLOOD_ACTIVITY_ID);
  assert.equal(blood.name, '献血车活动');
  assert.deepEqual(blood.locations, ['新街口中央', '新街口印象汇', '仙林学则路', '浦口弘阳广场']);
  assert.equal(blood.status, '报名中');
  assert.equal(choices.find((choice) => choice.id === 'care').center, '生命中心');
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
    {
      method: 'POST',
      body: {
        category: '物资',
        content: '借用流程可以更清楚',
        contactEmail: 'feedback@example.test',
        submitter: '伪造身份',
      },
    },
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
  assert.deepEqual(audits[0].metadata, { category: '物资', activityId: '', ownerMailStatus: '' });
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
    {
      method: 'POST',
      body: { category: '其他', content: '测试', contactEmail: 'feedback@example.test' },
    },
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
  assert.equal(read.body.items[0].status, '待解决');
  assert.equal(Object.hasOwn(read.body.items[0], 'submitter'), false);
  assert.equal(Object.hasOwn(read.body.items[0], 'feedbackId'), false);
  assert.equal(Object.hasOwn(read.body.items[0], 'source'), false);

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
    反馈人邮箱: 'feedback-person@example.test',
    解决方案: '',
    解决通知状态: '',
    解决通知时间: '',
  }];
  const base = syntheticBase({ rows });
  const audits = [];
  const mails = [];
  const request = {
    method: 'PATCH',
    body: { resolved: true, solution: '已补充说明并修正流程。' },
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
      sendResolutionMail: async (message) => {
        mails.push(message);
        return { ok: true };
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
  assert.equal(rows[0]['解决方案'], '已补充说明并修正流程。');
  assert.equal(rows[0]['解决通知状态'], '已发送');
  assert.equal(base.updates.length, 2);
  assert.equal(mails[0].to, 'feedback-person@example.test');
  assert.match(mails[0].text, /已补充说明并修正流程/);
  assert.equal(audits[0].action, 'feedback.resolve');
  assert.equal(audits[0].metadata.feedbackId, 'FDB-RESOLVE');

  request.body = { resolved: false };
  const reopened = await route();
  assert.equal(reopened.status, 200);
  assert.equal(rows[0]['状态'], '待解决');
  assert.equal(rows[0]['解决人'], '');
  assert.equal(rows[0]['解决时间'], '');
  assert.equal(rows[0]['解决方案'], '');
  assert.equal(rows[0]['解决通知状态'], '');
  assert.equal(audits[1].action, 'feedback.reopen');
});

test('activity feedback is hidden from managers without owner, presidium or super-admin authority', async () => {
  const rows = [
    {
      _id: 'hidden-activity',
      反馈ID: 'FDB-HIDDEN',
      分类: '活动',
      反馈内容: '只允许相关角色查看',
      关联活动ID: 'workflow:event-private',
      关联活动名称: '权限活动',
      提交时间: '2026-11-18T10:00:00.000Z',
      状态: '待解决',
    },
    {
      _id: 'visible-general',
      反馈ID: 'FDB-VISIBLE',
      分类: '物资',
      反馈内容: '一般管理员可见',
      提交时间: '2026-11-18T09:00:00.000Z',
      状态: '待解决',
    },
  ];
  const base = syntheticBase({ rows });
  const read = await feedbackRoutes(
    { method: 'GET' },
    { consoleSession: { username: 'ordinary-admin', role: 'platform_admin' } },
    { pathname: '/api/console/feedback' },
    context(base, {
      canViewActivity: async (activityId) => activityId !== 'workflow:event-private',
    }),
  );
  assert.deepEqual(read.body.items.map((item) => item.id), ['visible-general']);

  const denied = await feedbackRoutes(
    {
      method: 'PATCH',
      body: { resolved: true, solution: '不应执行' },
    },
    { consoleSession: { username: 'ordinary-admin', role: 'platform_admin' } },
    { pathname: '/api/console/feedback/hidden-activity' },
    context(base, {
      canViewActivity: async () => false,
    }),
  ).catch((error) => error);
  assert.equal(denied.statusCode, 404);
  assert.equal(rows[0]['状态'], '待解决');
});

test('solving feedback requires a solution and a usable reply mailbox', async () => {
  const rows = [{
    _id: 'no-reply-email',
    反馈ID: 'FDB-NO-EMAIL',
    分类: '其他',
    反馈内容: '缺少联系邮箱',
    提交时间: '2026-11-18T10:00:00.000Z',
    状态: '待解决',
    反馈人邮箱: '',
  }];
  const base = syntheticBase({ rows });
  const response = {
    consoleSession: { username: 'synthetic-admin', role: 'platform_admin' },
  };
  const url = { pathname: '/api/console/feedback/no-reply-email' };
  const missingSolution = await feedbackRoutes(
    { method: 'PATCH', body: { resolved: true, solution: '' } },
    response,
    url,
    context(base),
  ).catch((error) => error);
  assert.equal(missingSolution.code, 'feedback_solution_required');
  const missingEmail = await feedbackRoutes(
    { method: 'PATCH', body: { resolved: true, solution: '已完成处理' } },
    response,
    url,
    context(base),
  ).catch((error) => error);
  assert.equal(missingEmail.code, 'feedback_reply_email_unavailable');
  assert.equal(rows[0]['状态'], '待解决');
});

test('historical feedback resolves a verified account mailbox without exposing it', async () => {
  const rows = [{
    _id: 'legacy-feedback',
    反馈ID: 'FDB-LEGACY',
    分类: '活动',
    反馈内容: '历史反馈',
    提交人标识: 'ACC-MEMBER',
    关联活动ID: 'workflow:legacy',
    关联活动名称: '历史活动',
    提交时间: '2026-11-18T10:00:00.000Z',
    状态: '待解决',
    反馈人邮箱: '',
  }];
  const base = syntheticBase({ rows });
  const mails = [];
  const result = await feedbackRoutes(
    { method: 'PATCH', body: { resolved: true, solution: '已完成历史问题处理' } },
    { consoleSession: { username: 'synthetic-admin', role: 'platform_admin' } },
    { pathname: '/api/console/feedback/legacy-feedback' },
    context(base, {
      getAccount: () => ({ accountId: 'ACC-ADMIN', realName: '合成管理员' }),
      resolveReplyEmail: async (row) => row['提交人标识'] === 'ACC-MEMBER' ? 'member@example.test' : '',
      sendResolutionMail: async (message) => {
        mails.push(message);
        return { ok: true };
      },
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(mails[0].to, 'member@example.test');
  assert.equal(JSON.stringify(result.body).includes('member@example.test'), false);
});

test('activity feedback requires the selected public activity and emails its owners', async () => {
  const base = syntheticBase();
  const mails = [];
  const audits = [];
  const result = await feedbackRoutes(
    {
      method: 'POST',
      body: {
        category: '活动',
        activityId: 'workflow:event-1',
        content: '现场指引不清楚，希望补充路线说明。',
        contactEmail: 'feedback@example.test',
      },
    },
    {},
    { pathname: '/api/public/feedback' },
    context(base, {
      resolveActivity: async (activityId) => ({
        id: activityId,
        name: '校园急救培训',
        recipients: [{ email: 'owner@example.test', name: '合成负责人' }],
      }),
      sendActivityMail: async (message) => {
        mails.push(message);
        return { ok: true };
      },
      recordAudit: async (_req, _session, action, _target, _outcome, metadata) => {
        audits.push({ action, metadata });
      },
      managementUrl: 'https://platform.example/console/feedback',
    }),
  );
  assert.equal(result.status, 201);
  assert.equal(base.appended.length, 1);
  assert.equal(base.appended[0]['关联活动ID'], 'workflow:event-1');
  assert.equal(base.appended[0]['关联活动名称'], '校园急救培训');
  assert.equal(base.appended[0]['负责人邮件状态'], '已发送');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'owner@example.test');
  assert.match(mails[0].text, /校园急救培训/);
  assert.match(mails[0].text, /现场指引不清楚/);
  assert.equal(result.body.notification.ok, true);
  assert.equal(audits[0].metadata.activityId, 'workflow:event-1');
  assert.equal(audits[0].metadata.ownerMailStatus, '已发送');
});

test('activity feedback is refused before storage when no owner email can receive it', async () => {
  const base = syntheticBase();
  const result = await feedbackRoutes(
    {
      method: 'POST',
      body: {
        category: '活动',
        activityId: 'workflow:event-2',
        content: '无法送达的反馈',
        contactEmail: 'feedback@example.test',
      },
    },
    {},
    { pathname: '/api/public/feedback' },
    context(base, {
      resolveActivity: async (activityId) => ({
        id: activityId,
        name: '邮箱缺失的活动',
        recipients: [],
      }),
      sendActivityMail: async () => ({ ok: true }),
    }),
  ).catch((error) => error);
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, 'feedback_owner_email_unavailable');
  assert.equal(base.appended.length, 0);
});

test('activity feedback remains visible when owner email delivery fails', async () => {
  const base = syntheticBase();
  const result = await feedbackRoutes(
    {
      method: 'POST',
      body: {
        category: '活动',
        activityId: 'workflow:event-3',
        content: '邮件失败仍保留',
        contactEmail: 'feedback@example.test',
      },
    },
    {},
    { pathname: '/api/public/feedback' },
    context(base, {
      resolveActivity: async (activityId) => ({
        id: activityId,
        name: '邮件测试活动',
        recipients: [{ email: 'owner@example.test', name: '合成负责人' }],
      }),
      sendActivityMail: async () => {
        throw new Error('synthetic SMTP failure');
      },
    }),
  );
  assert.equal(result.status, 201);
  assert.equal(base.appended[0]['负责人邮件状态'], '发送失败');
  assert.equal(result.body.notification.ok, false);
  assert.match(result.body.message, /邮件暂未送达/);
});

test('public activity choices expose only display data', async () => {
  const result = await feedbackRoutes(
    { method: 'GET' },
    {},
    { pathname: '/api/public/feedback/activities' },
    context(syntheticBase(), {
      listActivities: async () => [{
        id: 'workflow:event-1',
        name: '校园急救培训',
        status: '报名中',
        startAt: '2026-11-20T09:00:00+08:00',
        location: '合成教学楼',
      }],
    }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.activities[0].id, 'workflow:event-1');
  assert.equal(Object.hasOwn(result.body.activities[0], 'owner'), false);
  assert.equal(JSON.stringify(result.body).includes('@'), false);
});

test('schema readiness requires every declared text column', async () => {
  assert.equal(await feedbackSchemaReady(syntheticBase()), true);
  assert.equal(await feedbackSchemaReady({
    async getMetadata() {
      return { tables: [{ name: FEEDBACK_TABLE, columns: [{ name: '反馈ID', type: 'text' }] }] };
    },
  }), false);
});
