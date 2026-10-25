import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { friendBlessingTarget, assertFriendSchema, FRIEND_BLESSING_COLUMNS, shanghaiDate } from '../lib/community/friend-blessings.js';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const validators = source.slice(source.indexOf('function requiredText('), source.indexOf('function eventPayload('));
const publicSource = source.slice(source.indexOf('async function publicRoutes('), source.indexOf('async function portalRoutes('));
const consoleMarker = "if (req.method === 'POST' && url.pathname === '/api/community/submissions')";
const consoleBlocks = [...source.matchAll(new RegExp(consoleMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
  .map(match => source.slice(match.index, source.indexOf('const communitySubmissionReview =', match.index)));
assert.equal(consoleBlocks.length, 2);

function harness(consoleBlock = null) {
  const writes = [];
  const blessings = [];
  const row = { _id: 'row-original', 投稿ID: 'CARE-1', 提交人: 'writer', 状态: '待审核', 内容: '旧'.repeat(201) };
  const context = vm.createContext({
    birthdayRollout: { enabled: true }, assertBirthdayReady: async () => {},
    getBase: async () => client, requirePortalWrite: () => ({ username: 'writer' }),
    businessAccountRef: () => 'ACC-WRITER', isWarmthBlacklisted: async () => false,
    enforcePublicLimit() {}, readJsonObject: async req => req.body, readJson: async req => req.body,
    json: (_res, status, body) => ({ status, body }),
    withWarmthLock: async (_client, _key, task) => task(),
    readWarmthInterests: async () => [{ program: 'birthday', participantRef: 'ACC-WRITER', status: '已确认' }],
    isConfirmedEnrollmentStatus: status => status === '已确认', readWarmthBlessings: async () => blessings,
    accountsByUsername: new Map([['writer', { accountId: 'ACC-WRITER' }]]),
    requirePortalSession: () => ({ username: 'writer' }), friendDeliveryDate: shanghaiDate,
    readCommunityConsents: async () => ({ 'writer:birthday': { enabled: true }, 'writer:morning': { enabled: true } }),
    scopedWarmthRows: async () => [row],
    communitySubmissionTable: '温暖连接投稿表', blessingDeliveryTable: '温暖祝福投递表', submissionStatusPending: '待审核',
    submissionStatusReturned: '需修改', submissionStatusApproved: '已通过', submissionStatusRejected: '已拒绝',
    WARMTH_DELIVERY_LABELS: { random: '随机匹配', repository: '祝福仓库', friend: '写给挚友' }, WARMTH_SUBMISSION_LIMIT: 3,
    friendBlessingTarget, assertFriendSchema,
    resolveWarmthDelivery: () => ({ ok: true, targetStudentId: '', deliveryState: '待匹配', status: '待审核' }),
    eventIdentifier: () => 'CARE-NEW', recordAudit: async () => {},
  });
  const client = {
    getMetadata: async () => ({ tables: [{ name: '温暖连接投稿表', columns: FRIEND_BLESSING_COLUMNS.map(name => ({ name, type: 'text' })) }] }),
    appendRow: async (_table, value) => writes.push(value),
    updateRow: async (_table, _id, value) => { writes.push(value); Object.assign(row, value); },
  };
  vm.runInContext(validators + '\n' + (consoleBlock
    ? `globalThis.route = async (req, res, url) => { const client = await getBase(); const session = {username:'writer'}; ${consoleBlock} };`
    : `${publicSource}\nglobalThis.route = publicRoutes;`), context);
  return { writes, row, client, blessings, get: path => context.route({ method: 'GET' }, {}, new URL(path, 'http://test')),
    route: (path, content, program = 'birthday', extra = {}) => context.route({ method: 'POST', body: {
    nickname: '合成昵称', content, delivery: 'random', consent: true, program, ...extra,
  } }, {}, new URL(path, 'http://test')) };
}

for (const path of ['/api/public/warmth/blessings', '/api/public/warmth/blessings/CARE-1/resubmit']) {
  test(`${path} validates and stores friend fields without trusting the requested send date`, async () => {
    const h = harness();
    await assert.rejects(h.route(path, '生日快乐', 'birthday', { delivery: 'friend' }), { statusCode: 400 });
    await assert.rejects(h.route(path, '生日快乐', 'birthday', { delivery: 'friend', friendEmail: 'friend@example.test', friendBirthday: '02-30' }), { statusCode: 400 });
    assert.equal(h.writes.length, 0);
    const result = await h.route(path, '生日快乐', 'birthday', { delivery: 'friend', friendEmail: 'friend@example.test', friendBirthday: '12-31', scheduledDate: '1990-01-01' });
    assert.ok([200, 201].includes(result.status));
    assert.equal(h.writes[0].挚友邮箱, 'friend@example.test');
    assert.equal(h.writes[0].挚友生日, '12-31');
    assert.notEqual(h.writes[0].计划投递日期, '1990-01-01');
    assert.equal(h.writes[0].状态, '待审核');
    assert.equal(h.writes[0].投递方式, '写给挚友');
  });
}

test('changing a pending friend letter back to random clears its private target', async () => {
  const h = harness();
  h.row.挚友邮箱 = 'former@example.test'; h.row.挚友生日 = '12-31'; h.row.计划投递日期 = '2030-12-31';
  await h.route('/api/public/warmth/blessings/CARE-1/resubmit', '生日快乐');
  assert.equal(h.row.挚友邮箱, ''); assert.equal(h.row.挚友生日, ''); assert.equal(h.row.计划投递日期, '');
});

test('three normal blessings still allow friend letters, while friend letters never consume normal slots', async () => {
  const h = harness();
  h.blessings.push(...Array.from({ length: 3 }, (_, index) => ({ id: `normal-${index}`, actor: 'writer', deliveryKey: 'random', status: '待审核' })));
  assert.equal((await h.route('/api/public/warmth/blessings', '普通祝福')).status, 409);
  assert.equal((await h.route('/api/public/warmth/blessings', '写给挚友', 'birthday', { delivery: 'friend', friendEmail: 'friend@example.test', friendBirthday: '12-31' })).status, 201);
  h.blessings.splice(0, 3, ...Array.from({ length: 5 }, (_, index) => ({ id: `friend-${index}`, actor: 'writer', deliveryKey: 'friend', status: '已通过' })));
  assert.equal((await h.route('/api/public/warmth/blessings', '普通祝福')).status, 201);
});

test('friend-to-normal edits enforce available quota without blocking edits that stay friend', async () => {
  const h = harness(); h.row.投递方式 = '写给挚友';
  h.blessings.push(...Array.from({ length: 3 }, (_, index) => ({ id: `normal-${index}`, actor: 'writer', deliveryKey: 'random', status: '已通过' })));
  const path = '/api/public/warmth/blessings/CARE-1/resubmit';
  assert.equal((await h.route(path, '普通祝福')).status, 409);
  assert.equal(h.writes.length, 0);
  assert.equal((await h.route(path, '挚友祝福', 'birthday', { delivery: 'friend', friendEmail: 'friend@example.test', friendBirthday: '12-31' })).status, 200);
  h.blessings.pop();
  assert.equal((await h.route(path, '普通祝福')).status, 200);
});

test('my-blessings usage counts normal letters only while keeping every letter visible', async () => {
  const h = harness();
  h.blessings.push(
    { id: 'n1', actor: 'writer', deliveryKey: 'random', status: '已通过', content: '普通祝福' },
    { id: 'n2', actor: 'writer', deliveryKey: 'repository', status: '已拒绝', content: '已拒绝' },
    { id: 'f1', actor: 'writer', deliveryKey: 'friend', status: '已通过', content: '给朋友' },
    { id: 'f2', actor: 'writer', delivery: '写给挚友', status: '待审核', content: '给朋友' },
  );
  const response = await h.get('/api/public/warmth/blessings/mine');
  assert.equal(response.status, 200);
  assert.equal(response.body.stats.total, 4);
  assert.equal(response.body.stats.used, 1);
  assert.equal(response.body.stats.oneOnOneQuota, 1);
  assert.equal(response.body.blessings.length, 4);
});

test('reopening a rejected friend letter does not consume the ordinary quota', async () => {
  const start = source.indexOf("if (decision === 'reopen')", source.lastIndexOf(consoleMarker));
  const end = source.indexOf('if (currentStatus !== submissionStatusPending)', start);
  assert.ok(start >= 0 && end > start);
  for (const [delivery, occupiedKind, expected] of [['写给挚友', 'random', 200], ['随机匹配', 'friend', 200], ['随机匹配', 'random', 409]]) {
    const row = { 提交人: 'writer', 投递方式: delivery };
    const context = vm.createContext({ row, decision: 'reopen', currentStatus: '已拒绝', submissionId: 'CARE-REOPEN',
      client: { updateRow: async (_table, _id, patch) => Object.assign(row, patch) },
      communitySubmissionTable: '温暖连接投稿表', submissionStatusRejected: '已拒绝', submissionStatusPending: '待审核',
      WARMTH_SUBMISSION_LIMIT: 3, WARMTH_DELIVERY_LABELS: { friend: '写给挚友', repository: '祝福仓库' },
      readWarmthBlessings: async () => Array.from({ length: 3 }, (_, i) => ({ id: `other-${i}`, actor: 'writer', status: '已通过', deliveryKey: occupiedKind })),
      recordAudit: async () => {}, req: {}, res: {}, session: {}, json: (_res, status, body) => ({ status, body }),
    });
    vm.runInContext(`globalThis.reopen = async () => { ${source.slice(start, end)} };`, context);
    assert.equal((await context.reopen()).code, expected);
  }
});

test('missing friend schema blocks only friend submission without saving partial records', async () => {
  const h = harness(); h.client.getMetadata = async () => ({ tables: [] });
  await assert.rejects(h.route('/api/public/warmth/blessings', '生日快乐', 'birthday', {
    delivery: 'friend', friendEmail: 'friend@example.test', friendBirthday: '12-31',
  }), { code: 'friend_blessing_schema_not_ready' });
  assert.equal(h.writes.length, 0);
  assert.equal((await h.route('/api/public/warmth/blessings', '生日快乐')).status, 201);
});

for (const path of ['/api/public/warmth/blessings', '/api/public/warmth/blessings/CARE-1/resubmit']) {
  test(`${path} accepts 200 characters and rejects 201 without writing or truncating`, async () => {
    const h = harness();
    await assert.rejects(h.route(path, '祝'.repeat(201)), error => error.statusCode === 400 && /200/.test(error.message));
    assert.equal(h.writes.length, 0);
    assert.equal(h.row.内容.length, 201);
    const response = await h.route(path, '祝'.repeat(200));
    assert.equal(response.status, path.endsWith('resubmit') ? 200 : 201);
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].内容, '祝'.repeat(200));
  });
}

for (const [index, block] of consoleBlocks.entries()) {
  test(`console submission branch ${index + 1} enforces birthday limit while retaining morning limit`, async () => {
    const h = harness(block);
    await assert.rejects(h.route('/api/community/submissions', '祝'.repeat(201)), { statusCode: 400 });
    assert.equal(h.writes.length, 0);
    assert.equal((await h.route('/api/community/submissions', '祝'.repeat(200))).status, 201);
    assert.equal((await h.route('/api/community/submissions', '早'.repeat(201), 'morning')).status, 201);
    assert.equal(h.writes[0].内容.length, 200);
    assert.equal(h.writes[1].内容.length, 201);
  });
}
