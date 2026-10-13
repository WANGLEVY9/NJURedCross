import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attendanceEvidenceState } from '../public/app/console/pages/attendance-evidence-state.js';
import { dateLines } from '../public/app/console/pages/service-date-state.js';
import { serviceStatus } from '../public/app/console/pages/activity-service-state.js';

test('attendance evidence labels reflect actual photos, text and verification rather than invented codes', () => {
  assert.deepEqual(attendanceEvidenceState({}, null), { label: '待现场签到', text: '', hasPhoto: false });
  assert.equal(attendanceEvidenceState({}, null, true).label, '待提交图片');
  assert.equal(attendanceEvidenceState({ 签到照片ID: 'synthetic' }, null).hasPhoto, true);
  assert.equal(attendanceEvidenceState({}, { legacy: [{ photos: ['https://table.nju.edu.cn/synthetic'] }] }).label, '图片签到');
  const text = attendanceEvidenceState({}, { legacy: [{ note: '现场签到文字' }, { note: '现场签到文字' }, { note: '补充说明' }] });
  assert.equal(text.label, '文字签到'); assert.equal(text.text, '现场签到文字\n补充说明');
  const checked = attendanceEvidenceState({}, { verified: { note: '核对到场身份与时间' } });
  assert.equal(checked.label, '现场核验'); assert.equal(checked.text, '核对到场身份与时间');
});

test('date rows retain service time ranges and omit empty lines', () => {
  assert.deepEqual(dateLines(' 2026-10-03 14:00–17:00\r\n\r\n2026-10-07 下午  \n'), ['2026-10-03 14:00–17:00', '2026-10-07 下午']);
  assert.deepEqual(dateLines(null), []);
});

test('historical returned entries remain actionable without a return-for-changes UI label', () => {
  assert.equal(serviceStatus({ 状态: '已退回' }, false), '待录入');
  assert.equal(serviceStatus({ 状态: '待批准' }, true), '待审核');
});
