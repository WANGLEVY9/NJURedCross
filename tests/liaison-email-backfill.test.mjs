import test from 'node:test';
import assert from 'node:assert/strict';
import { planLiaisonEmailBackfill } from '../lib/attachment/liaison-emails.js';

const liaison = (over = {}) => ({
  _id: 'row-1', 对接人ID: 'LSN-01', 姓名: '王诺', 负责栏目: '活动总结', 角色: '对接人', 邮箱: '', 启用: '是', ...over,
});
const account = (over = {}) => ({ _id: 'acc-1', 真实姓名: '王诺', 邮箱: 'w@example.invalid', 收信邮箱: '', 邮箱已验证: '已验证', 状态: '启用', ...over });

test('空邮箱按姓名回填，来源标记为已验证', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [account()]);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0], { rowId: 'row-1', name: '王诺', email: 'w@example.invalid', source: 'verified' });
  assert.equal(plan.ambiguous.length, 0);
  assert.equal(plan.missing.length, 0);
});

test('「邮箱已验证=是」的老写法也认', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [account({ 邮箱已验证: '是' })]);
  assert.equal(plan.updates[0].source, 'verified');
});

test('停用账号不参与回填', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [account({ 状态: '已停用' })]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.missing[0].reason, 'no_account');
  const disabled = planLiaisonEmailBackfill([liaison()], [account({ 状态: '禁用' })]);
  assert.equal(disabled.updates.length, 0);
});

test('已有邮箱的行绝不覆盖', () => {
  const plan = planLiaisonEmailBackfill([liaison({ 邮箱: 'manual@example.invalid' })], [account()]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.alreadyFilled, 1);
});

test('「邮箱」空时退回「收信邮箱」', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [account({ 邮箱: '', 收信邮箱: 'box@example.invalid' })]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].email, 'box@example.invalid');
});

test('同名多个账号且邮箱不同 → 判为歧义，不猜', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [
    account({ _id: 'a1', 邮箱: 'w1@example.invalid', 邮箱已验证: '否' }),
    account({ _id: 'a2', 邮箱: 'w2@example.invalid', 邮箱已验证: '否' }),
  ]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.ambiguous.length, 1);
  assert.deepEqual(plan.ambiguous[0].emails.sort(), ['w1@example.invalid', 'w2@example.invalid']);
});

test('同名多个账号但只有一个已验证 → 用已验证的那个', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [
    account({ _id: 'a1', 邮箱: 'old@example.invalid', 邮箱已验证: '否' }),
    account({ _id: 'a2', 邮箱: 'new@example.invalid', 邮箱已验证: '是' }),
  ]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].email, 'new@example.invalid');
});

test('同名多个账号但邮箱完全相同 → 视为唯一，正常回填', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [
    account({ _id: 'a1' }), account({ _id: 'a2' }),
  ]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].email, 'w@example.invalid');
});

test('账号表查无此人 → missing/no_account，不写空值', () => {
  const plan = planLiaisonEmailBackfill([liaison({ 姓名: '查无此人' })], [account()]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].reason, 'no_account');
});

test('姓名为空 → missing/missing_name', () => {
  const plan = planLiaisonEmailBackfill([liaison({ 姓名: '  ' })], [account()]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.missing[0].reason, 'missing_name');
});

test('姓名前后空格、账号表姓名带空格都能匹配', () => {
  const plan = planLiaisonEmailBackfill([liaison({ 姓名: ' 王诺 ' })], [account({ 真实姓名: '王诺  ' })]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].email, 'w@example.invalid');
});

test('账号表里的非法邮箱不入索引', () => {
  const plan = planLiaisonEmailBackfill([liaison()], [account({ 邮箱: 'not-an-email' })]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.missing[0].reason, 'no_account');
});

test('缺 _id 的行跳过；非数组入参不炸', () => {
  assert.equal(planLiaisonEmailBackfill([{ 姓名: '王诺', 邮箱: '' }], [account()]).updates.length, 0);
  const empty = planLiaisonEmailBackfill(undefined, undefined);
  assert.deepEqual(empty, { updates: [], ambiguous: [], missing: [], alreadyFilled: 0 });
});
