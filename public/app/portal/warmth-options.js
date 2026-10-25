/* ==========================================================================
   portal/warmth-options.js
   Shared birthday-enrolment choices for the warmth surfaces
   (/community join form and the /me edit drawer), so the campus whitelist
   and the per-month day count can never drift apart.
   ========================================================================== */

export const BIRTHDAY_CAMPUS_OPTIONS = ['鼓楼', '仙林', '苏州', '浦口'];
export const BIRTHDAY_CAMPUS_CHOICES = [
  { value: '', label: '请选择校区' },
  ...BIRTHDAY_CAMPUS_OPTIONS.map((campus) => ({ value: campus, label: campus })),
];
export const BIRTHDAY_MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1).padStart(2, '0');
  return { value, label: `${index + 1} 月` };
});
const BIRTHDAY_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const BIRTHDAY_CALENDAR_OPTIONS = [{ value: 'solar', label: '阳历（公历）' }, { value: 'lunar', label: '阴历（农历）' }];
export const BIRTHDAY_CALENDAR_HINT = '阴历生日按每年对应的农历日期投递；闰月出生按普通同月，三十遇到小月按二十九。当前日期数据覆盖至 2030 年底。';
export function birthdayLabel(item) {
  return `${item.birthdayCalendar === 'lunar' ? '阴历' : '阳历'} ${item.birthdayMonthDay || '—'}`;
}
export function birthdayDayOptions(month, calendar = 'solar') {
  const total = calendar === 'lunar' ? 30 : BIRTHDAY_DAYS_IN_MONTH[Number(month) - 1] || 31;
  return Array.from({ length: total }, (_, index) => {
    const value = String(index + 1).padStart(2, '0');
    return { value, label: `${index + 1} 日` };
  });
}

/**
 * 「月」选择器联动「日」选择器：月份变化时按该月天数重建日选项，并尽量保留原选择。
 * 加入表单与会员中心编辑抽屉共用，避免两处逻辑漂移。
 */
export function bindBirthdayMonthDay(monthControl, dayControl, calendarControl = null) {
  const sync = () => {
    const previous = dayControl.value;
    dayControl.replaceChildren(...birthdayDayOptions(monthControl.value, calendarControl?.value).map((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      return node;
    }));
    dayControl.value = String(Math.min(Number(previous) || 1, dayControl.options.length)).padStart(2, '0');
  };
  monthControl.addEventListener('change', sync);
  calendarControl?.addEventListener('change', sync);
}
