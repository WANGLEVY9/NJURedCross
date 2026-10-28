import test from 'node:test';
import assert from 'node:assert/strict';
import { integerInput, returnProgress, returnPreview, csvCell, flowsCsv, inventoryLifecycleEnabled, inventoryOperationAllowed } from '../public/app/console/materials-model.js';

test('quantity inputs reject decimals, exponents, signs, empty and unsafe integers', () => {
  for (const value of ['1.7', '1e2', '-1', '+2', '', ' ', 'NaN', 'Infinity', '9007199254740992']) assert.equal(integerInput(value), null, value);
  assert.equal(integerInput('5'), 5);
  assert.equal(integerInput(' 12 '), 12);
  assert.equal(integerInput('0'), null);
  assert.equal(integerInput('0', { allowZero: true }), 0);
});

test('partial returns retain cumulative loss and support total-loss settlement', () => {
  const application = { checkoutQuantity: 10, returnedQuantity: 3, lossQuantity: 2, quantity: 99 };
  assert.deepEqual(returnProgress(application), { borrowed: 10, returned: 3, loss: 2, outstanding: 5 });
  assert.deepEqual(returnPreview(application, 2, 1), { borrowed: 10, returned: 5, loss: 3, outstanding: 2, exceeds: false });
  assert.deepEqual(returnPreview(application, 0, 5), { borrowed: 10, returned: 3, loss: 7, outstanding: 0, exceeds: false });
  assert.equal(returnPreview(application, 4, 2).exceeds, true);
});

test('asset lifecycle controls require an explicit demo or production capability', () => {
  for (const payload of [undefined, {}, { capabilities: {} }, { capabilities: { inventoryLifecycle: { create: true, availability: true } } }]) {
    assert.equal(inventoryLifecycleEnabled(payload, 'create'), false);
    assert.equal(inventoryLifecycleEnabled(payload, 'availability'), false);
  }
  const payload = { capabilities: { inventoryLifecycle: { mode: 'local-demo', create: true, availability: false } } };
  assert.equal(inventoryLifecycleEnabled(payload, 'create'), true);
  assert.equal(inventoryLifecycleEnabled(payload, 'availability'), false);
  assert.equal(inventoryLifecycleEnabled({ capabilities: { inventoryLifecycle: { mode: 'production', create: true } } }, 'create'), true);
});

test('disabled assets forbid new intake and checkout but preserve settlement and investigation', () => {
  const disabled = { availability: 'disabled' };
  for (const operation of ['入库', '出库']) assert.equal(inventoryOperationAllowed(disabled, operation), false);
  for (const operation of ['归还', '盘点增加', '盘点减少', '报损']) assert.equal(inventoryOperationAllowed(disabled, operation), true);
  for (const item of [{}, { availability: 'active' }]) {
    for (const operation of ['入库', '出库', '归还']) assert.equal(inventoryOperationAllowed(item, operation), true);
  }
});

test('CSV preserves multilingual fields, escaping and neutralizes formula prefixes', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-cmd', '@SUM(A1)', '  =1', '\ttext', '\ntext']) assert.ok(csvCell(value).startsWith('"\''), value);
  assert.equal(csvCell('外观完好,"齐全"'), '"外观完好,""齐全"""');
  const csv = flowsCsv([{ id: 'flow-1', material: '急救箱', quantity: 3, note: '=SUM(A1)', syncPending: true }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('急救箱'));
  assert.ok(csv.includes('"\'=SUM(A1)"'));
  assert.ok(csv.includes('"是"'));
  assert.equal(csv.split('\r\n').length, 3);
});
