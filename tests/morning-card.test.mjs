import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MORNING_CARD_STATUS,
  normalizeInterestTags,
  toMorningCardView,
  validateMorningCardInput,
} from '../lib/morning/api.js';

const warmthPage = await readFile(new URL('../public/app/portal/pages/warmth.js', import.meta.url), 'utf8');
const morningDrawer = await readFile(new URL('../public/app/portal/morning-drawer.js', import.meta.url), 'utf8');
const morningApiClient = await readFile(new URL('../public/app/core/api.js', import.meta.url), 'utf8');

test('早安晚安兴趣标签去重并限制数量与长度', () => {
  assert.deepEqual(normalizeInterestTags('摄影, 跑步，摄影、读书'), ['摄影', '跑步', '读书']);
  assert.throws(() => normalizeInterestTags(['1', '2', '3', '4', '5', '6']), /最多 5 个/);
  assert.throws(() => normalizeInterestTags(['这个标签名称实在是太长太长太长太长']), /不能超过 16 字/);
});

test('早安晚安报名校验必填字段与联系方式公开条件', () => {
  const value = validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影', '跑步'],
    note: '想找一起自习的朋友',
    publishQQ: false,
    publishWechat: true,
    publishOther: false,
    consent: true,
  });
  assert.deepEqual(value.interestTags, ['摄影', '跑步']);
  assert.equal(value.publishWechat, true);
  assert.throws(() => validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影'],
    publishOther: true,
    otherContact: '',
    consent: true,
  }), /其他联系方式/);
  assert.throws(() => validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: [],
    consent: true,
  }), /至少填写一个兴趣标签/);
});

test('早安晚安名片投影保持审核状态和公开开关', () => {
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
    公开QQ: '是',
    公开微信: '否',
    公开其他联系方式: '否',
    审核状态: MORNING_CARD_STATUS.PENDING,
    提交时间: '2026-10-08T00:00:00.000Z',
  });
  assert.equal(view.status, '待审核');
  assert.deepEqual(view.interestTags, ['摄影', '跑步']);
  assert.equal(view.publishQQ, true);
  assert.equal(view.publishWechat, false);
});

test('内建广场早安晚安入口打开居中报名抽屉而不是跳页', () => {
  assert.ok(warmthPage.includes('openMorningSignupDrawer'), 'community entry must open the morning drawer');
  assert.ok(!warmthPage.includes("navigate('/morning/register')"), 'community entry must not navigate away');
  assert.ok(morningDrawer.includes("placement: 'center'"), 'morning signup must use a centred drawer');
  assert.ok(morningDrawer.includes('buildMorningSignupForm'), 'drawer must reuse the shared signup form');
  assert.ok(morningDrawer.includes("label: '编辑信息'"), 'existing cards must be editable');
  assert.ok(morningDrawer.includes("label: '退出计划'") && morningDrawer.includes('withdrawCard'), 'members must be able to withdraw');
  assert.ok(morningApiClient.includes("withdrawCard: () => request('/api/morning/card/withdraw'"), 'withdraw client method missing');
});

test('兴趣标签提供五个输入框与样例且至少填写一个', async () => {
  const form = await readFile(new URL('../public/app/portal/morning-form.js', import.meta.url), 'utf8');
  assert.ok(form.includes('Array.from({ length: 5 }'), 'five tag inputs required');
  assert.ok(form.includes("const tagSamples = ['摄影'"), 'sample tags missing');
  assert.ok(form.includes('请至少填写一个兴趣标签'), 'client must require one tag');
});
