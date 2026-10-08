/* ==========================================================================
   portal/pages/materials-inbound.js
   Task: register new materials (purchase or donation) into the catalogue.
   Member-only; the record waits for an administrator to verify the physical
   items before stock changes.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, getSessionState } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, notice, receipt, copyableCode, runWithLoading, badge } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import { isSignedIn, hasRedCrossMembership, loginRequiredPanel, memberOnlyPanel, redirectIfAuthError } from '../auth-gate.js';

export default async function materialsInboundPage() {
  const formSlot = h('div', { class: 'stack-6' });
  const mine = h('section', { class: 'stack-3' });
  let disposed = false;
  const submitButton = button({ label: '提交入库登记', variant: 'primary', iconName: 'check', onClick: () => submit() });

  let catalog = [];
  let materialField = null;
  let quantityField = null;
  let locationField = null;
  let noteField = null;
  let sourceField = null;
  let operationKey = crypto.randomUUID();

  function buildForm() {
    clear(formSlot);
    if (!isSignedIn()) {
      formSlot.append(loginRequiredPanel({ what: '物资入库登记', hint: '登记会归属到你的账号，管理员审核通过后才会更新库存。' }));
      return;
    }
    if (!hasRedCrossMembership()) {
      formSlot.append(memberOnlyPanel({ what: '物资入库登记', hint: '入库登记影响库存台账，因此仅对红十字会员开放。' }));
      return;
    }
    if (getSessionState().user?.localPreview) formSlot.append(notice('本地联调：提交与审核仅保存在本次服务内存中，不修改远端库存。', { tone: 'info' }));

    materialField = field({
      label: '物资种类',
      name: 'materialId',
      required: true,
      options: [{ value: '', label: '请选择物资' }].concat(catalog.map((item) => ({ value: item.id, label: `${item.name}（${item.unit}） · ${item.location}` }))),
    });
    quantityField = field({ label: '入库数量', name: 'quantity', type: 'number', min: 1, step: 1, value: '1', required: true });
    locationField = field({ label: '存放位置', name: 'location', required: true, placeholder: '例如：仙林 · 柜 B-2 / 库房' });
    sourceField = field({ label: '物资来源', name: 'source', options: ['采购', '捐赠'], value: '采购' });
    noteField = field({ label: '来源 / 说明', name: 'note', multiline: true, rows: 3, maxlength: 500, placeholder: '填写采购批次或捐赠说明。借用归还由管理员关联原借用单登记。' });

    formSlot.append(
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '入库信息' })),
        materialField,
        h('div', { class: 'formgrid' }, quantityField, locationField),
        sourceField, noteField,
      ),
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '确认提交' })),
        notice('入库登记不等于直接增加库存：需要管理员现场核对实物与数量后才生效。', { tone: 'neutral' }),
      ),
      h('div', { class: 'row-3' }, h('span', { class: 'spacer' }), submitButton),
    );
  }

  async function submit() {
    for (const control of [materialField, quantityField, locationField]) if (control) control.setError(null);

    let invalid = null;
    if (!materialField?.control?.value) { materialField.setError('请选择物资种类'); invalid = materialField; }
    if (!Number.isSafeInteger(Number(quantityField?.control?.value)) || Number(quantityField?.control?.value) < 1) { quantityField.setError('入库数量须为正整数'); invalid = invalid || quantityField; }
    if (!locationField.control.value.trim()) { locationField.setError('请填写存放位置'); invalid = invalid || locationField; }
    if (invalid) { shake(invalid); invalid.control.focus(); return; }

    const item = catalog.find((i) => i.id === materialField.control.value);
    try {
      const payload = await runWithLoading(submitButton, () => publicApi.materialInbound({
        name: item?.name || '未命名物资',
        materialId: item.id,
        assetCode: item.assetCode,
        source: sourceField.control.value,
        idempotencyKey: operationKey,
        quantity: Number(quantityField.control.value),
        location: locationField.control.value.trim(),
        note: noteField.control.value.trim(),
      }));
      notify.success('入库登记已提交', '管理员核对后会更新库存。');
      operationKey = crypto.randomUUID();
      await loadMine();
      clear(formSlot);
      formSlot.append(
        receipt({
          title: '入库登记已提交，等待管理员审核',
          rows: [
            ['登记编号', payload.code],
            ['物资', `${item?.name || '—'} × ${quantityField.control.value} ${item?.unit || ''}`.trim()],
            ['存放位置', locationField.control.value.trim()],
            ['当前状态', payload.status],
          ],
        }),
        h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.code, { label: '复制登记编号' }), h('span', { class: 't-caption', text: '审核通过后库存才会更新。' })),
        h('div', { class: 'row-3' }, button({ label: '返回物资广场', variant: 'secondary', href: '/materials' }), button({ label: '再登记一批', variant: 'ghost', iconName: 'plus', onClick: () => buildForm() })),
      );
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      reportError(error, '入库登记未提交');
    }
  }

  async function loadCatalog() {
    try { catalog = await publicApi.materialCatalog(); } catch (error) {
      formSlot.replaceChildren(notice(`物资目录未加载：${error.message}`, { tone: 'error' }), button({ label: '重试', onClick: loadCatalog })); return;
    }
    if (!catalog.length) { formSlot.replaceChildren(notice('暂无可用物资种类，请联系管理员维护物资资料。', { tone: 'info' })); return; }
    buildForm();
  }
  async function loadMine() {
    if (!isSignedIn() || !hasRedCrossMembership()) return;
    try {
      const data = await publicApi.materialInboundMine(); if (disposed) return;
      const labels = { pending: '待核对', approved: '已入库', rejected: '已拒绝' };
      mine.replaceChildren(h('div', { class: 'row-3 row-wrap' }, h('h2', { class: 't-h3', text: '我的入库登记' }), button({ label: '刷新状态', variant: 'ghost', onClick: loadMine })),
        ...data.records.map(item => h('div', { class: 'panel' }, h('div', { class: 'panel__body stack-2' },
          h('b', { text: `${item.name} · ${item.quantity} ${item.unit} · ${labels[item.status]}` }),
          h('p', { class: 't-caption', text: `${item.code} · ${item.location}` }), item.reviewNote ? h('p', { class: 't-secondary', text: `核对意见：${item.reviewNote}` }) : null))));
      if (!data.records.length) mine.append(h('p', { class: 't-secondary', text: '暂无登记记录。' }));
    } catch (error) { if (!disposed) mine.replaceChildren(notice(`登记记录未加载：${error.message}`, { tone: 'warning' }), button({ label: '重试', onClick: loadMine })); }
  }

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' },
      h('header', { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/materials' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回物资广场' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '物资广场 · 入库' }), badge('待管理员审核', { tone: 'accent', iconName: 'shield' })),
        h('h1', { class: 't-h1', text: '物资入库登记' }),
        h('p', { class: 't-prose', text: '登记新采购或捐赠物资的种类、数量与存放位置。提交后由管理员核对实物，确认无误后再更新库存台账。' }),
      ),
      formSlot, mine,
    ),
  );

  await loadCatalog();
  await loadMine();
  return { title: '物资入库登记', node, dispose: () => { disposed = true; } };
}
