import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { STATE_SCHEMA } from '../lib/production-schema.js';

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const me = await readFile(new URL('../public/app/portal/pages/me.js', import.meta.url), 'utf8');
const warmth = await readFile(new URL('../public/app/portal/pages/warmth.js', import.meta.url), 'utf8');
const consolePage = await readFile(new URL('../public/app/console/pages/community.js', import.meta.url), 'utf8');

function slice(start, end) {
  const a = server.indexOf(start);
  const b = server.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing source block: ${start}`);
  return server.slice(a, b);
}
const constantsBlock = slice('const submissionStatusPending', 'async function readWarmthBlessings');
const reviewBlock = slice('function reviewDecisionFromStatus', 'function stateRows');
const cleanBlock = slice('function cleanText', 'function eventPayload');
const context = vm.createContext({});
vm.runInContext(
  `${constantsBlock}\n${reviewBlock}\n${cleanBlock}\nglobalThis.api = { isValidBirthdayMonthDay, isActiveEnrollmentStatus, isConfirmedEnrollmentStatus, reviewDecisionFromStatus, statusFromReviewDecision, cleanText, optionalCleanText };`,
  context,
);
const api = context.api;

test('投稿表 Schema 声明包含生日祝福新增字段', () => {
  const table = STATE_SCHEMA.find((item) => item.name === '温暖连接投稿表');
  assert.ok(table, '温暖连接投稿表 schema missing');
  for (const column of ['署名昵称', '投递方式', '目标学号', '投递条件', '附件']) {
    assert.ok(table.columns.includes(column), `production schema missing ${column}`);
  }
  const declared = server.match(/name: '温暖连接投稿表'[^\n]+/)?.[0] || '';
  for (const column of ['署名昵称', '投递方式', '目标学号', '投递条件', '附件']) {
    assert.ok(declared.includes(column), `server schema missing ${column}`);
  }
});

test('审核状态映射覆盖已拒绝', () => {
  assert.equal(api.statusFromReviewDecision('reject'), '已拒绝');
  assert.equal(api.statusFromReviewDecision('approve'), '已通过');
  assert.equal(api.statusFromReviewDecision('return'), '需修改');
  assert.equal(api.reviewDecisionFromStatus('已拒绝'), 'reject');
  assert.equal(api.reviewDecisionFromStatus('待审核'), null);
});

test('生日月日校验拒绝非法日期但接受闰日', () => {
  for (const value of ['01-01', '02-29', '12-31']) assert.equal(api.isValidBirthdayMonthDay(value), true, value);
  for (const value of ['02-30', '04-31', '13-01', '00-10', '1-1', '']) assert.equal(api.isValidBirthdayMonthDay(value), false, value);
});

test('报名状态只把已确认视为已加入，并要求目标已确认', () => {
  for (const value of ['待人工确认', '已确认']) assert.equal(api.isActiveEnrollmentStatus(value), true, value);
  for (const value of ['已退出', '已踢出', '']) assert.equal(api.isActiveEnrollmentStatus(value), false, value);
  assert.equal(api.isConfirmedEnrollmentStatus('已确认'), true);
  assert.equal(api.isConfirmedEnrollmentStatus('待人工确认'), false);
  assert.equal(api.isConfirmedEnrollmentStatus('已退出'), false);
});

test('文本清洗限制控制字符、双向控制符与非字符串', () => {
  assert.equal(api.cleanText('  你好\u0000  ', '昵称', 20), '你好');
  assert.equal(api.cleanText('a\nb', '内容', 20, { allowNewlines: true }), 'a\nb');
  assert.equal(api.cleanText('a\nb', '昵称', 20), 'ab');
  assert.throws(() => api.cleanText(123, '昵称', 20), /格式不正确/);
  assert.equal(api.optionalCleanText('', '备注', 20), '');
});

test('仅加入生日祝福计划即生效，无需管理员人工确认', () => {
  const joinBlock = slice("if (req.method === 'POST' && url.pathname === '/api/public/warmth/interest')", 'const warmthInterestUpdate');
  assert.ok(joinBlock.includes('enrollmentStatusConfirmed'), 'birthday join must be auto-confirmed');
  assert.ok(joinBlock.includes('cascadeWarmthTargetStatus'), 'join must release submissions waiting for the member');
  assert.ok(!joinBlock.includes('状态: enrollmentStatusPending'), 'birthday join must not queue for manual confirmation');
  assert.ok(server.includes('请先加入生日祝福计划，再写祝福。'), 'blessing create must ask for enrolment rather than admin approval');
});

test('审核端参加登记返回成员完整信息', () => {
  const block = slice("if (req.method === 'GET' && url.pathname === '/api/community/interests')", 'const interestDecision');
  for (const field of ['realName', 'department', 'grade', 'gender', 'memberCode']) {
    assert.ok(block.includes(field), `console interests must expose ${field}`);
  }
  assert.ok(block.includes('contactEmail: item.email'), 'console interests must return the full contact email');
  assert.ok(!block.includes('slice(0, 60)'), 'console interests must not truncate the member list');
});

test('生日祝福关键闭环与限制仍在源码中', () => {
  assert.ok(server.includes('readConfirmedWarmthCandidates'), 'matching preview must include confirmed portal candidates');
  assert.ok(server.includes('isConfirmedEnrollmentStatus(item.status)'), 'blessing create must require a confirmed enrollment');
  assert.ok(server.includes('submissionStatusWaiting'), 'waiting status must exist');
  assert.ok(server.includes("currentStatus !== submissionStatusPending"), 'review must require pending status');
  assert.ok(server.includes("decision === 'reopen'"), 'review must support reopening a rejected submission');
  assert.ok(server.includes('cascadeWarmthTargetStatus'), 'target confirmation/withdrawal must cascade');
  assert.ok(server.includes('withdraw'), 'public withdrawal route must exist');
  assert.ok(server.includes('你已报名生日祝福计划，请在会员中心修改或退出'), 'duplicate registration must be rejected');
  assert.ok(server.includes('warmthInterestUpdate') && server.includes('warmth-update'), 'member centre update endpoint must exist');
  assert.ok(me.includes('publicApi.myWarmthBlessings'), 'member centre must read blessing progress through publicApi');
  assert.ok(!me.includes('portal.myWarmthBlessings'), 'member centre must not call the wrong API object');
  assert.ok(me.includes('内容：'), 'member centre must show the submitted content');
  assert.ok(me.includes('我写的生日祝福'), 'member centre panel must be renamed');
  assert.ok(me.includes('openBlessingPreview') && me.includes('blessing-preview__content'), 'member centre must offer enlarged blessing preview');
  assert.ok(me.includes('openBlessingDrawer'), 'member centre must offer resubmission');
  assert.ok(me.includes('openInterestEditDrawer') && me.includes('updateWarmthInterest'), 'member centre must allow editing the birthday registration');
  assert.ok(warmth.includes('blessing-drawer.js') && warmth.includes('openBlessingDrawer'), 'warmth page must use the shared blessing drawer');
  assert.ok(warmth.includes('基础模板祝福') && warmth.includes('去写生日祝福'), 'join success must explain template vs private blessings and offer the write action');
  assert.ok(warmth.includes('onDone: refresh') && warmth.includes('replaceWith'), 'joining must refresh the community page in place without a manual reload');
  assert.ok(server.includes('/api/public/warmth/blessings/received') && server.includes('/api/public/warmth/repository'), 'in-site display endpoints must exist');
  assert.ok(server.includes('item.targetStudentId === myStudentId'), 'received blessings must be scoped to the recipient student id');
  assert.ok(warmth.includes('祝福仓库') && me.includes('我收到的生日祝福'), 'in-site display surfaces must exist');
  assert.ok(server.includes('function resolveWarmthDelivery('), 'delivery target rules must be shared');
  assert.equal((server.match(/resolveWarmthDelivery\(\{/g) || []).length, 3, 'helper defined once and used by both the create and resubmit routes');
  assert.ok(consolePage.includes("decision: 'reopen'"), 'console must offer reopen for rejected submissions');
  assert.ok(consolePage.includes('confirmAction({'), 'console must confirm destructive decisions');
});
