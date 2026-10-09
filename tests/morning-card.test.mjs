import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MORNING_CARD_STATUS,
  isActiveMorningCardStatus,
  normalizeInterestTags,
  morningRoutes,
  toMorningCardView,
  validateMorningCardInput,
} from '../lib/morning/api.js';

const warmthPage = await readFile(new URL('../public/app/portal/pages/warmth.js', import.meta.url), 'utf8');
const morningDrawer = await readFile(new URL('../public/app/portal/morning-drawer.js', import.meta.url), 'utf8');
const morningApiClient = await readFile(new URL('../public/app/core/api.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const mePage = await readFile(new URL('../public/app/portal/pages/me.js', import.meta.url), 'utf8');

test('早安晚安兴趣标签去重并限制数量与长度', () => {
  assert.deepEqual(normalizeInterestTags('摄影, 跑步，摄影、读书'), ['摄影', '跑步', '读书']);
  assert.throws(() => normalizeInterestTags(['1', '2', '3', '4', '5', '6']), /最多 5 个/);
  assert.throws(() => normalizeInterestTags(['这个标签太长了']), /不能超过 5 字/);
});

test('早安晚安报名校验必填字段', () => {
  const value = validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影', '跑步'],
    note: '想找一起自习的朋友',
    consent: true,
  });
  assert.deepEqual(value.interestTags, ['摄影', '跑步']);
  assert.equal(value.allowEmail, true);
  const noEmail = validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影'],
    consent: true,
    allowEmail: false,
  });
  assert.equal(noEmail.allowEmail, false);
  assert.throws(() => validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: [],
    consent: true,
  }), /至少填写一个兴趣标签/);
});

test('早安晚安名片投影保持审核状态和兴趣标签', () => {
  const view = toMorningCardView({
    名片ID: 'MNG-1',
    账号ID: 'ACC-1',
    真实姓名快照: '本地成员',
    学号快照: '999990002',
    性别快照: '女',
    校区: '仙林',
    昵称: '小南',
    兴趣标签: JSON.stringify(['摄影', '跑步']),
    备注: '自我介绍',
    允许评论邮件: '否',
    审核状态: MORNING_CARD_STATUS.PENDING,
    提交时间: '2026-10-08T00:00:00.000Z',
  });
  assert.equal(view.status, '待审核');
  assert.equal(view.allowEmail, false);
  assert.deepEqual(view.interestTags, ['摄影', '跑步']);
});

test('主动退出使用已退出状态并从个人名片读取中隐藏', () => {
  assert.equal(MORNING_CARD_STATUS.WITHDRAWN, '已退出');
  assert.equal(isActiveMorningCardStatus('待审核'), true);
  assert.equal(isActiveMorningCardStatus('已发布'), true);
  assert.equal(isActiveMorningCardStatus('已退出'), false);
  assert.equal(isActiveMorningCardStatus('已下架'), false);
});

test('已发布名片不能通过重新提交绕过审核直接回到待审核', async () => {
  const rows = [{
    _id: 'card-1',
    名片ID: 'MNG-1',
    账号ID: 'ACC-1',
    校区: '仙林',
    昵称: '小南',
    兴趣标签: JSON.stringify(['摄影']),
    备注: '原名片',
    审核状态: MORNING_CARD_STATUS.PUBLISHED,
    提交时间: '2026-10-09T00:00:00.000Z',
    发布时间: '2026-10-09T01:00:00.000Z',
    更新时间: '2026-10-09T01:00:00.000Z',
  }];
  const client = {
    async updateRow() { throw new Error('must not update'); },
    async deleteRow() { throw new Error('must not delete'); },
    async appendRow() { throw new Error('must not append'); },
  };
  const res = { statusCode: 0, payload: null };
  const session = { username: 'local-member', role: 'member' };
  const ctx = {
    getBase: async () => client,
    listRows: async (_client, table) => table === '早安晚安兴趣标签表' ? [] : rows,
    assertCompleteRows: () => {},
    requirePortalSession: () => session,
    requirePortalWrite: () => session,
    actor: () => 'ACC-1',
    accountForSession: async () => ({ realName: '本地成员', studentId: '999990002', gender: '女' }),
    readJsonObject: async () => ({ nickname: '小南', campus: '仙林', interestTags: ['摄影'], note: '', consent: true, allowEmail: true }),
    enforcePublicLimit: () => {},
    recordAudit: () => {},
    json: (response, statusCode, payload) => { response.statusCode = statusCode; response.payload = payload; return payload; },
  };
  await morningRoutes({ method: 'POST', headers: {} }, res, new URL('http://example.test/api/morning/card'), ctx);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'card_already_published');
});

