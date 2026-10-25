import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { notifyCommunityReview, notifyBlessingDelivered } from '../lib/community/author-notifications.js';
import { deliverFriendBlessings } from '../lib/community/friend-blessings.js';
import { morningAdminRoutes } from '../lib/morning/admin.js';
import { morningRevisionRoutes } from '../lib/morning/revisions.js';
import { MORNING_CARD_TABLE, MORNING_BLACKLIST_TABLE, MORNING_REVISION_TABLE } from '../lib/morning/shared.js';

function mailbox() {
  const messages = [], refs = [];
  return { messages, refs, options: {
    accountForRef: async ref => { refs.push(ref); return { email: 'author@example.test' }; },
    send: async message => { messages.push(message); return { ok: true, transport: 'smtp' }; }, origin: 'https://example.test',
  } };
}

test('review notices use the stored author, contain feedback and distinguish later review rounds', async () => {
  const f = mailbox();
  const row = { 项目: 'birthday', 投稿ID: 'CARE-1', 提交人: 'author', 提交时间: '2026-10-20', 审核意见: '请修改措辞', 邮箱: 'forged@example.test' };
  for (const status of ['已通过', '需修改', '已拒绝', '待审核']) {
    await notifyCommunityReview({ ...f.options, row, status, reviewedAt: '2026-10-25T00:00:00Z' });
  }
  assert.equal(f.messages.length, 4);
  assert.ok(f.messages.every(message => message.to === 'author@example.test' && message.kind === 'community-notification'));
  assert.ok(f.messages[1].text.includes('请修改措辞'));
  assert.ok(f.messages[1].text.includes('修改后重新提交'));
  assert.ok(f.messages[0].text.includes('/me?focus=member-warmth-blessings'));
  const first = f.messages[0];
  await notifyCommunityReview({ ...f.options, row, status: '已通过', reviewedAt: '2026-10-25T00:00:00Z' });
  assert.equal(f.messages.at(-1).idempotencyKey, first.idempotencyKey);
  await notifyCommunityReview({ ...f.options, row, status: '已通过', reviewedAt: '2026-10-26T00:00:00Z' });
  assert.notEqual(f.messages.at(-1).idempotencyKey, first.idempotencyKey);
  assert.ok(f.refs.every(ref => ref === 'author'));
});

test('each ordinary, warehouse and friend delivery gets a private stable notice, never a pending friend receipt', async () => {
  const f = mailbox(), blessing = { submitter: 'author' };
  const receipt = { 投稿ID: 'CARE-1', 投递ID: 'DLV-1', 收件人标识: 'PRIVATE-RECIPIENT', 收件人学号: 'PRIVATE-STUDENT',
    触发年份: '2026', 触发日期: '10-25', 来源: '一对一匹配', 站内状态: '已投递', 邮件状态: '已发送' };
  for (const source of ['一对一匹配', '仓库抽取', '写给挚友']) {
    await notifyBlessingDelivered({ ...f.options, blessing, receipt: { ...receipt, 来源: source } });
  }
  assert.equal(f.messages.length, 3);
  assert.ok(f.messages.every(message => !JSON.stringify(message).includes('PRIVATE-')));
  await notifyBlessingDelivered({ ...f.options, blessing, receipt });
  assert.equal(f.messages.at(-1).idempotencyKey, f.messages[0].idempotencyKey);
  await notifyBlessingDelivered({ ...f.options, blessing, receipt: { ...receipt, 投递ID: 'DLV-2' } });
  assert.notEqual(f.messages.at(-1).idempotencyKey, f.messages[0].idempotencyKey);
  const count = f.messages.length;
  await notifyBlessingDelivered({ ...f.options, blessing, receipt: { ...receipt, 来源: '写给挚友', 邮件状态: '待发送' } });
  await notifyBlessingDelivered({ ...f.options, blessing, receipt: { ...receipt, 站内状态: '待发送' } });
  assert.equal(f.messages.length, count);
});

