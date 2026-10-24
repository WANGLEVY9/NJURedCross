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

export const ACADEMIC_GRADE_ERROR = '请选择“25本”或“26研”格式的年级；本科生选“本”，研究生选“研”。';

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

export function academicGradeOptions({
  currentYear = new Date().getFullYear(),
  yearsBack = 10,
  yearsForward = 1,
} = {}) {
  const firstYear = currentYear - Math.max(0, yearsBack);
  const lastYear = currentYear + Math.max(0, yearsForward);
  const options = [];
  for (let year = lastYear; year >= firstYear; year -= 1) {
    const code = String(year).slice(-2);
    options.push(
      { value: `${code}本`, label: `${code}本（${year}级本科生）` },
      { value: `${code}研`, label: `${code}研（${year}级研究生）` },
    );
  }
  return options;
}