test('内建广场早安晚安入口打开居中报名抽屉而不是跳页', () => {
  assert.ok(warmthPage.includes('openMorningSignupDrawer'), 'community entry must open the morning drawer');
  assert.ok(!warmthPage.includes("navigate('/morning/register')"), 'community entry must not navigate away');
  assert.ok(morningDrawer.includes("placement: 'center'"), 'morning signup must use a centred drawer');
  assert.ok(morningDrawer.includes('buildMorningSignupForm'), 'drawer must reuse the shared signup form');
  assert.ok(morningDrawer.includes('showForm(currentCard') && !morningDrawer.includes('showStatus'), 'signup must open the form directly');
  assert.ok(morningDrawer.includes("label: '退出计划'") && morningDrawer.includes('withdrawCard'), 'members must be able to withdraw');
  assert.ok(morningDrawer.includes("!['已退出', '已下架'].includes(currentCard.status) ? currentCard : null"), 'rejoin must start from an empty form');
  assert.ok(morningApiClient.includes("withdrawCard: () => request('/api/morning/card/withdraw'"), 'withdraw client method missing');
  assert.ok(warmthPage.includes('payload.morningCard') && warmthPage.includes("program.id === 'morning' && myMorningCard"), 'plaza must read the signed-in morning card');
  assert.ok(warmthPage.includes("label: '已加入 · 去会员中心'") && warmthPage.includes('/me?focus=member-warmth-enrollments'), 'joined morning cards must send members to the member centre');
});

test('兴趣标签提供预设、搜索与新建词条且至少填写一个', async () => {
  const form = await readFile(new URL('../public/app/portal/morning-form.js', import.meta.url), 'utf8');
  assert.ok(form.includes('const TAG_PRESETS = ['), 'preset tags missing');
  assert.ok(form.includes('morning-tag-picker__create') && form.includes('新建词条'), 'custom tag creation missing');
  assert.ok(form.includes('addTags') && form.includes("split(/[,，、\\n]+/)"), 'tag search/add flow missing');
  assert.ok(form.includes('availableTags') && form.includes('morningApi.tags()') && form.includes('morningApi.createTag'), 'custom tags must join the shared tag library');
  assert.ok(form.includes('libraryTags') && form.includes('...libraryTags'), 'custom library tags must surface in default suggestions');
  assert.ok(form.includes('请至少填写一个兴趣标签'), 'client must require one tag');
  assert.ok(form.includes('如允许评论邮件') && form.includes('allowEmail'), 'comment email switch missing');
  assert.ok(form.includes('readonly: true') && form.includes('smail.nju.edu.cn'), 'read-only notification mailbox missing');
  assert.ok(form.includes('segmentedField({') && form.includes('CAMPUS_OPTIONS.map'), 'campus must use a four-option sliding selector');
  assert.ok(!form.includes('公开QQ') && !form.includes('公开微信') && !form.includes('其他联系方式'), 'contact fields must not appear');
});

test('会员中心温暖连接登记同步早安晚安状态', () => {
  assert.ok(serverSource.includes('projectMorningMemberCard') && serverSource.includes('morningCard'), 'portal/me must return the morning card');
  assert.ok(mePage.includes("morning: '早安晚安'"), 'member centre label must include morning');
  assert.ok(mePage.includes('openMorningSignupDrawer') && mePage.includes('morningApi.withdrawCard'), 'member centre must edit and withdraw the morning card');
  assert.ok(!mePage.includes("label: '编辑'"), 'member centre action wording must stay consistent');
  assert.ok(!mePage.includes("label: '重新报名'"), 'member centre must not offer the morning rejoin interface');
});
