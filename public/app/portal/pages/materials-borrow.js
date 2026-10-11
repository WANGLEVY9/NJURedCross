/* ==========================================================================
   portal/pages/materials-borrow.js
   Task: request a loan of Red Cross equipment, choosing a material from the
   catalog (with remaining quantity) instead of free text. Member-only.
   ========================================================================== */

import { materialServices } from '../../shared/material-services.js';
import { announceMaterialChange } from '../../shared/materials-sync.js';
import { h, icon, clear } from '../../core/dom.js';
import { publicApi, ApiError, getSessionState } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, checkbox, notice, receipt, copyableCode, runWithLoading, badge } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, hasRedCrossMembership, loginRequiredPanel, memberOnlyPanel, redirectIfAuthError } from '../auth-gate.js';

export default async function materialsBorrowPage() {
  const today = fmt.todayISO();

  const nameField = field({ label: '姓名', name: 'name', required: true, iconName: 'user', placeholder: '与校园卡一致' });
  const studentIdField = field({ label: '学号', name: 'studentId', required: true, iconName: 'file', placeholder: '用于核对借用责任人' });
  const emailField = field({ label: '校内邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', placeholder: 'your_id@smail.nju.edu.cn', hint: '用于核对借用责任人，邮件通知将在后续统一接入。' });
  const purposeField = field({ label: '借用用途', name: 'purpose', required: true, placeholder: '例如：仙林校区无偿献血宣传日现场服务' });
  const borrowDateField = field({ label: '拟借用日期', name: 'plannedBorrowDate', type: 'date', required: true, value: today, min: today });
  const returnDateField = field({ label: '拟归还日期', name: 'plannedReturnDate', type: 'date', required: true, value: today, min: today });

  const consent = checkbox({
    name: 'consent',
    label: '我已阅读并承担借用与归还责任',
    description: '借出时需现场拍照留痕，归还时需核对数量与完好情况。若出现缺失或损坏，需说明情况并配合后续处理。请按约定时间归还。',
  });

  const formSlot = h('div', { class: 'stack-6' });
  const submitButton = button({ label: '提交借用申请', variant: 'primary', iconName: 'check', onClick: () => submit() });

  let catalog = [];
  let materialField = null;
  let quantityField = null;
  let stockHint = null;
  let operationKey = crypto.randomUUID();

  function selectedItem() {
    return catalog.find((item) => item.id === materialField?.control?.value) || null;
  }

  function updateStock() {
    if (!stockHint) return;
    const item = selectedItem();
    if (!item) {
      stockHint.textContent = '请先选择物资种类，再填写借用数量。';
      return;
    }
    stockHint.textContent = item.remaining <= 0
      ? '该物资当前无库存，暂时无法借用。'
      : `当前剩余 ${item.remaining} ${item.unit} · 存放于 ${item.location}。${item.approvalMode === 'automatic' ? '马甲借用免人工审批，提交后自动通过，出库时登记实际数量。' : '提交后由管理员审批。'}`;
  }

  function validateQuantity() {
    const item = selectedItem();
    const qty = Number(quantityField?.control?.value);
    if (!item || !qty) return;
    if (!Number.isSafeInteger(qty) || qty < 1) quantityField.setError('借用数量须为正整数');
    else if (qty > item.remaining) quantityField.setError(`剩余数量不足，最多可借 ${item.remaining} ${item.unit}`);
    else quantityField.setError(null);
  }

  function buildForm() {
    clear(formSlot);
    if (!isSignedIn()) {
      formSlot.append(loginRequiredPanel({ what: '物资借用申请', hint: '借用与归还责任需要绑定到明确的申请人，审批结果也会回到你的账号。' }));
      return;
    }
    if (!hasRedCrossMembership()) {
      formSlot.append(memberOnlyPanel({ what: '物资借用申请', hint: '借用器材涉及保管与归还责任，仅对红十字会内部成员开放，资格以组织「中心」列判定。非内部成员如有需要，请联系管理员线下借用。' }));
      return;
    }

    const profile = getSessionState().user || {};
    if (!nameField.control.value) nameField.control.value = profile.realName || '';
    if (!studentIdField.control.value) studentIdField.control.value = profile.studentId || '';
    if (!emailField.control.value) emailField.control.value = profile.email || '';

    materialField = field({
      label: '物资种类',
      name: 'materialId',
      searchable: true,
      required: true,
      options: [{ value: '', label: '请选择要借用的物资' }].concat(catalog.map((item) => ({ value: item.id, label: `${item.name}（剩 ${item.remaining} ${item.unit}） · ${item.location}` }))),
      hint: '括号内为该物资当前可借用的剩余数量。',
    });
    quantityField = field({ label: '借用数量', name: 'quantity', type: 'number', min: 1, step: 1, value: '1', required: true });
    stockHint = h('p', { class: 't-caption t-muted', text: '请先选择物资种类，再填写借用数量。' });

    materialField.control.addEventListener('change', updateStock);
    quantityField.control.addEventListener('input', validateQuantity);

    formSlot.append(
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '借什么' }), h('p', { class: 't-caption', text: '从库存目录中选择物资，借用数量受剩余库存约束。' })),
        materialField,
        quantityField,
        stockHint,
      ),
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '借用信息' })),
        h('div', { class: 'formgrid' }, borrowDateField, returnDateField),
        purposeField,
      ),
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '谁来借用' }), h('p', { class: 't-caption', text: '联系方式仅用于审批与提醒，不会公开展示。' })),
        h('div', { class: 'formgrid' }, nameField, studentIdField),
        emailField,
      ),
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '责任确认' })),
        consent,
      ),
      h('div', { class: 'row-3' }, h('span', { class: 'spacer' }), submitButton),
    );
  }

  async function submit() {
    for (const control of [materialField, quantityField, purposeField, nameField, studentIdField, emailField, borrowDateField, returnDateField]) if (control) control.setError(null);

    let invalid = null;
    if (!materialField?.control?.value) { materialField.setError('请选择要借用的物资'); invalid = materialField; }
    const item = selectedItem();
    const qty = Number(quantityField?.control?.value);
    if (!Number.isSafeInteger(qty) || qty < 1) { quantityField.setError('借用数量须为正整数'); invalid = invalid || quantityField; }
    else if (item && qty > item.remaining) { quantityField.setError(`剩余数量不足，最多可借 ${item.remaining} ${item.unit}`); invalid = invalid || quantityField; }
    if (!purposeField.control.value.trim()) { purposeField.setError('请填写借用用途'); invalid = invalid || purposeField; }
    if (!nameField.control.value.trim()) { nameField.setError('请填写姓名'); invalid = invalid || nameField; }
    if (!studentIdField.control.value.trim()) { studentIdField.setError('请填写学号'); invalid = invalid || studentIdField; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.control.value.trim())) { emailField.setError('请填写有效的邮箱地址'); invalid = invalid || emailField; }
    const borrow = borrowDateField.control.value;
    const back = returnDateField.control.value;
    if (borrow && back && back < borrow) { returnDateField.setError('归还日期不能早于借用日期'); invalid = invalid || returnDateField; }
    if (invalid) { shake(invalid); invalid.control.focus(); return; }
    if (!consent.control.checked) { shake(consent); notify.warning('需要你的确认', '请先确认借用与归还责任条款。'); return; }

    try {
      const payload = await runWithLoading(submitButton, () => publicApi.materialRequest({
        name: nameField.control.value.trim(),
        studentId: studentIdField.control.value.trim(),
        email: emailField.control.value.trim(),
        items: `${item.name} ${qty} ${item.unit}`,
        materialId: item.id,
        assetCode: item.assetCode,
        idempotencyKey: operationKey,
        quantity: qty,
        purpose: purposeField.control.value.trim(),
        plannedBorrowDate: borrowDateField.control.value,
        plannedReturnDate: returnDateField.control.value,
        consent: true,
      }));
      notify.success('申请已提交', payload.message);
      announceMaterialChange();
      operationKey = crypto.randomUUID();
      clear(formSlot);
      formSlot.append(
        receipt({
          title: payload.request.approvalMode === 'automatic' ? '马甲借用已自动通过' : '借用申请已进入审批队列',
          rows: [
            ['申请编号', payload.request.code],
            ['借用物资', payload.request.items],
            ['当前状态', payload.request.statusLabel || payload.request.status],
            ['借用周期', `${fmt.date(payload.request.plannedBorrowDate)} → ${fmt.date(payload.request.plannedReturnDate)}`],
          ],
        }),
        h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.request.code, { label: '复制申请编号' }), h('span', { class: 't-caption', text: payload.request.approvalMode === 'automatic' ? '无需等待审批，实际出库后可在“物资归还”登记归还。' : '本地联调暂未发送邮件，请由管理员查看审批队列。' })),
        notice('出库和归还都会拍照留痕，请按约定时间归还，避免影响其他同学使用。', { tone: 'neutral' }),
        h('div', { class: 'row-3' }, button({ label: '返回物资广场', variant: 'secondary', href: '/materials' }), button({ label: '再借一批', variant: 'ghost', iconName: 'plus', onClick: () => buildForm() })),
      );
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && (error.status === 400 || error.isRateLimited)) {
        notify.warning('申请未提交', error.message);
        return;
      }
      reportError(error, '申请未提交');
    }
  }

  async function loadCatalog() {
    try { catalog = await publicApi.materialCatalog(); } catch (error) {
      formSlot.replaceChildren(notice(`物资目录未加载：${error.message}`, { tone: 'error' }), button({ label: '重试', onClick: loadCatalog })); return;
    }
    if (!catalog.length) { formSlot.replaceChildren(notice('暂无可用物资，请联系物资管理员。', { tone: 'info' })); return; }
    buildForm();
  }

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' }, materialServices('loan'),
      h('header', { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/materials' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回物资广场' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '物资广场 · 借用' }), badge('借用登记', { tone: 'accent', iconName: 'shield' })),
        h('h1', { class: 't-h1', text: '申请借用红十字会物资' }),
        h('p', { class: 't-prose', text: '选择物资后查看剩余数量。马甲借用提交后自动通过，其他物资由管理员审批；出库和归还均保留记录。' }),
      ),
      formSlot,
    ),
  );

  await loadCatalog();
  return { title: '物资借用', node };
}
