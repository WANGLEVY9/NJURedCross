import { activityCampus } from './review-routing.js';
import { REIMBURSEMENT_FORM_FUND_ACCOUNT } from '../../public/app/shared/reimbursement-form.js';
/** Monetary input uses decimal strings; internal arithmetic uses cents. */
export const SUMMARY_LIMITS = Object.freeze({ requests: 20, items: 50, rows: 200, pages: 300, bytes: 100 * 1024 * 1024 });
export function summaryFailure(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode, code: 'reimbursement_summary_invalid' }); }
export function checkedText(value, label, max, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    throw summaryFailure(`请填写${label}，不超过 ${max} 个字符。`);
  return value.trim();
}
export function objectFields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw summaryFailure(`${label}字段不符合接口约定。`);
}
export function checkedDate(value, label) {
  const result = checkedText(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result)
    throw summaryFailure(`${label}须为有效的 YYYY-MM-DD 日期。`);
  return result;
}
export function normalizeActivity(body) {
  objectFields(body, ['id', 'name', 'date', 'campus', 'location', 'participantCount', 'description', 'unitName', 'fundAccount', 'revision'], '活动资料');
  const activity = { name: checkedText(body.name, '活动名称', 100) };
  for (const [key, label, max] of [['location', '活动地点', 100], ['description', '活动目的与内容', 1000], ['unitName', '单位名称', 100], ['fundAccount', '经费卡号', 80]])
    activity[key] = checkedText(body[key], label, max, true);
  activity.date = body.date ? checkedDate(body.date, '活动日期') : '';
  activity.campus = activityCampus(body.campus);
  if (body.campus && !activity.campus) throw summaryFailure('请选择有效的活动举办校区。');
  activity.unitName ||= '南京大学红十字会';
  activity.fundAccount ||= REIMBURSEMENT_FORM_FUND_ACCOUNT;
  activity.participantCount = body.participantCount === undefined || body.participantCount === '' ? null : body.participantCount;
  if (activity.participantCount !== null && (!Number.isSafeInteger(activity.participantCount) || activity.participantCount < 1 || activity.participantCount > 100000))
    throw summaryFailure('活动人数须为 1 至 100000 的整数。');
  return activity;
}
export function normalizeExpenses(body, parseAmount) {
  const supplied = body.activityId !== undefined || body.expenseItems !== undefined;
  if (!supplied) return { activityId: null, expenseItems: [] };
  const activityId = checkedText(body.activityId, '活动 ID', 160);
  if (!Array.isArray(body.expenseItems) || !body.expenseItems.length || body.expenseItems.length > SUMMARY_LIMITS.items)
    throw summaryFailure(`支出明细须为 1 至 ${SUMMARY_LIMITS.items} 项。`);
  const expenseItems = body.expenseItems.map((row, index) => {
    objectFields(row, ['id', 'category', 'label', 'amount', 'note'], '支出明细');
    const category = checkedText(row.category, '报销类别', 50, true);
    return { id: row.id === undefined ? String(index + 1) : checkedText(row.id, '支出项目 ID', 80),
      ...(category ? { category } : {}),
      label: checkedText(row.label, '支出项目', 100), amountCents: parseAmount(row.amount), note: checkedText(row.note, '支出备注', 300, true) };
  });
  if (new Set(expenseItems.map(row => row.id)).size !== expenseItems.length) throw summaryFailure('支出项目 ID 不能重复。');
  if (expenseItems.reduce((sum, row) => sum + row.amountCents, 0) !== parseAmount(body.amount)) throw summaryFailure('支出明细合计必须等于本次申请金额。');
  return { activityId, expenseItems };
}
export function normalizeSummaryForm(body) {
  objectFields(body, ['handlerName', 'handlerPhone', 'fillDate'], '报销表经办信息');
  return { handlerName: checkedText(body.handlerName, '经办人', 50), handlerPhone: checkedText(body.handlerPhone, '联系电话', 50), fillDate: checkedDate(body.fillDate, '填报日期') };
}
/** Integer arithmetic throughout, including zero gaps between 亿 / 万 groups. */
export function chineseAmount(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 999999999999) throw summaryFailure('合计金额超出大写转换范围。');
  const digits = '零壹贰叁肆伍陆柒捌玖', units = ['', '拾', '佰', '仟'];
  function group(n) {
    let result = '', zero = false;
    for (let power = 3; power >= 0; power--) {
      const digit = Math.floor(n / 10 ** power) % 10;
      if (digit) { if (zero && result) result += '零'; result += digits[digit] + units[power]; zero = false; }
      else if (result) zero = true;
    }
    return result;
  }
  const yuan = Math.floor(cents / 100), groups = [Math.floor(yuan / 100000000), Math.floor(yuan / 10000) % 10000, yuan % 10000];
  let whole = '', gap = false;
  groups.forEach((n, i) => { if (!n) { if (whole) gap = true; return; }
    if (whole && (gap || n < 1000)) whole += '零'; whole += group(n) + ['亿', '万', ''][i]; gap = false;
  });
  let result = (whole || '零') + '元';
  const jiao = Math.floor(cents / 10) % 10, fen = cents % 10;
  if (!jiao && !fen) return result + '整';
  if (jiao) result += digits[jiao] + '角';
  else if (yuan && fen) result += '零';
  if (fen) result += digits[fen] + '分';
  return result;
}
