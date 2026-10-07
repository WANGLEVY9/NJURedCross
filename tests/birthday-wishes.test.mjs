import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { STATE_SCHEMA } from '../lib/production-schema.js';

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const me = await readFile(new URL('../public/app/portal/pages/me.js', import.meta.url), 'utf8');
const warmth = await readFile(new URL('../public/app/portal/pages/warmth.js', import.meta.url), 'utf8');
const consolePage = await readFile(new URL('../public/app/console/pages/community.js', import.meta.url), 'utf8');
const blessingLetter = await readFile(new URL('../public/app/portal/blessing-letter.js', import.meta.url), 'utf8');
const portalShell = await readFile(new URL('../public/app/portal/shell.js', import.meta.url), 'utf8');
const warmthPanels = await readFile(new URL('../public/app/portal/warmth-panels.js', import.meta.url), 'utf8');
const warmthCss = await readFile(new URL('../public/styles/warmth.css', import.meta.url), 'utf8');

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
  assert.ok(!block.includes('interests.slice('), 'console interests must not truncate the member list');
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
  assert.ok(warmthPanels.includes('内容：'), 'member list must show the submitted content');
  assert.ok(warmthPanels.includes('我写的生日祝福'), 'member list panel must be renamed');
  assert.ok(warmthPanels.includes('openWrittenBlessingPreview') && warmthPanels.includes('openBlessingLetterModal'), 'member list must offer enlarged preview / detail');
  assert.ok(blessingLetter.includes('blessing-preview__content'), 'shared blessing letter must render the letter body');
  assert.ok(portalShell.includes('maybeShowBirthdayPopup'), 'portal shell must show the birthday-day popup');
  assert.ok(portalShell.includes('payload.recipientName'), 'birthday popup must use the name resolved from the personal profile');
  assert.ok(server.includes('const recipientName = String(account?.realName'), 'delivered endpoint must resolve the real name from the profile server-side');
  assert.ok(warmthPanels.includes('openBlessingDrawer'), 'member list must offer resubmission');
  assert.ok(me.includes('openInterestEditDrawer') && me.includes('updateWarmthInterest'), 'member centre must allow editing the birthday registration');
  assert.ok(warmth.includes('blessing-drawer.js') && warmth.includes('openBlessingDrawer'), 'warmth page must use the shared blessing drawer');
  assert.ok(warmth.includes('基础模板祝福') && warmth.includes('去写生日祝福'), 'join success must explain template vs private blessings and offer the write action');
  assert.ok(warmth.includes('onDone: refresh') && warmth.includes('replaceWith'), 'joining must refresh the community page in place without a manual reload');
  assert.ok(server.includes("blessingLibraryTable = '温暖祝福库表'"), 'approved blessings must be ingested into the library');
  assert.ok(server.includes('ingestApprovedBlessing'), 'review approve must ingest into the library');
  assert.ok(server.includes('runWarmthBirthdayDelivery'), 'daily birthday delivery job must exist');
  assert.ok(!server.includes('/api/community/blessing-library') && !server.includes('/api/public/warmth/repository'), 'the blessing library must stay SeaTable-only (no read API yet)');
  assert.ok(server.includes("item.category === '指定个体'"), 'delivery must target specific-recipient library entries');
  assert.ok(server.includes("category === '一对一随机'") && server.includes("category === '祝福仓库'"), 'delivery must use both the one-on-one pool and the repository pool');
  assert.ok(server.includes('item.submitter !== account?.username'), 'matching must exclude blessings written by the member');
  assert.ok(server.includes('WARMTH-BIRTHDAY:'), 'delivery mail must be idempotent per submission and day');
  assert.ok(server.includes('/api/public/warmth/blessings/delivered'), 'delivered-blessings endpoint must exist');
  assert.ok(warmthPanels.includes('我收到的生日祝福'), 'member list must show delivered blessings');
  assert.ok(server.includes("祝福仓库: '祝福仓库', 指定学号: '指定个体', 随机匹配: '一对一随机'"), 'library categories must map the three delivery modes');
  assert.ok(server.includes('function resolveWarmthDelivery('), 'delivery target rules must be shared');
  assert.equal((server.match(/resolveWarmthDelivery\(\{/g) || []).length, 3, 'helper defined once and used by both the create and resubmit routes');
  assert.ok(server.includes('blessingReportTable') && server.includes('REPORT_STATUS_PENDING'), 'reports must be stored and start pending');
  assert.ok(server.includes('只能举报已经送达给你的祝福。'), 'only the recipient may report a delivered blessing');
  assert.ok(blessingLetter.includes('openBlessingReportDialog'), 'received blessing detail must offer a report action');
  assert.ok(blessingLetter.includes('reportNotice'), 'received blessing detail must highlight the report status');
  assert.ok(warmthPanels.includes('deliveredStatus') && warmthPanels.includes('已举报 · 处理中'), 'member list must surface the report status prominently');
  assert.ok(warmthPanels.includes('collapsiblePanel') && warmthPanels.includes('aria-expanded'), 'blessing panels must be collapsible');
  assert.ok(me.includes('buildWrittenBlessingsPanel') && me.includes('buildReceivedBlessingsPanel'), 'member centre must use the shared collapsible panels');
  assert.ok(warmth.includes('buildWrittenBlessingsPanel') && warmth.includes('buildReceivedBlessingsPanel'), 'community page must also show the written/received panels');
  assert.ok(warmth.includes('我的举报受理状态') && warmth.includes('buildReportBanner'), 'community page must surface the report status at the top');
  assert.ok(warmth.includes('openReceivedPanel') && warmthPanels.includes('panel.setOpen'), 'report banner must jump to and expand the received panel');
  assert.ok(warmth.includes('reportStatusLabel'), 'report banner must list each reported blessing conclusion');
  assert.ok(warmth.includes('openReceivedBlessingDetail'), 'report banner items must open the blessing detail modal');
  assert.ok(warmthCss.includes('warmth-report-banner'), 'report banner must have a prominent colour treatment');
  assert.ok(consolePage.includes("label: '举报处理'"), 'console must offer a report-handling tab');
  assert.ok(consolePage.includes('加入黑名单') && consolePage.includes('解除黑名单'), 'console must merge withdraw/kick/blacklist into join/leave blacklist');
  assert.ok(server.includes('displayStatus') && server.includes("'已拉黑'"), 'enrollment display status must unify to 正常/已退出/已拉黑');
  assert.ok(consolePage.includes("label: '正常'") && consolePage.includes("label: '已拉黑'"), 'console stats must use the unified status names');
  assert.ok(me.includes('displayEnrollmentStatus'), 'member centre must use the unified enrollment status');
  assert.ok(consolePage.includes('blacklistInterest') && consolePage.includes('releaseBlacklist'), 'console must wire the blacklist actions');
  assert.ok(consolePage.includes("label: '黑名单'") && consolePage.includes('releaseBlacklist'), 'console must list the blacklist and allow release');
  assert.ok(server.includes('isWarmthBlacklisted'), 'join and submission must be blocked for blacklisted members');
  assert.ok(server.includes('参与者标识: actorRef'), 'new enrollment rows must store the participant ref');
  assert.ok(server.includes('const canonicalRef = account?.accountId'), 'blacklist must normalise the participant ref');
  assert.ok(server.includes('const isBlocked ='), 'delivery must use the normalised blacklist check');
  assert.ok(server.includes('拉黑校验放进锁内'), 'join blacklist check must run inside the keyed lock');
  assert.ok(server.includes('WARMTH-BLACKLIST:'), 'blacklisting must notify the member by email');
  assert.ok(server.includes('realName: String(accountByBusinessRef'), 'blacklist list must show the member name');
  assert.ok(server.includes('authorReportCount'), 'reports must expose how many times the author was reported');
  assert.ok(consolePage.includes('blacklistAuthor'), 'console must offer blacklisting a repeatedly-reported author');
  assert.ok(server.includes('warmth-members'), 'console must expose a member profile endpoint');
  assert.ok(consolePage.includes('openMemberDrawer'), 'console must open member profiles from review/report drawers');
  assert.ok(consolePage.includes('decideWarmthReport'), 'console must resolve reports through the API');
  assert.ok(server.includes("content: entry?.content"), 'report list must include the reported blessing content');
  assert.ok(consolePage.includes("label: '被举报祝福'"), 'console must show the reported blessing content');
  assert.ok(server.includes('WARMTH-REPORT:'), 'report resolution must notify the reporter');
  assert.ok(consolePage.includes("decision: 'reopen'"), 'console must offer reopen for rejected submissions');
  assert.ok(consolePage.includes('confirmAction({'), 'console must confirm destructive decisions');
});
