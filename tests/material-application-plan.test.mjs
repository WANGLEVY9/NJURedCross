import test from 'node:test';
import assert from 'node:assert/strict';
import { materialApplicationPlan } from '../lib/materials/application-plan.js';

const application = {
  状态: '借出（物资）',
  借出审批: '审批通过',
  借用件数: 5,
  归还件数: 1,
};

test('partial return fixes the target quantity in the saved plan', () => {
  const plan = materialApplicationPlan({
    application,
    operation: '归还',
    quantity: 2,
    lossQuantity: 0,
    note: '',
    date: '2026-10-06',
  });

  assert.equal(plan.before.归还件数, 1);
  assert.equal(plan.after.归还件数, 3);
  assert.equal(plan.after.归还状态, '物品缺失/数量减少');
  assert.equal(plan.after.状态, undefined);
});

test('complete return records its completion date and state', () => {
  const plan = materialApplicationPlan({
    application,
    operation: '归还',
    quantity: 4,
    lossQuantity: 0,
    note: '',
    date: '2026-10-06',
  });

  assert.equal(plan.after.归还件数, 5);
  assert.equal(plan.after.归还状态, '已全部归还');
  assert.equal(plan.after.状态, '已归还');
  assert.equal(plan.after.实际归还日期, '2026-10-06');
});

test('checkout preserves previous photos and captures watched fields', () => {
  const plan = materialApplicationPlan({
    application: {
      ...application,
      状态: '开始',
      物资出库照片: ['existing-photo'],
    },
    operation: '出库',
    quantity: 2,
    lossQuantity: 0,
    note: '',
    photoPath: 'new-photo',
    date: '2026-10-06',
  });

  assert.deepEqual(plan.after.物资出库照片, [
    'existing-photo',
    'new-photo',
  ]);
  assert.equal(plan.before.状态, '开始');
  assert.equal(plan.before.借出审批, '审批通过');
  assert.equal(plan.before.借用件数, 5);
});

test('invalid application quantities cannot produce a return plan', () => {
  assert.throws(
    () => materialApplicationPlan({
      application: { ...application, 借用件数: 'invalid' },
      operation: '归还',
      quantity: 2,
      lossQuantity: 0,
      note: '',
      date: '2026-10-06',
    }),
    error => error.code === 'invalid_application_quantity',
  );
});