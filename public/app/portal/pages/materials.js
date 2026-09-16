/* ==========================================================================
   portal/pages/materials.js
   Task: request a loan of Red Cross equipment. Three disclosed steps, an
   explicit review of exactly what will be submitted, then a tracking code.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, checkbox, notice, receipt, steps, copyableCode, definitionList, runWithLoading } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';

const STEP_NAMES = ['申请人', '借用内容', '确认提交'];

export default async function materialsPage() {
  const today = fmt.todayISO();

  const nameField = field({ label: '姓名', name: 'name', required: true, iconName: 'user', placeholder: '与校园卡一致' });
  const studentIdField = field({ label: '学号', name: 'studentId', required: true, iconName: 'file', placeholder: '用于核对借用责任人' });
  const emailField = field({
    label: '校内邮箱',
    name: 'email',
    type: 'email',
    required: true,
    iconName: 'mail',
    placeholder: 'your_id@smail.nju.edu.cn',
    hint: '审批结果、出库与归还提醒都会发送到这个邮箱。',
  });

  const itemsField = field({
    label: '借用物资与数量',
    name: 'items',
    required: true,
    multiline: true,
    rows: 3,
    placeholder: '例如：急救箱 1 个、血压计 2 台、宣传展架 1 套',
    hint: '请逐项写清名称与数量，方便管理员按资产编码核对库存。',
  });
  const quantityField = field({ label: '总件数', name: 'quantity', type: 'number', min: 1, step: 1, value: '1', required: true });
  const purposeField = field({ label: '借用用途', name: 'purpose', required: true, placeholder: '例如：仙林校区无偿献血宣传日现场服务' });
  const borrowDateField = field({ label: '拟借用日期', name: 'plannedBorrowDate', type: 'date', required: true, value: today, min: today });
  const returnDateField = field({ label: '拟归还日期', name: 'plannedReturnDate', type: 'date', required: true, value: today, min: today });

  const consent = checkbox({
    name: 'consent',
    label: '我已阅读并承担借用与归还责任',
    description: '借出时需现场拍照留痕，归还时需核对数量与完好情况。若出现缺失或损坏，需说明情况并配合后续处理。逾期未归还会收到邮件提醒。',
  });

  const reviewSlot = h('div', { class: 'stack-4' });
  const panels = [
    h('div', { class: 'fieldset' }, h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '谁来借用' }), h('p', { class: 't-caption', text: '用于确认借用责任人，信息不会在公开页面展示。' })), h('div', { class: 'formgrid' }, nameField, studentIdField), emailField),
    h('div', { class: 'fieldset' }, h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '借什么、什么时候' }), h('p', { class: 't-caption', text: '管理员会按这些信息核对库存并安排出库。' })), itemsField, h('div', { class: 'formgrid' }, quantityField, purposeField), h('div', { class: 'formgrid' }, borrowDateField, returnDateField)),
    h('div', { class: 'fieldset' }, h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '确认提交内容' }), h('p', { class: 't-caption', text: '提交后会创建一条「待审批」申请，物资管理员会在管理端处理。' })), reviewSlot, consent),
  ];

  let step = 0;
  const stepSlot = h('div');
  const panelSlot = h('div');
  const actionSlot = h('div', { class: 'row-3' });

  function fieldsFor(index) {
    return index === 0 ? [nameField, studentIdField, emailField] : index === 1 ? [itemsField, quantityField, purposeField, borrowDateField, returnDateField] : [];
  }

  function validate(index) {
    let firstInvalid = null;
    for (const control of fieldsFor(index)) control.setError(null);
    for (const control of fieldsFor(index)) {
      const value = String(control.control.value || '').trim();
      if (!value) {
        control.setError('这一项是必填的');
        firstInvalid = firstInvalid || control;
      }
    }
    if (index === 0) {
      const email = emailField.control.value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailField.setError('请填写有效的邮箱地址');
        firstInvalid = firstInvalid || emailField;
      }
    }
    if (index === 1) {
      const borrow = borrowDateField.control.value;
      const back = returnDateField.control.value;
      if (borrow && back && back < borrow) {
        returnDateField.setError('归还日期不能早于借用日期');
        firstInvalid = firstInvalid || returnDateField;
      }
      if (Number(quantityField.control.value) < 1) {
        quantityField.setError('总件数至少为 1');
        firstInvalid = firstInvalid || quantityField;
      }
    }
    if (firstInvalid) {
      shake(firstInvalid);
      firstInvalid.control.focus();
      return false;
    }
    return true;
  }

  function renderReview() {
    clear(reviewSlot);
    const borrow = borrowDateField.control.value;
    const back = returnDateField.control.value;
    const days = borrow && back ? Math.max(0, Math.round((new Date(back) - new Date(borrow)) / 86400000)) : 0;
    reviewSlot.append(
      definitionList([
        ['申请人', `${nameField.control.value.trim()} · ${studentIdField.control.value.trim()}`],
        ['通知邮箱', emailField.control.value.trim()],
        ['借用物资', itemsField.control.value.trim()],
        ['总件数', `${quantityField.control.value} 件`],
        ['借用用途', purposeField.control.value.trim()],
        ['借用周期', `${fmt.date(borrow)} → ${fmt.date(back)}（${days} 天）`],
      ]),
      notice('提交后申请状态为「待审批」。审批通过后才会出库；出库和归还都会在物资流水中留下可追溯记录。', { tone: 'info' }),
    );
  }

  function render() {
    // A loan is a commitment between the platform and a named applicant, so the
    // three-step form stays closed until the visitor has an account.
    if (!isSignedIn()) {
      stepSlot.replaceChildren();
      panelSlot.replaceChildren(loginRequiredPanel({ what: '物资借用申请', hint: '借用与归还责任需要绑定到明确的申请人，审批结果也会回到你的账号。' }));
      clear(actionSlot);
      return;
    }
    stepSlot.replaceChildren(steps(STEP_NAMES, step));
    panelSlot.replaceChildren(panels[step]);
    if (step === 2) renderReview();

    clear(actionSlot);
    if (step > 0) {
      actionSlot.append(button({
        label: '上一步',
        variant: 'ghost',
        iconName: 'chevronLeft',
        onClick: () => {
          step -= 1;
          render();
        },
      }));
    }
    actionSlot.append(h('span', { class: 'spacer' }));
    if (step < 2) {
      actionSlot.append(button({
        label: '继续',
        variant: 'primary',
        iconAfter: 'arrowRight',
        iconMotion: 'nudge',
        onClick: () => {
          if (!validate(step)) return;
          step += 1;
          render();
        },
      }));
    } else {
      const submitButton = button({ label: '提交借用申请', variant: 'primary', iconName: 'check', onClick: () => submit(submitButton) });
      actionSlot.append(submitButton);
    }
  }

  async function submit(trigger) {
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要你的确认', '请先确认借用与归还责任条款。');
      return;
    }
    try {
      const payload = await runWithLoading(trigger, () =>
        publicApi.materialRequest({
          name: nameField.control.value.trim(),
          studentId: studentIdField.control.value.trim(),
          email: emailField.control.value.trim(),
          items: itemsField.control.value.trim(),
          quantity: Number(quantityField.control.value) || 1,
          purpose: purposeField.control.value.trim(),
          plannedBorrowDate: borrowDateField.control.value,
          plannedReturnDate: returnDateField.control.value,
          consent: true,
        }),
      );
      notify.success('申请已提交', payload.message);
      panelSlot.replaceChildren(
        h(
          'div',
          { class: 'stack-5' },
          receipt({
            title: '借用申请已进入审批队列',
            rows: [
              ['申请编号', payload.request.code],
              ['当前状态', payload.request.status],
              ['借用物资', payload.request.items],
              ['借用周期', `${fmt.date(payload.request.plannedBorrowDate)} → ${fmt.date(payload.request.plannedReturnDate)}`],
            ],
          }),
          h(
            'div',
            { class: 'row-3 row-wrap' },
            copyableCode(payload.request.code, { label: '复制申请编号' }),
            h('span', { class: 't-caption', text: '审批结果会发送到你填写的邮箱。' }),
          ),
          notice('如果活动时间有变化，请及早联系物资管理员调整，避免占用其他同学需要的物资。', { tone: 'neutral' }),
          h('div', { class: 'row-3' }, button({ label: '返回首页', variant: 'secondary', href: '/' }), button({ label: '浏览活动', variant: 'ghost', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/events' })),
        ),
      );
      stepSlot.replaceChildren(steps(STEP_NAMES, 3));
      clear(actionSlot);
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && (error.status === 400 || error.isRateLimited)) {
        notify.warning('申请未提交', error.message);
        return;
      }
      reportError(error, '申请未提交');
    }
  }

  const node = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'formpage' },
      h(
        'header',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回首页' })),
        h('p', { class: 't-label', text: '物资借用' }),
        h('h1', { class: 't-h1', text: '申请借用红十字会物资' }),
        h('p', { class: 't-prose', text: '急救箱、血压计、宣传展架与活动器材面向校内班级、社团与公益活动开放借用。提交后由物资管理员审批，出库与归还都会拍照留痕并记录流水。' }),
      ),
      stepSlot,
      panelSlot,
      actionSlot,
    ),
  );

  render();
  return { title: '物资借用', node };
}
