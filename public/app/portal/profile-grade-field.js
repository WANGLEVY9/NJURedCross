import { field } from '../ui/primitives.js';
import {
  ACADEMIC_GRADE_ERROR,
  academicGradeOptions,
  normalizeAcademicGrade,
} from '../shared/academic-grade.js';

export function createProfileGradeField(value = '') {
  const raw = String(value ?? '').trim();
  const normalized = normalizeAcademicGrade(raw);
  const options = [
    { value: '', label: '暂不填写' },
    ...academicGradeOptions(),
  ];
  if (raw && !normalized) {
    options.splice(1, 0, {
      value: raw,
      label: `${raw}（旧格式，请重新选择本/研）`,
    });
  } else if (normalized && !options.some((option) => option.value === normalized)) {
    options.push({
      value: normalized,
      label: `${normalized}（历史年级）`,
    });
  }
  return field({
    label: '年级（选填）',
    name: 'grade',
    value: normalized || raw,
    options,
    hint: '本科生选择“本”，研究生选择“研”，例如 25本、26研。',
  });
}

export function profileGradeValue(gradeField) {
  const raw = gradeField.control.value.trim();
  if (!raw) return { value: '', error: '' };
  const normalized = normalizeAcademicGrade(raw);
  return normalized
    ? { value: normalized, error: '' }
    : { value: raw, error: ACADEMIC_GRADE_ERROR };
}