test('missing email, identity failures and notice failures never undo saved business changes', async () => {
  const f = mailbox();
  for (const email of ['', 'a@example.test\r\nBcc:x@example.test', 'a@example.test,b@example.test']) {
    await notifyCommunityReview({ ...f.options, accountForRef: async () => ({ email }),
      row: { 名片ID: 'CARD', 账号ID: 'AUTHOR' }, status: '已发布', reviewedAt: '2026-10-25' });
  }
  assert.equal(f.messages.length, 0);
  const result = await notifyCommunityReview({ ...f.options, send: async () => { throw Error('secret'); },
    row: { 名片ID: 'CARD', 账号ID: 'AUTHOR' }, status: '已发布', reviewedAt: '2026-10-25' });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('initial card and revision review routes notify only after successful writes; duplicate review is silent', async () => {
  for (const revision of [false, true]) for (const decision of ['approve', 'return', 'reject']) {
    const f = mailbox();
    const card = { _id: 'c1', 名片ID: 'CARD', 账号ID: 'AUTHOR', 审核状态: revision ? '已发布' : '待审核' };
    const row = revision ? { _id: 'r1', 修订ID: 'REV', 名片ID: 'CARD', 账号ID: 'AUTHOR', 版本号: 1, 审核状态: '待审核' } : card;
    const ctx = { ...f.options, sendMail: async message => {
      assert.notEqual(row.审核状态, '待审核');
      return f.options.send(message);
    }, publicBaseUrl: 'https://example.test',
      getBase: async () => ({ updateRow: async (table, _id, patch) => Object.assign(table === MORNING_REVISION_TABLE ? row : card, patch) }),
      listRows: async (_client, table) => table === MORNING_BLACKLIST_TABLE ? [] : table === MORNING_CARD_TABLE ? [card] : [row],
      assertCompleteRows() {}, readJsonObject: async () => ({ decision, note: '意见', expectedVersion: 1 }),
      requireConsoleAccess: () => ({ username: 'reviewer', accountId: 'REVIEWER', role: 'super_admin' }),
      requireCsrf: () => true, actor: session => session.accountId, recordAudit: async () => {},
      json: (_res, status, body) => ({ status, body }),
    };
    const route = revision ? morningRevisionRoutes : morningAdminRoutes;
    const url = new URL(`https://example.test/api/community/morning/${revision ? 'revisions/REV' : 'cards/CARD'}/review`);
    assert.equal((await route({ method: 'POST' }, {}, url, ctx)).status, 200);
    assert.equal(f.messages.length, 1);
    assert.equal(f.refs[0], 'AUTHOR');
    assert.ok(f.messages[0].text.includes('意见') || decision === 'approve');
    assert.equal((await route({ method: 'POST' }, {}, url, ctx)).status, 409);
    assert.equal(f.messages.length, 1);
  }
});

test('friend receipt invokes author notification after confirmed SMTP and replays a saved receipt without resending recipient mail', async () => {
  const notices = [], messages = [], deliveries = [];
  const row = { 投稿ID: 'CARE-1', 项目: 'birthday', 投递方式: '写给挚友', 状态: '已通过', 内容: '生日快乐', 署名昵称: '朋友',
    提交人: 'author', 挚友邮箱: 'friend@example.test', 挚友生日: '10-25', 计划投递日期: '2026-10-25' };
  const options = { submissions: [row], deliveries, now: new Date('2026-10-25T02:00:00Z'),
    library: [{ 投稿ID: 'CARE-1', 分类: '写给挚友', 状态: '在库', 内容: row.内容, 署名昵称: row.署名昵称 }],
    eligibleAuthor: async () => true, identifier: () => 'DLV-1',
    client: { appendRow: async () => ({ _id: 'receipt' }), updateRow: async (_table, _id, patch) => Object.assign(deliveries[0], patch) },
    send: async message => { messages.push(message); return { ok: true, transport: 'smtp' }; },
    onDelivered: async (blessing, receipt) => { assert.equal(receipt.邮件状态, '已发送'); notices.push({ blessing, receipt }); },
  };
  await deliverFriendBlessings(options);
  await deliverFriendBlessings(options);
  assert.equal(messages.length, 1);
  assert.equal(notices.length, 2);
  assert.equal(notices[0].receipt.投递ID, notices[1].receipt.投递ID);
});

test('birthday review route emails the author for approve, return, reject and reopen; denied changes are silent', async () => {
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const start = source.lastIndexOf('    const communitySubmissionReview =');
  const block = source.slice(start, source.indexOf("    if (req.method === 'POST' && url.pathname === '/api/community/consent')", start));
  for (const decision of ['approve', 'return', 'reject', 'reopen']) {
    const f = mailbox();
    const row = { _id: 'r1', 投稿ID: 'CARE-1', 项目: 'birthday', 提交人: 'author', 状态: decision === 'reopen' ? '已拒绝' : '待审核' };
    const context = vm.createContext({
      readJsonObject: async () => ({ decision, note: '审核意见' }), cleanText: value => value, optionalCleanText: value => value,
      withWarmthLock: async (_client, _key, fn) => fn(), warmthRows: async () => [row], readWarmthBlessings: async () => [],
      client: { updateRow: async (_table, _id, patch) => Object.assign(row, patch) }, communitySubmissionTable: '投稿',
      submissionStatusPending: '待审核', submissionStatusApproved: '已通过', submissionStatusRejected: '已拒绝', submissionStatusReturned: '需修改',
      WARMTH_SUBMISSION_LIMIT: 3, WARMTH_DELIVERY_LABELS: { friend: '写给挚友', repository: '祝福仓库' },
      recordAudit: async () => {}, ingestApprovedBlessing: async () => {},
      notifyBirthdayReview: (row, patch, reviewedAt) => notifyCommunityReview({ ...f.options, row: { ...row, ...patch }, status: patch.状态, reviewedAt }),
      session: { username: 'reviewer' }, json: (_res, status, body) => ({ status, body }),
    });
    vm.runInContext(`globalThis.run = async (req, res, url) => { ${block} };`, context);
    assert.equal((await context.run({ method: 'POST' }, {}, new URL('https://example.test/api/community/submissions/CARE-1/review'))).status, 200);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].to, 'author@example.test');
    assert.equal((await context.run({ method: 'POST' }, {}, new URL('https://example.test/api/community/submissions/CARE-1/review'))).status, 409);
    assert.equal(f.messages.length, 1);
  }
});
