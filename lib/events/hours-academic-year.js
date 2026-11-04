/** 2026-11-04 确认口径：旧平台新增的学年列与活动机器匹配列。 */
export const LEGACY_ACTIVITY_ID_COLUMN = '活动ID';
export const ACADEMIC_YEAR_COLUMN = '志愿时长（26-27）';
export const ACADEMIC_YEAR_START = '2026-09-01T00:00:00+08:00';
export const ACADEMIC_YEAR_END = '2027-09-01T00:00:00+08:00';

const text = value => String(value ?? '').trim();

/** 学年归属按活动日期；无日期时回落到批准时间，仍无法解析则不纳入本学年。 */
export function inAcademicYear(...values) {
  for (const value of values) {
    const raw=text(value),date=raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    const stamp = Date.parse(date?`${date}T00:00:00+08:00`:raw);
    if (Number.isFinite(stamp))return stamp >= Date.parse(ACADEMIC_YEAR_START) && stamp < Date.parse(ACADEMIC_YEAR_END);
  }
  return false;
}

export const activityIdsOf = value => [...new Set(text(value).split(',').map(item => item.trim()).filter(Boolean))];
