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
export function birthdayDayOptions(month) {
  const total = BIRTHDAY_DAYS_IN_MONTH[Number(month) - 1] || 31;
  return Array.from({ length: total }, (_, index) => {
    const value = String(index + 1).padStart(2, '0');
    return { value, label: `${index + 1} 日` };
  });
}

/**
 * 「月」选择器联动「日」选择器：月份变化时按该月天数重建日选项，并尽量保留原选择。
 * 加入表单与会员中心编辑抽屉共用，避免两处逻辑漂移。
 */
export function bindBirthdayMonthDay(monthControl, dayControl) {
  monthControl.addEventListener('change', () => {
    const previous = dayControl.value;
    dayControl.replaceChildren(...birthdayDayOptions(monthControl.value).map((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      return node;
    }));
    if (Number(previous) <= dayControl.options.length) dayControl.value = previous;
  });
}
