import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const validators = source.slice(source.indexOf('function requiredText('), source.indexOf('function eventPayload('));
const publicSource = source.slice(source.indexOf('async function publicRoutes('), source.indexOf('async function portalRoutes('));
const consoleMarker = "if (req.method === 'POST' && url.pathname === '/api/community/submissions')";
const consoleBlocks = [...source.matchAll(new RegExp(consoleMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
  .map(match => source.slice(match.index, source.indexOf('const communitySubmissionReview =', match.index)));
assert.equal(consoleBlocks.length, 2);

function harness(consoleBlock = null) {
  const writes = [];
  const row = { _id: 'row-original', 投稿ID: 'CARE-1', 提交人: 'writer', 状态: '待审核', 内容: '旧'.repeat(201) };
  const context = vm.createContext({
    birthdayRollout: { enabled: true }, assertBirthdayReady: async () => {},
    getBase: async () => client, requirePortalWrite: () => ({ username: 'writer' }),
    businessAccountRef: () => 'ACC-WRITER', isWarmthBlacklisted: async () => false,
    enforcePublicLimit() {}, readJsonObject: async req => req.body, readJson: async req => req.body,
    json: (_res, status, body) => ({ status, body }),
    withWarmthLock: async (_client, _key, task) => task(),
    readWarmthInterests: async () => [{ program: 'birthday', participantRef: 'ACC-WRITER', status: '已确认' }],
    isConfirmedEnrollmentStatus: status => status === '已确认', readWarmthBlessings: async () => [],
    readCommunityConsents: async () => ({ 'writer:birthday': { enabled: true }, 'writer:morning': { enabled: true } }),
    scopedWarmthRows: async () => [row],
    communitySubmissionTable: '温暖连接投稿表', submissionStatusPending: '待审核',
    submissionStatusReturned: '需修改', submissionStatusApproved: '已通过', submissionStatusRejected: '已拒绝',
    WARMTH_DELIVERY_LABELS: { random: '随机匹配', repository: '祝福仓库' }, WARMTH_SUBMISSION_LIMIT: 3,
    resolveWarmthDelivery: () => ({ ok: true, targetStudentId: '', deliveryState: '待匹配', status: '待审核' }),
    eventIdentifier: () => 'CARE-NEW', recordAudit: async () => {},
  });
  const client = {
    appendRow: async (_table, value) => writes.push(value),
    updateRow: async (_table, _id, value) => { writes.push(value); Object.assign(row, value); },
  };
  vm.runInContext(validators + '\n' + (consoleBlock
    ? `globalThis.route = async (req, res, url) => { const client = await getBase(); const session = {username:'writer'}; ${consoleBlock} };`
    : `${publicSource}\nglobalThis.route = publicRoutes;`), context);
  return { writes, row, route: (path, content, program = 'birthday') => context.route({ method: 'POST', body: {
    nickname: '合成昵称', content, delivery: 'random', consent: true, program,
  } }, {}, new URL(path, 'http://test')) };
}

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
