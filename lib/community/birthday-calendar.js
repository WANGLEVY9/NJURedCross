import calendar from './data/lunar-calendar-2026-2030.js';
const months = calendar.months.map(month => ({ ...month, timestamp: Date.parse(month.start) }));
export const BIRTHDAY_CALENDAR_COLUMNS = Object.freeze(['生日历法']);
export const LUNAR_CALENDAR_RANGE = Object.freeze({ start: calendar.start, end: calendar.end });

export function birthdayCalendarSchemaReady(metadata) {
  const table = metadata?.tables?.find(table => table.name === '温暖连接参加表');
  return BIRTHDAY_CALENDAR_COLUMNS.every(name => table?.columns?.some(column => column.name === name && column.type === 'text'));
}

/** Strict boundary validation; missing values mean solar for existing clients/records. */
export function validateBirthdayCalendar(monthDay, kind = 'solar') {
  if (!['solar', 'lunar'].includes(kind)) throw Object.assign(new Error('请选择阳历或阴历生日。'), { statusCode: 400 });
  if (typeof monthDay !== 'string' || !/^\d{2}-\d{2}$/.test(monthDay)) {
    throw Object.assign(new Error('请选择有效的生日月份和日期。'), { statusCode: 400 });
  }
  const [month, day] = monthDay.split('-').map(Number);
  const days = kind === 'lunar' ? 30 : [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (month < 1 || month > 12 || day < 1 || day > days) {
    throw Object.assign(new Error('请选择有效的生日月份和日期。'), { statusCode: 400 });
  }
  return kind;
}

/** A bounded offline lookup. Dates outside the downloaded range never become solar. */
export function lunarDateOn(solarDate) {
  if (typeof solarDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(solarDate) || solarDate < calendar.start || solarDate > calendar.end) return null;
  const timestamp = Date.parse(solarDate);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== solarDate) return null;
  const month = months.findLast(month => month.timestamp <= timestamp);
  if (!month) return null;
  return { month: month.month, day: (timestamp - month.timestamp) / 86400000 + 1, leap: month.leap, days: month.days ?? null };
}

export function isBirthdayOn(enrollment, solarDate) {
  const kind = enrollment.birthdayCalendar || 'solar';
  if (kind === 'solar') return enrollment.birthdayMonthDay === solarDate.slice(5);
  if (kind !== 'lunar') return false;
  const lunar = lunarDateOn(solarDate);
  if (!lunar || lunar.leap) return false;
  const [month, day] = String(enrollment.birthdayMonthDay || '').split('-').map(Number);
  return month === lunar.month && (day === lunar.day || (day === 30 && lunar.day === 29 && lunar.days === 29));
}
