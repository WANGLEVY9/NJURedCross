/* ==========================================================================
   console/pages/materials.js — inventory operations cockpit.
   Order of priority: tasks (approve / overdue / low stock) → ledger → flows.
   Every write goes through a drawer that previews the stock change first.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake, pulse } from '../../core/motion.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction, WRITE_NOTICE } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, notice, receipt, impactPreview,
  emptyState, segmented, skeletonMetrics, skeletonRows, statusFor, statusIndicator,
  definitionList, copyableCode, queueRow, runWithLoading, barTrack,
} from '../../ui/primitives.js';
import { rankedBars } from '../../ui/chart.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const OPERATIONS = [
  { value: '入库', label: '入库', tone: 'success', needsDestination: false, hint: '新采购、回收或补充的物资进入库存。' },
  { value: '出库', label: '出库', tone: 'accent', needsDestination: true, hint: '不经借用单的直接领用，必须写明流转去向。' },
  { value: '盘点增加', label: '盘点增加', tone: 'info', needsDestination: false, hint: '盘点发现实际数量多于台账。' },
  { value: '盘点减少', label: '盘点减少', tone: 'warning', needsDestination: false, hint: '盘点发现实际数量少于台账。' },
  { value: '报损', label: '报损', tone: 'error', needsDestination: false, hint: '确认损坏、失效或无法继续使用。' },
];

function newIdempotencyKey(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

/* --------------------------------------------------------------------------
   Inventory transaction drawer
   -------------------------------------------------------------------------- */
function openTransactionDrawer(item, { defaultOperation = '入库', onDone }) {
  let operation = defaultOperation;
  const idempotencyKey = newIdempotencyKey('TX');

  const quantityField = field({ label: '数量', name: 'quantity', type: 'number', min: 1, step: 1, value: '1', required: true });
  const destinationField = field({ label: '流转去向', name: 'destination', placeholder: '例如：仙林校区献血宣传日 · 张同学领用', hint: '出库必须写明去向，便于后续追溯差额。' });
  const noteField = field({ label: '核查说明', name: 'note', multiline: true, rows: 2, placeholder: '异常、损耗或与台账不一致的情况' });

  const hintNode = h('p', { class: 't-caption' });
  const impactSlot = h('div');

  function delta() {
    const quantity = Math.max(0, Math.round(Number(quantityField.control.value) || 0));
    return ['入库', '盘点增加'].includes(operation) ? quantity : -quantity;
  }

  function renderImpact() {
    const config = OPERATIONS.find((entry) => entry.value === operation);
    hintNode.textContent = config?.hint || '';
    destinationField.hidden = !config?.needsDestination;
    const after = item.quantity + delta();
    clear(impactSlot);
    impactSlot.append(
      impactPreview({ label: `${item.name} 当前数量`, from: item.quantity, to: after, unit: ` ${item.unit}` }),
      after < 0
        ? notice(`库存不足：当前只有 ${item.quantity} ${item.unit}，无法扣减 ${Math.abs(delta())} ${item.unit}。服务端也会拒绝这次写入。`, { tone: 'error', title: '无法提交' })
        : item.threshold !== null && after <= item.threshold
          ? notice(`提交后将低于预警阈值 ${item.threshold} ${item.unit}，建议同时安排补充。`, { tone: 'warning', title: '将触发低库存预警' })
          : null,
    );
  }

  const operationControl = segmented({
    items: OPERATIONS.map((entry) => ({ value: entry.value, label: entry.label })),
    value: operation,
    ariaLabel: '操作类型',
    onChange: (value) => {
      operation = value;
      operationControl.setValue(value);
      renderImpact();
    },
  });

  quantityField.control.addEventListener('input', renderImpact);

  const submitButton = button({ label: '预览并确认写入', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '库存操作',
    title: item.name,
    description: `${item.code} · ${item.center} · ${item.cabinet} 柜 ${item.level} 层`,
    width: 520,
    body: [
      definitionList([
        ['资产编码', copyableCode(item.code)],
        ['当前数量', `${item.quantity} ${item.unit}`],
        ['初始数量', `${item.initial} ${item.unit}`],
        ['预警阈值', item.threshold === null ? '未启用' : `${item.threshold} ${item.unit}`],
      ]),
      h('hr', { class: 'divider' }),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '操作类型' }), operationControl, hintNode),
      quantityField,
      destinationField,
      noteField,
      impactSlot,
      notice(WRITE_NOTICE, { tone: 'neutral', iconName: 'shield' }),
    ],
    footer: [
      h('span', { class: 't-caption t-faint', text: `幂等键 ${idempotencyKey.slice(0, 12)}…` }),
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  renderImpact();

  async function submit() {
    quantityField.setError(null);
    destinationField.setError(null);
    const quantity = Math.round(Number(quantityField.control.value) || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      quantityField.setError('数量必须是正整数');
      shake(quantityField);
      return;
    }
    const config = OPERATIONS.find((entry) => entry.value === operation);
    if (config?.needsDestination && !destinationField.control.value.trim()) {
      destinationField.setError('出库必须填写流转去向');
      shake(destinationField);
      return;
    }
    if (item.quantity + delta() < 0) {
      shake(impactSlot);
      notify.warning('库存不足', '请调整数量后再提交。');
      return;
    }

    const confirmed = await confirmAction({
      title: `确认${operation} ${quantity} ${item.unit}？`,
      description: `${item.name}（${item.code}）的当前数量将从 ${item.quantity} 变为 ${item.quantity + delta()} ${item.unit}。这条记录会写入物资流水表并进入审计。`,
      confirmLabel: `确认${operation}`,
      tone: operation === '报损' || operation === '盘点减少' ? 'danger' : 'neutral',
    });
    if (!confirmed) return;

    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.materials.transaction({
          assetCode: item.code,
          operation,
          quantity,
          destination: destinationField.control.value.trim(),
          note: noteField.control.value.trim(),
          idempotencyKey,
        }),
      );
      if (payload.duplicate) {
        notify.info('这次操作已经记录过', '幂等键命中，没有重复扣减库存。');
      } else {
        notify.success(`${operation}已记录`, `${item.name} · ${quantity} ${item.unit}`);
      }
      drawer.setBody(
        receipt({
          title: `${operation}已写入物资流水`,
          rows: [
            ['物资', `${item.name}（${item.code}）`],
            ['操作', `${operation} ${quantity} ${item.unit}`],
            ['库存变化', `${item.quantity} → ${item.quantity + delta()} ${item.unit}`],
            ['幂等键', idempotencyKey],
          ],
        }),
        notice('可以在下方「最近流水」中核对这条记录是否已经生效。', { tone: 'info' }),
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.status === 400)) {
        notify.warning('写入被拒绝', error.message);
        return;
      }
      reportError(error, '库存操作未完成');
    }
  }
}

