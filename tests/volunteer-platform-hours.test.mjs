import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVolunteerHoursIndex,
  lookupVolunteerHours,
  readVolunteerPlatformHours,
  studentIdFromAccount,
} from '../lib/events/volunteer-platform-hours.js';

function platformRow(patch = {}) {
  return { 姓名: '合成同学', 学号: '221250001', 总志愿时长: '12.5', '志愿时长（25-26）': '6', ...patch };
}

test('student ids prefer the stored column and fall back to the mail prefix', () => {
  assert.equal(studentIdFromAccount({ studentId: '522026050057' }), '522026050057');
  assert.equal(studentIdFromAccount({ studentId: '', email: '221250001@smail.nju.edu.cn' }), '221250001');
  assert.equal(studentIdFromAccount({ email: 'WebMaster@nju.edu.cn' }), 'webmaster');
  assert.equal(studentIdFromAccount({ studentId: ' ', email: '' }), '');
});

test('the index matches by name and student id and rejects conflicting duplicates', () => {
  const index = buildVolunteerPlatformIndexFixture();
  assert.deepEqual(lookupVolunteerHours(index, { realName: '合成同学', studentId: '221250001' }), {
    totalHours: 12.5,
    academicYearHours: 6,
  });
  // Conflicting rows for the same identity never yield a fabricated value.
  assert.equal(lookupVolunteerHours(index, { realName: '冲突同学', studentId: '221250002' }), null);
  // Identical duplicates stay usable.
  assert.deepEqual(lookupVolunteerHours(index, { realName: '重复同学', studentId: '221250003' }), {
    totalHours: 3,
    academicYearHours: 3,
  });
  // Rows without a student id cannot be matched.
  assert.equal(lookupVolunteerHours(index, { realName: '缺学号同学', studentId: '' }), null);
  assert.equal(lookupVolunteerHours(index, { realName: '不存在', studentId: '999' }), null);
  assert.equal(lookupVolunteerHours(null, { realName: '合成同学', studentId: '221250001' }), null);

  function buildVolunteerPlatformIndexFixture() {
    return buildVolunteerHoursIndex([
      platformRow(),
      platformRow({ 姓名: '冲突同学', 学号: '221250002', 总志愿时长: '1', '志愿时长（25-26）': '1' }),
      platformRow({ 姓名: '冲突同学', 学号: '221250002', 总志愿时长: '2', '志愿时长（25-26）': '2' }),
      platformRow({ 姓名: '重复同学', 学号: '221250003', 总志愿时长: 3, '志愿时长（25-26）': 3 }),
      platformRow({ 姓名: '重复同学', 学号: '221250003', 总志愿时长: '3', '志愿时长（25-26）': '3' }),
      platformRow({ 姓名: '缺学号同学', 学号: '', 总志愿时长: '9' }),
      platformRow({ 姓名: '空时长同学', 学号: '221250004', 总志愿时长: '', '志愿时长（25-26）': 'abc' }),
    ]);
  }
});

test('invalid or blank hour cells stay empty instead of pretending zero', () => {
  const index = buildVolunteerHoursIndex([platformRow({ 姓名: '空时长同学', 学号: '221250004', 总志愿时长: '', '志愿时长（25-26）': 'abc' })]);
  const hours = lookupVolunteerHours(index, { realName: '空时长同学', studentId: '221250004' });
  assert.equal(hours.totalHours, null);
  assert.equal(hours.academicYearHours, null);
});

test('the platform read refuses truncated tables', async () => {
  const truncated = [{ _id: 'row-1', 姓名: '合成同学', 学号: '221250001', 总志愿时长: '1', '志愿时长（25-26）': '1' }];
  Object.defineProperty(truncated, 'readMeta', { value: { truncated: true } });
  await assert.rejects(() => readVolunteerPlatformHours({
    async listRows() { return truncated; },
  }));

  const pages = [
    platformRow({ _id: 'row-1' }),
    platformRow({ _id: 'row-2', 姓名: '第二同学', 学号: '221250002', 总志愿时长: '0.5', '志愿时长（25-26）': '0.5' }),
  ];
  const complete = await readVolunteerPlatformHours({
    async listRows(table, _v, _o, _c, start = 0, limit = 500) {
      return pages.slice(Number(start), Number(start) + Number(limit));
    },
  });
  assert.equal(complete.get('合成同学|221250001')?.totalHours, 12.5);
  assert.equal(complete.get('第二同学|221250002')?.academicYearHours, 0.5);
});
