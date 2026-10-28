import { objectFields, checkedText, checkedDate, normalizeExpenses, summaryFailure } from './summary-contract.js';
import { REIMBURSEMENT_CATEGORIES } from '../../public/app/shared/reimbursement-material-rules.js';

/** Corrections belong to this request; the shared activity catalogue and account binding stay intact. */
export function normalizeInitialEdits(item, body, { activities, parseAmount, label = '初审修改' }) {
  objectFields(body, ['activityId', 'activityName', 'campus', 'amount', 'purpose', 'expenseDate', 'voucherNote', 'expenseItems'], label);
  if (item.workflowVersion !== 3) throw summaryFailure('此申请暂不支持初审直接修改。');
  const expenses = normalizeExpenses(body, parseAmount);
  if (item.materialRulesVersion === 1 && expenses.expenseItems.some(row => !REIMBURSEMENT_CATEGORIES.includes(row.category))) throw summaryFailure('请选择有效的报销类别。');
  if (!activities.has(expenses.activityId)) throw summaryFailure('关联活动不存在，请刷新活动目录。');
  if (!['南京', '苏州'].includes(body.campus)) throw summaryFailure('校区请选择南京或苏州。');
  if (!item.initialAssignment?.key || !item.initialAssignment.name) throw summaryFailure('缺少固定初审归属，请刷新核对。');
  if (expenses.expenseItems.length !== item.expenseItems.length
    || expenses.expenseItems.some((row, index) => row.id !== item.expenseItems[index].id))
    throw summaryFailure('初审修改须保留原支出项目及顺序，新增或删除项目请退回申请人补充。');
  const patch = { ...expenses, activityNameSnapshot: checkedText(body.activityName, '活动名称', 100),
    amountCents: parseAmount(body.amount), purpose: checkedText(body.purpose, '事由', 500),
    expenseDate: checkedDate(body.expenseDate, '活动日期'), voucherNote: checkedText(body.voucherNote, '特殊情况说明', 1000, true),
    initialAssignment: { ...item.initialAssignment, campus: body.campus } };
  const before = Object.fromEntries(Object.keys(patch).map(key => [key, structuredClone(item[key] ?? null)]));
  return JSON.stringify(before) === JSON.stringify(patch) ? null : { patch, audit: { before, after: structuredClone(patch) } };
}