/* --------------------------------------------------------------------------
   Application action drawers
   -------------------------------------------------------------------------- */
function openRejectDrawer(application, { onDone }) {
  const reasonField = field({ label: '不通过理由', name: 'reason', required: true, multiline: true, rows: 3, placeholder: '说明原因，便于申请人调整后重新提交' });
  const submitButton = button({ label: '确认不通过', variant: 'danger', iconName: 'close', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '借用审批',
    title: `不通过：${application.purpose}`,
    description: `${application.applicant} · ${application.items}`,
    width: 460,
    body: [
      notice('不通过后申请状态会变为「审批不通过」，理由会写入 SeaTable，申请人可以据此调整后重新申请。', { tone: 'warning' }),
      reasonField,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    reasonField.setError(null);
    const reason = reasonField.control.value.trim();
    if (!reason) {
      reasonField.setError('必须填写不通过理由');
      shake(reasonField);
      return;
    }
    try {
      await runWithLoading(submitButton, () => consoleApi.materials.reject(application.id, reason));
      notify.success('已登记不通过', application.purpose);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.status === 400)) {
        notify.warning('操作被拒绝', error.message);
        return;
      }
      reportError(error, '审批未完成');
    }
  }
}

function openFulfilmentDrawer(application, inventory, { mode, onDone }) {
  const isCheckout = mode === 'checkout';
  const idempotencyKey = newIdempotencyKey(isCheckout ? 'OUT' : 'RET');

  const assetField = field({
    label: '资产编码',
    name: 'assetCode',
    required: true,
    options: [{ value: '', label: '请选择库存物资' }, ...inventory.map((item) => ({ value: item.code, label: `${item.name} · ${item.code} · 现有 ${item.quantity} ${item.unit}` }))],
  });
  const quantityField = field({ label: isCheckout ? '出库数量' : '实际归还数量', name: 'quantity', type: 'number', min: 1, step: 1, value: String(application.quantity || 1), required: true });
  const lossField = isCheckout ? null : field({ label: '损耗数量', name: 'lossQuantity', type: 'number', min: 0, step: 1, value: '0', hint: '无法归还、损坏或丢失的件数。填写后申请会标记为归还异常。' });
  const destinationField = isCheckout ? field({ label: '流转去向', name: 'destination', value: `${application.applicant} · ${application.purpose}`, hint: '默认使用申请人与借用用途，可按实际情况调整。' }) : null;
  const noteField = field({ label: isCheckout ? '出库备注' : '归还核查说明', name: 'note', multiline: true, rows: 2, placeholder: isCheckout ? '现场交接情况' : '外观、配件与功能核查结果' });

  const photoInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'input file-input' });
  const photoPreview = h('div', { class: 'photo-preview', hidden: true });
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    clear(photoPreview);
    photoPreview.hidden = !file;
    if (!file) return;
    const image = h('img', { class: 'photo-preview__img', alt: '现场照片预览' });
    image.src = URL.createObjectURL(file);
    photoPreview.append(image, h('p', { class: 't-caption', text: `${file.name} · ${(file.size / 1024).toFixed(0)} KB` }));
  });

  const impactSlot = h('div');

  function selectedItem() {
    return inventory.find((item) => item.code === assetField.control.value) || null;
  }

  function renderImpact() {
    const item = selectedItem();
    clear(impactSlot);
    if (!item) {
      impactSlot.append(notice('请先选择本次实际使用的库存物资，出入库会绑定到这个资产编码。', { tone: 'neutral' }));
      return;
    }
    const quantity = Math.max(0, Math.round(Number(quantityField.control.value) || 0));
    const after = item.quantity + (isCheckout ? -quantity : quantity);
    impactSlot.append(
      impactPreview({ label: `${item.name} 当前数量`, from: item.quantity, to: after, unit: ` ${item.unit}` }),
      after < 0 ? notice(`库存不足：当前 ${item.quantity} ${item.unit}。`, { tone: 'error', title: '无法提交' }) : null,
    );
    if (!isCheckout) {
      const borrowed = application.quantity || 0;
      const loss = Math.max(0, Math.round(Number(lossField.control.value) || 0));
      const accounted = quantity + loss;
      impactSlot.append(
        notice(
          accounted >= borrowed
            ? `本次登记后累计核销 ${accounted} / ${borrowed} 件，申请将标记为${loss > 0 ? '「物品缺失/数量减少」并进入异常关注' : '已全部归还'}。`
            : `本次登记后累计核销 ${accounted} / ${borrowed} 件，申请仍处于未结清状态。`,
          { tone: accounted >= borrowed && loss === 0 ? 'success' : 'warning', title: '归还结算预览' },
        ),
      );
    }
  }

  assetField.control.addEventListener('change', renderImpact);
  quantityField.control.addEventListener('input', renderImpact);
  lossField?.control.addEventListener('input', renderImpact);

  const submitButton = button({ label: isCheckout ? '确认出库' : '确认归还', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: isCheckout ? '登记出库' : '登记归还',
    title: application.purpose,
    description: `${application.applicant} · ${application.items} · ${application.quantity} 件`,
    width: 540,
    body: [
      assetField,
      h('div', { class: 'formgrid' }, quantityField, lossField),
      destinationField,
      h(
        'div',
        { class: 'field' },
        h(
          'p',
          { class: 'field__label' },
          h('span', { text: isCheckout ? '现场照片' : '归还照片' }),
          isCheckout ? h('span', { class: 'field__req', text: '必填' }) : null,
        ),
        photoInput,
        h('p', { class: 'field__hint', text: 'JPG / PNG / WebP，单张不超过 8 MB。照片会写入 SeaTable 对应的图片列，多次操作会追加而不覆盖。' }),
        photoPreview,
      ),
      noteField,
      impactSlot,
      notice(WRITE_NOTICE, { tone: 'neutral', iconName: 'shield' }),
    ].filter(Boolean),
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  renderImpact();

  async function submit() {
    assetField.setError(null);
    quantityField.setError(null);
    const item = selectedItem();
    if (!item) {
      assetField.setError('请选择资产编码');
      shake(assetField);
      return;
    }
    const quantity = Math.round(Number(quantityField.control.value) || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      quantityField.setError('数量必须是正整数');
      shake(quantityField);
      return;
    }
    const photo = photoInput.files?.[0] || null;
    if (isCheckout && !photo) {
      shake(photoInput);
      notify.warning('需要现场照片', '借出出库必须上传现场照片作为留痕证据。');
      return;
    }

    const form = new FormData();
    form.set('assetCode', item.code);
    form.set('quantity', String(quantity));
    form.set('note', noteField.control.value.trim());
    form.set('idempotencyKey', idempotencyKey);
    if (destinationField) form.set('destination', destinationField.control.value.trim());
    if (lossField) form.set('lossQuantity', String(Math.max(0, Math.round(Number(lossField.control.value) || 0))));
    if (photo) form.set('photo', photo);

    try {
      const payload = await runWithLoading(submitButton, () =>
        isCheckout ? consoleApi.materials.checkout(application.id, form) : consoleApi.materials.returnItems(application.id, form),
      );
      if (payload.duplicate) notify.info('这次操作已经记录过', '幂等键命中，未重复写入。');
      else notify.success(isCheckout ? '出库已登记' : '归还已登记', `${item.name} · ${quantity} ${item.unit}`);
      drawer.setBody(
        receipt({
          title: isCheckout ? '出库已写入流水' : '归还已写入流水',
          rows: [
            ['申请单', application.code],
            ['物资', `${item.name}（${item.code}）`],
            ['数量', `${quantity} ${item.unit}`],
            ['幂等键', idempotencyKey],
          ],
        }),
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.status === 400 || error.status === 502)) {
        notify.warning('操作被拒绝', error.message);
        return;
      }
      reportError(error, isCheckout ? '出库未完成' : '归还未完成');
    }
  }
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */
export default async function materialsPage(context, shell) {
  let snapshot = null;
  let tab = context.query.get('tab') || 'tasks';

  const bodySlot = h('div', { class: 'stack-8' });

  const dataRegion = asyncRegion({
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(6), skeletonRows(8)),
    errorTitle: '物资数据无法加载',
    load: () => consoleApi.materials.overview(),
    render: (payload, { reload }) => {
      snapshot = payload;
      renderBody(reload);
      return [
        metricRow(
          [
            metric({ label: '库存品类', value: payload.stats.categoryCount, unit: '种', hint: h('span', { class: 't-caption', text: `理论总量 ${fmt.int(payload.stats.totalInitialQuantity)} 件` }) }),
            metric({ label: '当前可用', value: payload.stats.totalCurrentQuantity, unit: '件', hint: h('span', { class: 't-caption', text: `差额 ${fmt.signed(payload.stats.totalDifference)} 件` }) }),
            metric({ label: '待审批', value: payload.stats.pendingCount, unit: '单', tone: payload.stats.pendingCount ? 'warn' : '', hint: statusIndicator(payload.stats.pendingCount ? '等待审批' : '无积压', { tone: payload.stats.pendingCount ? 'warning' : 'success', live: Boolean(payload.stats.pendingCount) }), onClick: () => switchTab('applications') }),
            metric({ label: '借出中', value: payload.stats.borrowedCount, unit: '单', hint: h('span', { class: 't-caption', text: '等待归还核销' }) }),
            metric({ label: '逾期未还', value: payload.stats.overdueCount, unit: '单', tone: payload.stats.overdueCount ? 'alert' : '', hint: h('span', { class: 't-caption', text: '已触发邮件提醒条件' }), onClick: () => switchTab('tasks') }),
            metric({ label: '低库存预警', value: payload.stats.lowStockCount, unit: '项', tone: payload.stats.lowStockCount ? 'warn' : '', hint: h('span', { class: 't-caption', text: payload.policy.thresholdRule }) }),
          ],
          { columns: 6 },
        ),
        bodySlot,
      ];
    },
  });

  const tabControl = segmented({
    items: [
      { value: 'tasks', label: '任务队列' },
      { value: 'inventory', label: '库存台账' },
      { value: 'applications', label: '借用申请' },
      { value: 'flows', label: '出入库流水' },
    ],
    value: tab,
    ariaLabel: '物资中心视图',
    onChange: (value) => switchTab(value),
  });

  function switchTab(value) {
    tab = value;
    tabControl.setValue(value);
    if (snapshot) renderBody(() => dataRegion.reload());
  }

  /* ---- Inspectors ------------------------------------------------------- */
  function showInventoryInspector(item, reload) {
    const qr = h('img', { class: 'qr qr--sm', alt: `${item.name} 资产二维码` });
    qr.src = consoleApi.materials.qrUrl(item.id);

    shell.openInspector({
      eyebrow: '库存资产',
      title: item.name,
      subtitle: `${item.code} · ${item.center}`,
      body: [
        h(
          'div',
          { class: 'stack-3' },
          h(
            'div',
            { class: 'row-3 row-wrap' },
            item.lowStock ? badge('低库存', { tone: 'warning', iconName: 'alert' }) : badge('库存正常', { tone: 'success', iconName: 'check' }),
            badge(`${item.cabinet} 柜 ${item.level} 层`, { tone: 'neutral', iconName: 'pin' }),
          ),
          h('div', { class: 'row-base row-2' }, h('b', { class: 't-h1 t-num', text: String(item.quantity) }), h('span', { class: 't-caption', text: `${item.unit} · 当前可用` })),
          item.initial
            ? barTrack([
                { label: '当前可用', value: item.quantity, color: item.lowStock ? 'var(--warning)' : 'var(--success)' },
                { label: '差额', value: Math.max(0, item.initial - item.quantity), color: 'var(--error)' },
              ])
            : null,
        ),
        h('hr', { class: 'divider' }),
        definitionList([
          ['资产编码', copyableCode(item.code)],
          ['初始数量', `${item.initial} ${item.unit}`],
          ['当前数量', `${item.quantity} ${item.unit}`],
          ['库存差额', `${fmt.signed(item.difference)} ${item.unit}`],
          ['预警阈值', item.threshold === null ? '未启用' : `${item.threshold} ${item.unit}`],
          ['新系统流水', `入 ${item.inbound} / 出 ${item.outbound} / 还 ${item.returned} / 损 ${item.loss}`],
          ['未关联差额', item.untrackedDifference ? `${item.untrackedDifference} ${item.unit}` : '无'],
        ]),
        item.untrackedDifference
          ? notice('这部分差额在旧台账中只有汇总数量，没有逐笔来源。平台不会虚构流转记录，需要人工核对后再做盘点调整。', { tone: 'warning', title: '存在未关联的差额' })
          : null,
        item.destinations?.length
          ? h(
              'div',
              { class: 'stack-3' },
              h('p', { class: 't-label', text: '已关联的流转去向' }),
              h('div', { class: 'stack-2' }, ...item.destinations.slice(0, 6).map((destination) => h('div', { class: 'row-3' }, icon('arrowRight', 'ico ico--sm'), h('span', { class: 't-caption spacer truncate', text: destination.label }), h('span', { class: 't-data', text: `${destination.quantity}` })))),
            )
          : null,
        h('hr', { class: 'divider' }),
        h(
          'div',
          { class: 'stack-3' },
          h('p', { class: 't-label', text: '资产二维码' }),
          h('div', { class: 'row-4 row-top' }, qr, h('p', { class: 't-caption', text: '二维码只编码不透明资产码，不含姓名、用途或数量。扫码查询同样需要有效会话。' })),
        ),
      ].filter(Boolean),
      footer: [
        h(
          'div',
          { class: 'row-2' },
          button({ label: '入库', variant: 'primary', size: 'sm', iconName: 'plus', onClick: () => openTransactionDrawer(item, { defaultOperation: '入库', onDone: reload }) }),
          button({ label: '出库', variant: 'secondary', size: 'sm', iconName: 'upload', onClick: () => openTransactionDrawer(item, { defaultOperation: '出库', onDone: reload }) }),
          button({ label: '盘点', variant: 'secondary', size: 'sm', iconName: 'scan', onClick: () => openTransactionDrawer(item, { defaultOperation: '盘点增加', onDone: reload }) }),
        ),
        button({ label: '报损登记', variant: 'danger', size: 'sm', block: true, iconName: 'alert', onClick: () => openTransactionDrawer(item, { defaultOperation: '报损', onDone: reload }) }),
      ],
    });
  }

  function showApplicationInspector(application, reload) {
    const canApprove = application.status.includes('待审批') || application.approval === '待审核';
    const canCheckout = application.approval === '审批通过' && !application.status.includes('借出') && !application.returned;
    const canReturn = application.status.includes('借出') && !application.returned;

    shell.openInspector({
      eyebrow: '借用申请',
      title: application.purpose,
      subtitle: `${application.code} · ${application.applicant}`,
      body: [
        h(
          'div',
          { class: 'row-3 row-wrap' },
          statusFor(application.status),
          badge(application.approval, { tone: application.approval === '审批通过' ? 'success' : application.approval === '审批不通过' ? 'error' : 'warning' }),
          application.overdueDays ? badge(`逾期 ${application.overdueDays} 天`, { tone: 'error', iconName: 'alert' }) : null,
          application.returnStatus.includes('物品缺失') ? badge('归还异常', { tone: 'error' }) : null,
        ),
        h('hr', { class: 'divider' }),
        definitionList([
          ['申请单号', copyableCode(application.code)],
          ['申请人', application.applicant],
          ['借用物资', application.items],
          ['借用件数', `${application.quantity} 件`],
          ['拟借用', fmt.date(application.plannedBorrowDate)],
          ['拟归还', fmt.date(application.plannedReturnDate)],
          ['实际借出', fmt.date(application.actualBorrowDate)],
          ['实际归还', fmt.date(application.actualReturnDate)],
          ['归还状态', fmt.text(application.returnStatus, '未登记')],
        ]),
        canApprove
          ? notice('审批通过后才能出库。通过不需要填写理由；不通过必须说明原因，理由会写回 SeaTable。', { tone: 'info', title: '下一步：审批' })
          : canCheckout
            ? notice('出库需要绑定库存资产编码并上传现场照片，系统会同时写入流水与申请状态。', { tone: 'info', title: '下一步：登记出库' })
            : canReturn
              ? notice('归还按「实际归还数量 + 损耗数量」判断是否结清；存在损耗时会保留异常状态进入关注队列。', { tone: 'info', title: '下一步：登记归还' })
              : notice('这张申请单当前没有待执行的动作。', { tone: 'neutral' }),
      ].filter(Boolean),
      footer: [
        canApprove
          ? h(
              'div',
              { class: 'row-2' },
              button({
                label: '审批通过',
                variant: 'primary',
                size: 'sm',
                iconName: 'check',
                onClick: async () => {
                  const confirmed = await confirmAction({
                    title: '确认审批通过？',
                    description: `${application.applicant} 申请借用「${application.items}」，用途：${application.purpose}。通过后即可登记出库。`,
                    confirmLabel: '审批通过',
                  });
                  if (!confirmed) return;
                  try {
                    await consoleApi.materials.approve(application.id);
                    notify.success('已审批通过', application.purpose);
                    shell.closeInspector();
                    reload();
                    shell.refreshTodos();
                  } catch (error) {
                    reportError(error, '审批未完成');
                  }
                },
              }),
              button({ label: '不通过', variant: 'danger', size: 'sm', iconName: 'close', onClick: () => openRejectDrawer(application, { onDone: () => { shell.closeInspector(); reload(); shell.refreshTodos(); } }) }),
            )
          : null,
        canCheckout
          ? button({ label: '登记出库', variant: 'primary', size: 'sm', block: true, iconName: 'upload', onClick: () => openFulfilmentDrawer(application, snapshot.inventory, { mode: 'checkout', onDone: () => { shell.closeInspector(); reload(); } }) })
          : null,
        canReturn
          ? button({ label: '登记归还', variant: 'primary', size: 'sm', block: true, iconName: 'download', onClick: () => openFulfilmentDrawer(application, snapshot.inventory, { mode: 'return', onDone: () => { shell.closeInspector(); reload(); } }) })
          : null,
      ].filter(Boolean),
    });
  }

  /* ---- Tab bodies -------------------------------------------------------- */
  function renderTasks(reload) {
    const groups = [
      { key: 'pending', label: '待审批借用', priority: 'medium', items: snapshot.pending, iconName: 'inbox', empty: '没有等待审批的借用申请。' },
      { key: 'overdue', label: '逾期未归还', priority: 'high', items: snapshot.overdue, iconName: 'clock', empty: '没有逾期未归还的借用单。' },
      { key: 'abnormal', label: '归还异常', priority: 'high', items: snapshot.abnormalReturns, iconName: 'alert', empty: '没有标记为缺失或数量减少的归还。' },
    ];

    const blocks = groups.map((group) =>
      region({
        label: group.label,
        title: group.items.length ? `${group.items.length} 张申请单` : '队列为空',
        actions: [group.items.length ? badge(fmt.priorityLabel(group.priority), { tone: group.priority === 'high' ? 'error' : 'warning' }) : badge('已清空', { tone: 'success' })],
        dense: true,
        body: group.items.length
          ? h(
              'div',
              { class: 'queue' },
              ...group.items.slice(0, 10).map((application) =>
                queueRow({
                  type: '借用申请',
                  title: application.purpose,
                  detail: `${application.applicant} · ${application.items} · ${application.quantity} 件`,
                  priority: group.priority,
                  meta: [
                    h('code', { class: 't-data t-faint', text: fmt.shortCode(application.code) }),
                    statusFor(application.status),
                    application.overdueDays ? badge(`逾期 ${application.overdueDays} 天`, { tone: 'error' }) : null,
                  ].filter(Boolean),
                  action: button({ label: '查看', variant: 'secondary', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge' }),
                  onClick: () => showApplicationInspector(application, reload),
                }),
              ),
            )
          : emptyState({ iconName: 'check', title: group.empty, description: '新的任务出现时会自动进入这个队列并在左侧导航显示计数。' }),
      }),
    );

    const lowStock = region({
      label: '库存健康',
      title: snapshot.lowStock.length ? `${snapshot.lowStock.length} 项低于阈值` : '库存水位正常',
      description: snapshot.policy.thresholdRule,
      dense: true,
      body: snapshot.lowStock.length
        ? rankedBars({
            data: snapshot.lowStock
              .slice()
              .sort((a, b) => a.quantity - b.quantity)
              .slice(0, 8)
              .map((item) => ({
                label: item.name,
                value: item.quantity,
                extra: `阈值 ${item.threshold}`,
                color: item.quantity === 0 ? 'var(--error)' : 'var(--warning)',
                onClick: () => showInventoryInspector(item, reload),
              })),
            max: Math.max(...snapshot.lowStock.map((item) => item.threshold || 1), 1),
            formatValue: (value) => `${fmt.int(value)} 件`,
          })
        : emptyState({ iconName: 'check', title: '所有物资都在阈值以上', description: '阈值来自物资配置表；未配置时按 max(3, 初始数量 × 20%) 估算。' }),
    });

    return h('div', { class: 'wscols wscols--balanced' }, h('div', { class: 'stack-8' }, ...blocks.slice(0, 2)), h('div', { class: 'stack-8' }, blocks[2], lowStock));
  }

  function renderInventory(reload) {
    return dataTable({
      columns: [
        { key: 'name', label: '物资名称', strong: true, render: (row) => h('div', { class: 'stack-1' }, h('span', { class: 't-secondary t-strong', text: row.name }), h('span', { class: 't-caption', text: `${row.center} · ${row.cabinet} 柜 ${row.level} 层` })) },
        { key: 'code', label: '资产编码', mono: true, render: (row) => h('code', { class: 't-data t-faint', text: fmt.shortCode(row.code, 8) }) },
        { key: 'initial', label: '初始', align: 'right', render: (row) => h('span', { text: fmt.int(row.initial) }) },
        { key: 'quantity', label: '当前', align: 'right', render: (row) => h('span', { class: row.lowStock ? 't-accent' : '', text: fmt.int(row.quantity) }) },
        { key: 'difference', label: '差额', align: 'right', render: (row) => h('span', { class: row.difference > 0 ? 't-muted' : '', text: fmt.signed(row.difference) }) },
        { key: 'threshold', label: '阈值', align: 'right', render: (row) => h('span', { text: row.threshold === null ? '—' : fmt.int(row.threshold) }) },
        { key: 'health', label: '状态', sortable: false, render: (row) => (row.lowStock ? badge('低库存', { tone: 'warning', iconName: 'alert' }) : badge('正常', { tone: 'success' })) },
      ],
      rows: snapshot.inventory,
      getKey: (row) => row.code,
      searchPlaceholder: '搜索物资名称、编码或位置',
      searchKeys: ['name', 'code'],
      countLabel: (n) => `${n} / ${snapshot.inventory.length} 项库存`,
      initialSort: { key: 'quantity', direction: 'asc' },
      onRowClick: (row) => showInventoryInspector(row, reload),
      buildRowMenu: (row) => [
        { label: '查看资产详情', iconName: 'eye', onSelect: () => showInventoryInspector(row, reload) },
        { separator: true },
        { label: '登记入库', iconName: 'plus', onSelect: () => openTransactionDrawer(row, { defaultOperation: '入库', onDone: reload }) },
        { label: '登记出库', iconName: 'upload', onSelect: () => openTransactionDrawer(row, { defaultOperation: '出库', onDone: reload }) },
        { label: '盘点调整', iconName: 'scan', onSelect: () => openTransactionDrawer(row, { defaultOperation: '盘点增加', onDone: reload }) },
        { separator: true },
        { label: '复制资产编码', iconName: 'copy', onSelect: () => navigator.clipboard?.writeText(row.code) },
        { label: '报损登记', iconName: 'alert', variant: 'danger', onSelect: () => openTransactionDrawer(row, { defaultOperation: '报损', onDone: reload }) },
      ],
      actions: [button({ label: '扫码定位', variant: 'secondary', size: 'sm', iconName: 'qr', onClick: () => openScanDrawer(reload) })],
    });
  }

  function renderApplications(reload) {
    return dataTable({
      columns: [
        { key: 'code', label: '申请单', mono: true, render: (row) => h('code', { class: 't-data', text: fmt.shortCode(row.code) }) },
        { key: 'purpose', label: '借用用途', strong: true, render: (row) => h('div', { class: 'stack-1' }, h('span', { class: 't-secondary t-strong t-clamp-1', text: row.purpose }), h('span', { class: 't-caption t-clamp-1', text: row.items })) },
        { key: 'applicant', label: '申请人' },
        { key: 'quantity', label: '件数', align: 'right' },
        { key: 'plannedReturnDate', label: '拟归还', render: (row) => h('span', { text: fmt.date(row.plannedReturnDate) }) },
        { key: 'status', label: '状态', sortable: false, render: (row) => h('div', { class: 'row-2' }, statusFor(row.status), row.overdueDays ? badge(`逾期 ${row.overdueDays}`, { tone: 'error' }) : null) },
        { key: 'approval', label: '审批', render: (row) => badge(row.approval, { tone: row.approval === '审批通过' ? 'success' : row.approval === '审批不通过' ? 'error' : 'warning' }) },
      ],
      rows: snapshot.applications,
      getKey: (row) => row.id,
      searchPlaceholder: '搜索用途、物资或申请人',
      searchKeys: ['purpose', 'items', 'applicant', 'code'],
      countLabel: (n) => `${n} / ${snapshot.applications.length} 张申请单`,
      initialSort: { key: 'plannedReturnDate', direction: 'asc' },
      onRowClick: (row) => showApplicationInspector(row, reload),
      buildRowMenu: (row) => [
        { label: '查看申请详情', iconName: 'eye', onSelect: () => showApplicationInspector(row, reload) },
        { separator: true },
        { label: '审批通过', iconName: 'check', disabled: !(row.status.includes('待审批') || row.approval === '待审核'), onSelect: () => showApplicationInspector(row, reload) },
        { label: '登记出库', iconName: 'upload', disabled: row.approval !== '审批通过', onSelect: () => openFulfilmentDrawer(row, snapshot.inventory, { mode: 'checkout', onDone: reload }) },
        { label: '登记归还', iconName: 'download', disabled: !row.status.includes('借出'), onSelect: () => openFulfilmentDrawer(row, snapshot.inventory, { mode: 'return', onDone: reload }) },
      ],
    });
  }

  function renderFlows() {
    if (!snapshot.recentFlows.length) {
      return emptyState({
        iconName: 'flow',
        title: '还没有出入库流水',
        description: '物资流水表从新系统的第一次真实出库、归还或盘点开始记录。历史台账只有汇总数量，不会被伪造成逐笔事件。',
        actions: [button({ label: '查看库存台账', variant: 'primary', iconAfter: 'arrowRight', iconMotion: 'nudge', onClick: () => switchTab('inventory') })],
      });
    }
    return dataTable({
      columns: [
        { key: 'operation', label: '操作', render: (row) => badge(row.operation, { tone: ['入库', '归还', '盘点增加'].includes(row.operation) ? 'success' : row.operation === '报损' ? 'error' : 'accent' }) },
        { key: 'material', label: '物资', strong: true },
        { key: 'assetCode', label: '资产编码', mono: true, render: (row) => h('code', { class: 't-data t-faint', text: fmt.shortCode(row.assetCode, 8) }) },
        { key: 'quantity', label: '数量', align: 'right' },
        { key: 'change', label: '库存变化', sortable: false, render: (row) => h('span', { class: 't-data' }, h('span', { class: 't-faint', text: String(row.before) }), h('span', { class: 't-accent', text: ' → ' }), h('span', { text: String(row.after) })) },
        { key: 'destination', label: '流转去向', render: (row) => h('span', { class: 't-caption t-clamp-1', text: fmt.text(row.destination, '未标注') }) },
        { key: 'operator', label: '操作人' },
        { key: 'date', label: '时间', render: (row) => h('span', { class: 't-caption', text: fmt.date(row.date) }) },
      ],
      rows: snapshot.recentFlows,
      getKey: (row) => row.id,
      searchPlaceholder: '搜索物资、编码或操作人',
      countLabel: (n) => `最近 ${n} 条流水（共 ${snapshot.stats.flowCount} 条）`,
    });
  }

  function openScanDrawer(reload) {
    const codeField = field({ label: '资产编码', name: 'code', placeholder: 'NJU-RC-XXXXXXXX', hint: '可用扫码枪直接输入，或手工录入二维码内容。', iconName: 'qr' });
    const resultSlot = h('div');
    const lookupButton = button({ label: '定位物资', variant: 'primary', iconName: 'search', onClick: () => lookup() });

    const drawer = openDrawer({
      eyebrow: '扫码定位',
      title: '按资产编码定位库存',
      description: '扫码查询需要有效会话；未注册或格式不正确的编码会被拒绝。',
      width: 460,
      body: [codeField, resultSlot],
      footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), lookupButton],
    });

    codeField.control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') lookup();
    });

    async function lookup() {
      const code = codeField.control.value.trim();
      codeField.setError(null);
      if (!/^NJU-RC-[A-Za-z0-9_-]+$/.test(code)) {
        codeField.setError('编码格式应为 NJU-RC- 开头');
        shake(codeField);
        return;
      }
      clear(resultSlot);
      resultSlot.append(h('div', { class: 'sk sk--block' }));
      try {
        const payload = await runWithLoading(lookupButton, () => consoleApi.materials.scan(code));
        clear(resultSlot);
        const item = payload.item;
        resultSlot.append(
          receipt({
            title: `已定位：${item.name}`,
            rows: [
              ['资产编码', item.code],
              ['位置', `${item.center} · ${item.cabinet} 柜 ${item.level} 层`],
              ['当前数量', `${item.quantity} ${item.unit}`],
              ['预警阈值', item.threshold === null ? '未启用' : `${item.threshold} ${item.unit}`],
            ],
          }),
          h(
            'div',
            { class: 'row-2' },
            button({ label: '入库', variant: 'primary', size: 'sm', iconName: 'plus', onClick: () => { drawer.close(); openTransactionDrawer(item, { defaultOperation: '入库', onDone: reload }); } }),
            button({ label: '出库', variant: 'secondary', size: 'sm', iconName: 'upload', onClick: () => { drawer.close(); openTransactionDrawer(item, { defaultOperation: '出库', onDone: reload }); } }),
            button({ label: '查看详情', variant: 'ghost', size: 'sm', onClick: () => { drawer.close(); showInventoryInspector(item, reload); } }),
          ),
        );
      } catch (error) {
        clear(resultSlot);
        resultSlot.append(notice(error.message || '未能定位该编码。', { tone: 'error', title: '查询失败' }));
      }
    }
  }

  function renderBody(reload) {
    const content =
      tab === 'inventory' ? renderInventory(reload) : tab === 'applications' ? renderApplications(reload) : tab === 'flows' ? renderFlows(reload) : renderTasks(reload);
    const panel = h(
      'div',
      { class: 'stack-5' },
      h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), h('span', { class: 't-caption t-faint', text: `数据来源：${snapshot.policy.source}` })),
      tab === 'tasks' ? content : h('div', { class: 'panel panel--raised' }, content),
    );
    clear(bodySlot);
    bodySlot.append(panel);
    requestAnimationFrame(() => tabControl.reposition?.());
    pulse(bodySlot);
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '物资中心',
      title: '库存任务驾驶舱',
      description: '先看待办，再看数据。审批、出库、归还与盘点都会先展示库存变化，再要求二次确认。',
      actions: [
        button({ label: '扫码定位', variant: 'secondary', iconName: 'qr', onClick: () => openScanDrawer(() => dataRegion.reload()) }),
        reloadAction(dataRegion, '刷新数据'),
      ],
    }),
    dataRegion,
  );

  return { title: '物资中心', crumb: '物资中心', node };
}
