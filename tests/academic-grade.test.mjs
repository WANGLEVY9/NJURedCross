import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACADEMIC_GRADE_ERROR as SERVER_ERROR,
  academicGradeDisplay,
  academicGradeError,
  normalizeAcademicGrade,
} from '../lib/identity/academic-grade.js';
import {
  ACADEMIC_GRADE_ERROR as CLIENT_ERROR,
  academicGradeOptions,
  normalizeAcademicGrade as normalizeClientGrade,
} from '../public/app/shared/academic-grade.js';
import { toMorningAdminCardView } from '../lib/morning/admin.js';

test('年级统一为两位入学年份加本或研', () => {
  for (const value of ['25本', '2025本', '2025级本科', '2025 届 本科生']) {
    assert.equal(normalizeAcademicGrade(value), '25本');
    assert.equal(normalizeClientGrade(value), '25本');
  }
  for (const value of ['26研', '2026研', '2026级研究生', '2026级硕士', '2026级硕士研究生', '2026届博士研究生']) {
    assert.equal(normalizeAcademicGrade(value), '26研');
    assert.equal(normalizeClientGrade(value), '26研');
  }
});

test('无法确认学历层次的旧年级不会被静默猜测', () => {
  assert.equal(normalizeAcademicGrade('2025级'), '');
  assert.equal(academicGradeDisplay('2025级'), '2025级');
  assert.equal(academicGradeError('2025级'), SERVER_ERROR);
  assert.equal(academicGradeError('25本'), '');
  assert.equal(academicGradeError(''), '');
  assert.equal(CLIENT_ERROR.includes('25本'), true);
});

test('年级选项同时提供本科生和研究生', () => {
  const options = academicGradeOptions({ currentYear: 2026, yearsBack: 2, yearsForward: 0 });
  assert.deepEqual(options.map(option => option.value), [
    '26本', '26研', '25本', '25研', '24本', '24研',
  ]);
  assert.equal(options[0].label, '26本（2026级本科生）');
  assert.equal(options[1].label, '26研（2026级研究生）');
});

test('内建成员管理层展示规范化年级', () => {
  const view = toMorningAdminCardView({
    名片ID: 'MNG-GRADE',
    账号ID: 'ACC-GRADE',
    年级快照: '2026级研究生',
    审核状态: '待审核',
  });
  assert.equal(view.grade, '26研');
});
