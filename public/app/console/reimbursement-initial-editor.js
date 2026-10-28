import { h } from '../core/dom.js';
import { field, definitionList, notice } from '../ui/primitives.js';
import { reimbursementsApi } from '../shared/reimbursements-api.js';
import { evidenceAmountCents } from '../shared/reimbursement-cross-checks.js';
import { REIMBURSEMENT_CATEGORIES } from '../shared/reimbursement-material-rules.js';
import { railJourneyFields } from '../shared/reimbursement-rail-journey.js';

export function initialReviewEditor(item, { onChange = () => {}, mode = 'initial' } = {}) {
  const activity = field({ label: '关联活动', name: 'initialActivity', searchable: true, value: item.activityId,
    options: [{ value: item.activityId, label: item.activityName || item.activityNameSnapshot || '当前活动' }] });
  const activityName = field({ label: '活动名称', name: 'initialActivityName', value: item.activityName || item.activityNameSnapshot || '', maxlength: 100, required: true });
  const campus = field({ label: '活动举办校区', name: 'initialCampus', value: item.initialAssignment?.campus === '苏州' ? '苏州' : '南京', options: ['南京', '苏州'] });
  const amount = field({ label: '报销金额（元）', name: 'initialAmount', value: (item.amountCents / 100).toFixed(2), required: true });
  const purpose = field({ label: '事由', name: 'initialPurpose', value: item.purpose, multiline: true, rows: 2, maxlength: 500, required: true });
  const date = field({ label: '活动日期', name: 'initialActivityDate', value: item.expenseDate || '', type: 'date', required: true });
  const special = field({ label: '特殊情况说明', name: 'initialSpecialNote', value: item.voucherNote || '', multiline: true, rows: 1, maxlength: 1000 });
  special.classList.add('material-special-note');
  const expenses = item.expenseItems.map((row, index) => ({ id: row.id,
    category: field({ label: '报销类别', name: `initialItemCategory${index}`, value: row.category || '', maxlength: 50,
      ...(item.materialRulesVersion === 1 ? { options: REIMBURSEMENT_CATEGORIES } : {}) }),
    label: field({ label: '物品名称', name: `initialItemName${index}`, value: row.label, required: true, maxlength: 100 }),
    amount: field({ label: '金额（元）', name: `initialItemAmount${index}`, value: (row.amountCents / 100).toFixed(2), required: true }),
    note: field({ label: '用途', name: `initialItemUse${index}`, value: row.note || '', maxlength: 300 }),
    rail: railJourneyFields(`initialRail${index}`, row.railJourney), original: row }));
  const fields = [activity, activityName, campus, amount, purpose, date, special, ...expenses.flatMap(row => [row.category, row.label, row.amount, row.note, ...row.rail.fields])];
  const frozen = new Set(expenses.flatMap(row => Object.hasOwn(item.financeItems || {}, row.id) && item.financeItems[row.id].finalReview
    ? [row.category.control, row.label.control, row.amount.control, row.note.control, ...row.rail.fields.map(field => field.control)] : []));
  frozen.forEach(control => { control.disabled = true; });
  expenses.forEach(row => { row.rail.node.hidden = row.category.control.value !== '火车票/高铁票'; row.category.control.addEventListener('input', () => { row.rail.node.hidden = row.category.control.value !== '火车票/高铁票'; }); });
  let disposed = false, catalogue = [];
  const activityStatus = h('div', { aria: { live: 'polite' } });
  function values() {
    return { activityId: activity.control.value, activityName: activityName.control.value.trim(), campus: campus.control.value,
      amount: amount.control.value.trim(), purpose: purpose.control.value.trim(), expenseDate: date.control.value, voucherNote: special.control.value.trim(),
      expenseItems: expenses.map(row => ({ id: row.id, category: row.category.control.value.trim(),
        ...(row.category.control.value === '火车票/高铁票' && row.rail.value() ? { railJourney: row.rail.value() } : {}),
        label: row.label.control.value.trim(), amount: row.amount.control.value.trim(), note: row.note.control.value.trim() })) };
  }
  const changed = () => {
    const data = values();
    onChange({ ...data, activityNameSnapshot: data.activityName, amountCents: evidenceAmountCents(data.amount),
      initialAssignment: { ...item.initialAssignment, campus: data.campus },
      expenseItems: data.expenseItems.map(row => ({ ...row, amountCents: evidenceAmountCents(row.amount) })) });
  };
  for (const entry of fields) {
    entry.control.addEventListener('input', () => { entry.setError(null); changed(); });
    entry.control.addEventListener('change', changed);
  }
  for (const row of expenses) row.amount.control.addEventListener('input', () => {
    const amounts = expenses.map(row => evidenceAmountCents(row.amount.control.value.trim()));
    amount.control.value = amounts.every(Number.isSafeInteger) ? (amounts.reduce((a, b) => a + b, 0) / 100).toFixed(2) : '';
    changed();
  });
  amount.control.addEventListener('input', () => { if (expenses.length === 1) expenses[0].amount.control.value = amount.control.value; changed(); });
  activity.control.addEventListener('change', () => {
    const selected = catalogue.find(entry => entry.id === activity.control.value);
    if (selected) { activityName.control.value = selected.name; if (selected.date) date.control.value = selected.date;
      campus.control.value = selected.campus === '苏州' ? '苏州' : '南京'; changed(); }
  });
  const node = h('section', { class: `stack-4 material-initial-editor${mode === 'final' ? ' material-final-editor' : ''}` },
    definitionList([['申请编号', item.code], ['申请人', item.name], ['材料版本', `第 ${item.revision} 版`],
      ['初审人', item.initialAssignment?.name || '当前初审人'], [mode === 'final' ? '当前状态' : '通过后状态', '待复审']]),
    activityName, activity, activityStatus, campus, date, amount, purpose,
    h('section', { class: 'stack-3' }, h('h3', { class: 't-h4', text: '物品名称及用途' }),
      ...expenses.map((row, index) => h('div', { class: 'stack-3 material-initial-expense' }, h('p', { class: 't-caption', text: `第 ${index + 1} 项` }),
        row.category, row.rail.node, row.label, row.amount, row.note))), special,
    h('p', { class: 't-caption', text: mode === 'final' ? '保存后需重新生成并核对终审材料；已终审条目保持锁定，原件内容不变。' : '修改将在初审通过时保存，并送复审。' }));
  reimbursementsApi.activities().then(payload => {
    if (disposed) return; catalogue = payload.activities;
    activity.control.replaceChildren(...catalogue.map(entry => h('option', { value: entry.id, text: `${entry.name}${entry.date ? ` · ${entry.date}` : ''}` })));
    if (!catalogue.some(entry => entry.id === item.activityId)) activity.control.prepend(h('option', { value: item.activityId, text: item.activityName || '原关联活动' }));
    activity.control.value = item.activityId;
  }).catch(() => { if (!disposed) activityStatus.replaceChildren(notice('活动目录暂未读取成功，请重新打开后核对关联活动。', { tone: 'warning' })); });
  return { node,
    read() {
      let invalid;
      for (const entry of [activity, activityName, campus, date, amount, purpose, ...expenses.flatMap(row => [row.label, row.amount])]) {
        entry.setError(null); if (!entry.control.value.trim()) { entry.setError('请填写此项'); invalid ||= entry.control; }
      }
      for (const entry of [amount, ...expenses.map(row => row.amount)]) {
        const cents = evidenceAmountCents(entry.control.value.trim());
        if (!Number.isSafeInteger(cents) || cents < 1) { entry.setError('请输入大于零的金额，最多两位小数'); invalid ||= entry.control; }
      }
      for (const row of expenses) if (row.category.control.value === '火车票/高铁票') invalid ||= row.rail.validate(Boolean(row.original.railJourney) || row.original.category !== '火车票/高铁票');
      const data = values();
      if (!invalid && data.expenseItems.reduce((sum, row) => sum + evidenceAmountCents(row.amount), 0) !== evidenceAmountCents(data.amount)) {
        amount.setError('报销金额须等于逐项金额合计'); invalid = amount.control;
      }
      if (invalid) { invalid.focus(); return null; }
      return data;
    },
    setDisabled(value) { fields.forEach(entry => { entry.control.disabled = value || frozen.has(entry.control); }); },
    dispose() { disposed = true; },
  };
}
