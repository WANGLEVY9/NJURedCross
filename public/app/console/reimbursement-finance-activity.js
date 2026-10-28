import { h } from '../core/dom.js';
import { field, button, notice } from '../ui/primitives.js';
import { openDrawer } from '../ui/overlay.js';
import { reimbursementsApi as api } from '../shared/reimbursements-api.js';
import { REIMBURSEMENT_FORM_FUND_ACCOUNT } from '../shared/reimbursement-form.js';
import { reimbursementCategoryOptions, reimbursementActivityCategory } from '../shared/reimbursement-activities.js';

export function financeActivityDialog(item, { onDone }) {
  const fields = {
    name: field({ name: 'financeActivityName', label: '活动名称', required: true, maxlength: 100, value: item?.name || '' }),
    category: field({ name: 'financeActivityCategory', label: '活动类别', value: item?.category ? reimbursementActivityCategory(item) : '',
      options: reimbursementCategoryOptions(item?.category ? reimbursementActivityCategory(item) : '') }),
    campus: field({ name: 'financeActivityCampus', label: '举办校区', value: item?.campus || '', options: [{ value: '', label: '请选择校区' }, ...['苏州', '仙林', '鼓楼', '浦口'].map(value => ({ value, label: value }))] }),
    date: field({ name: 'financeActivityDate', label: '活动日期', type: 'date', value: item?.date || '' }),
    location: field({ name: 'financeActivityLocation', label: '地点', maxlength: 100, value: item?.location || '' }),
    participantCount: field({ name: 'financeActivityParticipants', label: '活动人数', type: 'number', min: 1, max: 100000, step: 1, value: item?.participantCount ?? '' }),
    description: field({ name: 'financeActivityDescription', label: '活动目的与内容', multiline: true, rows: 3, maxlength: 1000, value: item?.description || '' }),
  };
  const feedback = h('div', { aria: { live: 'polite' } });
  const save = button({ label: '保存活动资料', variant: 'primary', onClick: async () => {
    if (save.disabled) return; save.disabled = true; feedback.replaceChildren();
    try {
      const body = Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.control.value.trim()]));
      body.participantCount = body.participantCount === '' ? null : Number(body.participantCount);
      await api.saveActivity({ ...body, unitName: '南京大学红十字会', fundAccount: REIMBURSEMENT_FORM_FUND_ACCOUNT,
        ...(item ? { id: item.id, revision: item.revision } : {}) });
      await drawer.close(); await onDone();
    } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); } finally { save.disabled = false; }
  } });
  const drawer = openDrawer({ title: item ? '编辑报销活动资料' : '新建报销活动', width: 740, body: [h('div', { class: 'stack-4' },
    fields.name, h('div', { class: 'formgrid' }, fields.category, fields.campus, fields.date, fields.location, fields.participantCount), fields.description,
    h('p', { class: 't-caption', text: '活动名称和类别用于条目分组；固定单位与经费卡信息自动填入报销表。已有报销单保留生成时的活动资料。' }), feedback)], footer: [save] });
}
