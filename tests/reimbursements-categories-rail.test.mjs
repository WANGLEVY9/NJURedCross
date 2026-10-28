import test from 'node:test';
import assert from 'node:assert/strict';
import { REIMBURSEMENT_ACTIVITY_CATEGORIES, reimbursementActivityCategory, reimbursementCampus, reimbursementCategoryOptions } from '../public/app/shared/reimbursement-activities.js';
import { ACTIVITY_CATEGORY_OPTIONS } from '../public/app/shared/activity-taxonomy.js';
import { materialFilename, requestMaterialFilename } from '../public/app/shared/reimbursement-files.js';
import { normalizeExpenses } from '../lib/reimbursements/summary-contract.js';
import { amountCents } from '../lib/reimbursements/local-service.js';
import { reimbursementActivityCatalogue } from '../lib/reimbursements/activity-catalogue.js';

test('finance shares the plaza taxonomy and legacy aliases without turning campus into a category', () => {
  assert.equal(REIMBURSEMENT_ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_OPTIONS);
  assert.deepEqual(reimbursementCategoryOptions().slice(1).map(option => option.value), ACTIVITY_CATEGORY_OPTIONS);
  assert.equal(reimbursementActivityCategory({ category: '主席团' }), '主席团专项');
  assert.equal(reimbursementActivityCategory({ category: '一加助残' }), '一加助残专项');
  assert.equal(reimbursementActivityCategory({ category: '苏州分部' }), '未分类');
  assert.equal(reimbursementCampus('苏州分部'), '苏州');
  for (const campus of ['南京地区', '南京活动', '仙林 / 鼓楼', '仙林校区、鼓楼校区']) assert.equal(reimbursementCampus(campus), '南京');
  assert.equal(reimbursementCampus('苏州 / 仙林'), '');
  const events = reimbursementActivityCatalogue([{ eventId: 'a', name: '活动', center: '生命中心', region: '南京地区', campus: '仙林 / 鼓楼' }], []);
  assert.equal(events[0].category, '生命中心'); assert.equal(events[0].campus, '南京');
  const legacy = reimbursementActivityCatalogue([{ eventId: 'b', category: '主席团', region: '南京活动' }, { eventId: 'c', category: '苏州分部' }], []);
  assert.equal(legacy[0].category, '主席团专项'); assert.equal(legacy[1].category, '未分类'); assert.equal(legacy[1].campus, '苏州');
});

test('rail invoice name follows declared stations and purpose; generic and old names remain compatible', () => {
  const base = { name: '申请人', category: '火车票/高铁票', label: '出行', amount: '20.00', kind: 'invoice', originalName: 'original.pdf', purpose: '参加会议',
    railJourney: { fromStation: '南京南', toStation: '上海虹桥', journey: '往返' } };
  assert.equal(materialFilename(base), '申请人-火车票-南京南-上海虹桥（往返）-参加会议.pdf');
  assert.equal(materialFilename({ ...base, category: '物资采买' }), '申请人-出行-20.00-发票.pdf');
  assert.equal(materialFilename({ ...base, railJourney: undefined }), '申请人-出行-20.00-发票.pdf');
  const request = { name: base.name, purpose: base.purpose, amountCents: 2000,
    expenseItems: [{ id: 'a', category: base.category, label: base.label, amountCents: 2000, railJourney: base.railJourney }] };
  const file = { kind: 'invoice', originalName: 'original.pdf', expenseItemId: 'a' };
  assert.equal(requestMaterialFilename(request, file, 0, [file]), materialFilename(base));
  const invalid = materialFilename({ ...base, railJourney: { ...base.railJourney, fromStation: '../A:B' }, purpose: 'C/D\\E' });
  assert.ok(!/[<>:"/\\|?*]/.test(invalid));
});

test('rail data is validated as structured declared information rather than inferred from OCR', () => {
  const body = { activityId: 'a', amount: '20.00', expenseItems: [{ id: 'a', category: '火车票/高铁票', label: '车票', amount: '20.00',
    railJourney: { fromStation: '南京南', toStation: '上海虹桥', journey: '单程' } }] };
  assert.equal(normalizeExpenses(body, amountCents).expenseItems[0].railJourney.fromStation, '南京南');
  for (const railJourney of [{ fromStation: '', toStation: '上海', journey: '单程' }, { fromStation: '南京', toStation: '南京', journey: '单程' },
    { fromStation: '南京', toStation: '上海', journey: '多程' }, { fromStation: '南京', toStation: '上海', journey: '单程', injected: true }])
    assert.throws(() => normalizeExpenses({ ...body, expenseItems: [{ ...body.expenseItems[0], railJourney }] }, amountCents));
});
