import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOURS_EXPORT_COLUMNS, previewHoursExport } from '../lib/events/hours-export.js';

function fixture(activity = '工位值班') {
  const registrations = ['r1', 'r2'].map((id, index) => ({ _id: id, 学号: 'fixture-1', 姓名: '测试同学', 院系: '测试院系', 活动名称: activity, 报名日期: `2026-10-0${index + 1}`, 报名时段: '上午', 是否报名成功: true, 志愿时长: 2, 录入状态: '待录入', 签到表: [`c${index + 1}`] }));
  const checkins = registrations.map((row, index) => ({ _id: `c${index + 1}`, 学号: row.学号, 活动名称: [row._id] }));
  const config = { _id: 'e1', 活动报名总表: ['r1', 'r2'], 实际培训时长: 99, '实际培训时长/小时': '0.5', '实际交通时长/小时': 1, 具体工作地点: '测试地点', 正式工作日期: '2026-10-01', 志愿者具体工作内容: '测试工作' };
  return { registrations, checkins, config };
}
test('formal special template groups by student and preserves separate hours', () => {
  const f = fixture(); const before = JSON.stringify(f);
  const p = previewHoursExport(f.registrations, f.checkins, ['r1', 'r2'], f.config);
  assert.equal(p.rows.length, 1); assert.deepEqual(p.columns, HOURS_EXPORT_COLUMNS);
  assert.equal(p.rows[0].培训时长, 1); assert.equal(p.rows[0].交通时长, 2); assert.equal(p.rows[0].服务时长, 4);
  assert.match(p.rows[0].正式工作日期, /2026-10-02 上午/); assert.match(p.rows[0].备注, /人工核查/);
  assert.equal(p.writes, false); assert.equal(p.incrementsProfileTotals, false); assert.equal(JSON.stringify(f), before);
});
test('ordinary template keeps each registration separate', () => {
  const f = fixture('测试普通活动');
  const p = previewHoursExport(f.registrations, f.checkins, ['r1', 'r2'], f.config);
  assert.equal(p.rows.length, 2); assert.equal(p.rows[0].培训时长, 0.5);
  assert.equal(p.rows[0].正式工作日期, '2026-10-01');
});
test('export fails closed on missing links, invalid hours or identity conflicts', () => {
  const f = fixture();
  assert.throws(() => previewHoursExport(f.registrations, f.checkins, ['r1'], { ...f.config, 活动报名总表: [] }), /明确关联/);
  assert.throws(() => previewHoursExport(f.registrations, f.checkins, ['r1'], { ...f.config, '实际培训时长/小时': -1 }), /非负/);
  assert.throws(() => previewHoursExport(f.registrations, f.checkins, ['r1', 'r2'], { ...f.config, '实际培训时长/小时': 1e308 }), /有限/);
  f.registrations[1].活动名称 = '测试另一活动';
  assert.throws(() => previewHoursExport(f.registrations, f.checkins, ['r1', 'r2'], f.config), /不同活动/);
  f.registrations[1].活动名称 = f.registrations[0].活动名称;
  f.registrations[1].姓名 = '另一同学';
  assert.throws(() => previewHoursExport(f.registrations, f.checkins, ['r1', 'r2'], f.config), /不同姓名/);
});
test('unverified check-in blocks workbook generation; missing common fields warn', () => {
  const f = fixture();
  assert.equal(previewHoursExport(f.registrations, [], ['r1'], f.config).rows.length, 0);
  const p = previewHoursExport(f.registrations, f.checkins, ['r1'], { ...f.config, 具体工作地点: '' });
  assert.ok(p.warnings.some(message => message.includes('未补齐')));
});
