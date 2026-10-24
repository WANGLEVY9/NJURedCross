const ACADEMIC_GRADE_PATTERN = /^(?:(20)?(\d{2}))(?:\s*(?:级|届))?\s*(本科生|硕士研究生|博士研究生|本科|研究生|硕士|博士|本|研|硕|博)$/;

const ACADEMIC_LEVEL = Object.freeze({
  本: '本',
  本科: '本',
  本科生: '本',
  研: '研',
  研究生: '研',
  硕: '研',
  硕士: '研',
  硕士研究生: '研',
  博: '研',
  博士: '研',
  博士研究生: '研',
});

export const ACADEMIC_GRADE_ERROR = '年级请选择“25本”或“26研”格式；本科生选“本”，研究生选“研”。';

export function normalizeAcademicGrade(value) {
  const source = String(value ?? '').trim();
  const match = source.match(ACADEMIC_GRADE_PATTERN);
  if (!match) return '';
  return `${match[2]}${ACADEMIC_LEVEL[match[3]]}`;
}

export function academicGradeDisplay(value) {
  const source = String(value ?? '').trim();
  return normalizeAcademicGrade(source) || source;
}

export function academicGradeError(value, { allowEmpty = true } = {}) {
  const source = String(value ?? '').trim();
  if (!source) return allowEmpty ? '' : ACADEMIC_GRADE_ERROR;
  return normalizeAcademicGrade(source) ? '' : ACADEMIC_GRADE_ERROR;
}
