/**
 * 美编登记的两种「查不到唯一一人」场景（2026-11-24）。
 *
 * 需求：名册里没有这个人时，必须明确提示负责人「该成员未注册」，而不是笼统的「没找到」；
 * 同名时不能只报错，要把候选人摆出来让他挑（前端做成横向滑动卡片）。
 * 这里锁死提示文案的判定与卡片模型，DOM 交互由 e2e
 * `tests/browser/outreach-editor-registration.spec.mjs` 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberCards, memberLookupHint } from '../public/app/ui/member-picker.js';

const MEMBER = {
  id: 'ZQmCUBNfQHu1_dWAjwvIAQ',
  name: '汤艺暄',
  studentId: '251880248',
  faculty: '智能科学与技术学院',
  email: '251880248@smail.nju.edu.cn',
};

test('命中成员时不给提示，由页面直接选中或列卡片', () => {
  assert.equal(memberLookupHint('汤艺暄', { members: [MEMBER] }), null);
  assert.equal(memberLookupHint('251880248', { members: [MEMBER] }), null);
});

test('名册查无此人 ⇒ 明确提示「该成员未注册」，并给出补录路径', () => {
  const hint = memberLookupHint('张三', { members: [] });
  assert.equal(hint.title, '该成员未注册');
  assert.equal(hint.tone, 'warning');
  assert.match(hint.text, /张三/);
  assert.match(hint.text, /补录名册/);
});

test('空结果但输入的是残缺学号 ⇒ 提示学号没填完，不误报未注册', () => {
  const hint = memberLookupHint('25188', { members: [] });
  assert.equal(hint.title, '学号还没填完整');
  assert.match(hint.text, /25188/);
  assert.doesNotMatch(hint.text, /未注册/);
});

test('6 位以上数字查无此人 ⇒ 仍按未注册处理（学号可能真的不在册）', () => {
  assert.equal(memberLookupHint('251880', { members: [] }).title, '该成员未注册');
});

test('空查询/空白查询不产生未注册提示', () => {
  assert.equal(memberLookupHint('   ', { members: [] }), null);
  assert.equal(memberLookupHint('', { members: [] }), null);
  assert.equal(memberLookupHint(null, {}), null);
});

test('重名候选：同名者各自标记「同名 N 人」，并按学号去重', () => {
  const cards = memberCards([
    { name: '邓清怡', studentId: '251880101', faculty: '法学院' },
    { name: '邓清怡', studentId: '251880102', faculty: '文学院' },
    // 名册历史重复行：同一学号出现两次只保留一条。
    { name: '邓清怡', studentId: '251880102', faculty: '文学院' },
    MEMBER,
  ]);
  assert.equal(cards.length, 3);
  const twins = cards.filter(card => card.name === '邓清怡');
  assert.deepEqual(twins.map(card => card.studentId), ['251880101', '251880102']);
  assert.deepEqual(twins.map(card => card.sameName), [2, 2]);
  assert.equal(cards.find(card => card.name === '汤艺暄').sameName, 1);
});

test('候选卡片 label 带学号与院系，缺字段的行直接丢弃', () => {
  const [card] = memberCards([MEMBER]);
  assert.equal(card.label, '汤艺暄 · 251880248 · 智能科学与技术学院');
  assert.deepEqual(memberCards([{ name: '无学号' }, { name: '', studentId: '251880999' }, null]), []);
});

test('无院系时 label 不出现多余分隔符', () => {
  const [card] = memberCards([{ name: '李雷', studentId: '251880777' }]);
  assert.equal(card.label, '李雷 · 251880777');
});
