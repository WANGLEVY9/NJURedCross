/* ==========================================================================
   portal/pages/materials-reimburse.js
   Task: register an activity reimbursement and track its review status.
   Activity names are bound to the activity square (活动广场).
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, notice, runWithLoading, badge, emptyState, definitionList } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { mockActivityList } from '../../core/mock.js';

export default async function materialsReimbursePage() {
  const listSlot = h('div', { class: 'stack-4' });
  const formSlot = h('div', { class: 'stack-6' });
  const submitButton = button({ label: '提交报销申请', variant: 'primary', iconName: 'send', onClick: () => submit() });

  let activities = [];
  let eventField = null;
  let amountField = null;
  let descriptionField = null;
  let dateField = null;
  let voucherField = null;

  function buildForm() {
    clear(formSlot);
    if (!isSignedIn()) {
      formSlot.append(loginRequiredPanel({ what: '财务报销', hint: '报销记录会归属到你的账号，财务核对后会通知结果。' }));
      return;
    }

    eventField = field({
      label: '关联活动',
      name: 'eventId',
      required: true,
      options: [{ value: '', label: '请选择活动' }].concat(activities.map((a) => ({ value: a.id, label: a.name }))),
      hint: '活动名称与活动广场同步，用于财务核对入账。',
    });
    amountField = field({ label: '报销金额（元）', name: 'amount', type: 'number', min: 0.01, step: 0.01, required: true, placeholder: '0.00' });
    dateField = field({ label: '费用发生日期', name: 'date', type: 'date', required: true, value: fmt.todayISO(), max: fmt.todayISO() });
    descriptionField = field({ label: '报销事项说明', name: 'description', required: true, multiline: true, rows: 3, placeholder: '例如：活动宣传物料采购、志愿者交通补贴等' });
    voucherField = field({ label: '凭证说明', name: 'voucher', multiline: true, rows: 2, placeholder: '发票、收据或转账记录编号（正式凭证上传接口就绪后可替换为文件上传）', hint: '当前为前端演示，凭证暂以文字备注记录。' });

    formSlot.append(
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '报销信息' })),
        eventField,
        h('div', { class: 'formgrid' }, amountField, dateField),
        descriptionField,
        voucherField,
      ),
      h('div', { class: 'row-3' }, h('span', { class: 'spacer' }), submitButton),
    );
  }

  async function renderList() {
    clear(listSlot);
    let records = [];
    try { records = await publicApi.reimbursements(); } catch { records = []; }
    if (!records.length) {
      listSlot.append(emptyState({ iconName: 'file', title: '还没有报销记录', description: '提交的报销申请会显示在这里，可随时查看审核状态。' }));
      return;
    }
    listSlot.append(h('p', { class: 't-caption t-muted', text: `共 ${records.length} 条报销记录` }));
    for (const r of records) {
      listSlot.append(
        h('div', { class: 'panel panel--raised' },
          h('div', { class: 'panel__body stack-3' },
            h('div', { class: 'row-between row-wrap' }, h('h3', { class: 't-h3', text: r.eventName }), badge(r.status, { tone: 'accent', iconName: 'clock' })),
            definitionList([['金额', `¥${fmt.dec(r.amount)}`], ['事项', r.description || '—'], ['提交时间', fmt.dateTime(r.submittedAt)]]),
          ),
        ),
      );
    }
  }

  async function submit() {
    for (const control of [eventField, amountField, descriptionField, dateField]) if (control) control.setError(null);

    let invalid = null;
    if (!eventField?.control?.value) { eventField.setError('请选择关联活动'); invalid = eventField; }
    const amount = Number(amountField?.control?.value);
    if (!amount || amount <= 0) { amountField.setError('请填写有效金额'); invalid = invalid || amountField; }
    if (!descriptionField.control.value.trim()) { descriptionField.setError('请填写报销事项说明'); invalid = invalid || descriptionField; }
    if (invalid) { shake(invalid); invalid.control.focus(); return; }

    const activity = activities.find((a) => a.id === eventField.control.value);
    try {
      await runWithLoading(submitButton, () => publicApi.reimbursementCreate({
        eventId: eventField.control.value,
        eventName: activity?.name || '未关联活动',
        amount,
        description: descriptionField.control.value.trim(),
        date: dateField.control.value,
      }));
      notify.success('报销申请已提交', '财务核对后会通知结果。');
      buildForm();
      await renderList();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      reportError(error, '报销申请未提交');
    }
  }

  async function loadData() {
    try {
      const data = await publicApi.events();
      const list = Array.isArray(data) ? data : (data?.events || []);
      if (list.length) activities = list.map((e) => ({ id: e.eventId || e.id || e._id, name: e.name }));
    } catch { activities = []; }
    if (!activities.length) activities = mockActivityList();
    buildForm();
    await renderList();
  }

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' },
      h('header', { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/materials' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回物资广场' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '物资广场 · 报销' }), badge('财务核对', { tone: 'accent', iconName: 'shield' })),
        h('h1', { class: 't-h1', text: '财务报销' }),
        h('p', { class: 't-prose', text: '填写报销事项与金额并关联对应活动。财务核对通过后会通知你；金额、凭证与审批流程当前为前端演示，正式数据接口就绪后无缝接入。' }),
      ),
      h('section', { class: 'stack-4' }, h('h2', { class: 't-h2', text: '我的报销记录' }), listSlot),
      formSlot,
    ),
  );

  await loadData();
  return { title: '财务报销', node };
}
