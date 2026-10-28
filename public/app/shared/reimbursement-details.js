import { h, icon } from '../core/dom.js';
import { button, definitionList, notice } from '../ui/primitives.js';
import { reimbursementAmount } from './reimbursements-api.js';
import { invoiceCheckSummary } from './invoice-checks.js';
import { pdfPreview } from './pdf-preview.js';
import { openMaterialPreview } from './material-preview.js';
import * as fmt from '../core/format.js';
import { MATERIAL_KINDS, INVOICE_FIELD_LABELS, invoicePages, currentMaterialName, requestMaterialFilename } from './reimbursement-files.js';
import { reimbursementMaterialGroups } from './reimbursement-groups.js';
import { reimbursementCrossChecks } from './reimbursement-cross-checks.js';
import { materialAnalysisFeedback } from './material-analysis-feedback.js';

export function bundleDetails(bundle, { withPreview = false, checks = null, request = null, originalsFirst = false, mergedFirst = false } = {}) {
  const downloadStatus = h('div', { aria: { live: 'polite' } });
  const supportingFiles = bundle.originalUrls.filter(file => file.kind === 'supporting');
  const originalName = file => request ? requestMaterialFilename(request, file, bundle.originalUrls.indexOf(file), bundle.originalUrls)
    : currentMaterialName(file.name, file.kind, supportingFiles.indexOf(file));
  function downloadLink(file, label = '下载原件', variant = 'ghost') {
    const name = originalName(file);
    const link = button({ label, variant, size: 'sm', href: file.url });
    link.setAttribute('download', name);
    if (name !== file.name) {
      let pending = false;
      link.addEventListener('click', async event => {
        event.preventDefault(); if (pending) return;
        pending = true; link.setAttribute('aria-busy', 'true'); downloadStatus.replaceChildren();
        try {
          const response = await fetch(file.url, { credentials: 'same-origin' });
          if (!response.ok) throw new Error('材料下载失败，请刷新后重试。');
          const url = URL.createObjectURL(await response.blob());
          const save = h('a', { href: url, download: name });
          document.body.append(save); save.click(); save.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { downloadStatus.replaceChildren(notice(error.message, { tone: 'error' })); }
        finally { pending = false; link.removeAttribute('aria-busy'); }
      });
    }
    return link;
  }
  let activeOriginal = null;
  function viewOriginal(file) {
    activeOriginal?.close();
    const viewer = openMaterialPreview(file, { title: originalName(file), download: downloadLink(file),
      onClose: () => { if (activeOriginal === viewer) activeOriginal = null; } });
    activeOriginal = viewer;
  }
  function originalRow(file, index) {
    return h('li', {},
    h('span', { class: 'material-file-list__name', title: originalName(file), text: `${index + 1}. ${originalName(file)} · ${MATERIAL_KINDS[file.kind] || '原材料'}${withPreview ? bundle.sources[index].startPage > 0 ? ` · 合并页码 ${bundle.sources[index].startPage}–${bundle.sources[index].endPage}` : ' · Word 原件，请下载核对' : ''}` }),
    h('div', { class: 'row-2 row-wrap' }, button({ label: '查看原件', size: 'sm', variant: 'ghost', onClick: () => viewOriginal(file) }),
      downloadLink(file)));
  }
  const renderOriginals = () => request && originalsFirst
    ? h('div', { class: 'stack-4 material-grouped-originals' }, ...reimbursementMaterialGroups(request).map(group => h('section', { class: 'stack-2 material-expense-group' },
      h('h4', { class: 't-h4', text: `${group.label}${Number.isInteger(group.amountCents) ? ` · ${reimbursementAmount(group.amountCents)}` : ''}` }),
      group.kind === 'common' ? h('p', { class: 't-caption', text: '共用材料单独保留，不重复计入各支出项目。' }) : null,
      group.kind === 'unassigned' ? notice('缺少可靠关联，请核查或退回补充。', { tone: 'warning' }) : null,
      group.files.length ? h('ul', { class: 'material-file-list' }, ...group.files.map(file => originalRow(bundle.originalUrls[file.index], file.index)))
        : h('p', { class: 't-caption', text: '此项目未关联材料，请核对是否需要补充。' }))))
    : h('ul', { class: 'material-file-list' }, ...bundle.originalUrls.map(originalRow));
  const originals = h('div', {}, renderOriginals());
  if (!withPreview) {
    const node = h('section', { class: 'stack-3 material-bundle' },
      h('h3', { class: 't-h4', text: `已上传材料（${bundle.originalUrls.length} 份）` }), originals, downloadStatus);
    node.dispose = () => activeOriginal?.close();
    return node;
  }
  const initial = checks?.ensure(bundle);
  let latestState = initial;
  const preview = originalsFirst && !mergedFirst ? null : bundle.mergedUrl ? pdfPreview(bundle.mergedUrl)
    : h('p', { class: 't-secondary', text: '本申请只有 Word 材料，请下载原件核对。' });
  const summary = h('p', { class: 't-secondary', aria: { live: 'polite' } });
  const results = h('div', { class: 'stack-3 material-analysis-results' });
  const expandedChecks = new Set();
  function checkBadge(label, state, message) {
    return h('span', { class: ['material-verification-badge', `is-${state}`], title: message },
      icon(state === 'matched' ? 'check' : state === 'not-applicable' ? 'minus' : state === 'pending' ? 'clock' : 'close', 'ico ico--sm'), h('span', { text: label }));
  }
  function update(state) {
    latestState = state;
    summary.textContent = !state || !state.pageCount || !state.complete || state.errors.length ? invoiceCheckSummary(state) : '';
    summary.hidden = !summary.textContent;
    const analyses = state?.analyses || [];
    const numberCounts = new Map();
    for (const source of bundle.sources.filter(source => source.kind !== 'supporting')) {
      const numbers = new Set(analyses.filter(result => result.page >= source.startPage && result.page <= source.endPage)
        .map(result => result.invoice?.fields?.invoiceNumber).filter(field => field?.state === 'extracted').map(field => field.value));
      for (const number of numbers) numberCounts.set(number, (numberCounts.get(number) || 0) + 1);
    }
    const pages = invoicePages(bundle).map(page => {
      const source = bundle.sources.find(source => page >= source.startPage && page <= source.endPage);
      const check = source?.checks?.find(check => check.page === page - source.startPage + 1);
      const result = analyses.find(result => result.page === page) || { page, buyer: check || { state: 'unknown' },
        seal: { state: 'waiting', regions: [], message: '正在等待图像检查' }, invoice: check?.invoice };
      return { source, result, node: h('section', { class: 'material-invoice-fields', aria: { label: '六项发票信息' } },
          h('h4', { class: 't-h4', text: `第 ${originalsFirst ? result.sourcePage || result.page - source.startPage + 1 : result.page} 页 · ${currentMaterialName(source?.name || result.sourceName || '发票', source?.kind)}` }),
          h('p', { class: 't-caption', text: result.buyer?.message || '抬头需人工核对' }),
          h('p', { class: 't-caption', text: result.seal?.message || '红章需人工核对' }),
          definitionList(Object.entries(INVOICE_FIELD_LABELS).map(([key, label]) => {
          const field = result.invoice?.fields?.[key];
          return [label, field?.state === 'extracted' ? field.value : field?.state === 'conflict' ? '有多个候选值，请核对原件'
            : result.seal?.state === 'waiting' ? '正在识别，请稍候' : '未可靠识别，请核对原件'];
          }))),
        evidence: h('div', { class: 'stack-2' },
          ...(result.invoice ? Object.values(result.invoice.fields).filter(field => field.evidence).map(field => h('p', { class: 't-caption', text: `${field.label} · ${field.method === 'pdf-text' ? 'PDF 文字层' : '本地 OCR'}：${field.evidence}` })) : []),
          result.textSnippet ? h('pre', { class: 'material-ocr-text', text: result.textSnippet }) : null) };
    });
    const groups = reimbursementCrossChecks(request, bundle, analyses);
    const rows = groups.length ? groups.map(group => ({ ...group, invoicePages: pages.filter(entry => request.materialRulesVersion === 1 && request.singleOrderConfirmed
      || entry.source?.expenseItemId === group.expenseItemId) }))
      : pages.map((entry, index) => ({ label: currentMaterialName(entry.source?.name || '发票', entry.source?.kind), expenseItemId: `page-${index}`, invoicePages: [entry] }));
    results.replaceChildren(...rows.map(group => {
      const invoices = group.invoicePages.map(entry => entry.result);
      const waiting = invoices.some(result => result.seal?.state === 'waiting');
      const titleState = invoices.length && invoices.every(result => result.buyer?.state === 'matched') ? 'matched'
        : invoices.some(result => result.buyer?.state === 'different') ? 'different' : waiting ? 'pending' : 'unknown';
      const sealState = invoices.length && invoices.every(result => result.seal?.state === 'candidate') ? 'matched' : waiting ? 'pending' : 'unknown';
      const amountState = group.amount?.state === 'unknown' && !state?.complete ? 'pending' : group.amount?.state || 'unknown';
      const nameState = group.name?.state === 'unknown' && !state?.complete ? 'pending' : group.name?.state || 'unknown';
      const duplicate = invoices.some(result => numberCounts.get(result.invoice?.fields?.invoiceNumber?.value) > 1);
      const details = h('details', { class: 'material-recognition-details', open: expandedChecks.has(group.expenseItemId) },
        h('summary', { class: 't-caption', text: '查看识别详情' }),
        group.amount ? h('section', { class: 'stack-3 material-cross-check-details' }, h('h4', { class: 't-h4', text: '跨材料核对依据' }),
          definitionList([['填写物资名', group.label], ['订单物资名', group.names.join('；') || '未可靠识别'],
            ['申报金额', reimbursementAmount(group.amountCents)],
            ['发票合计', Number.isSafeInteger(group.invoiceCents) ? reimbursementAmount(group.invoiceCents) : '未可靠识别'],
            ['实付款金额', Number.isSafeInteger(group.paymentCents) ? reimbursementAmount(group.paymentCents) : '未可靠识别'],
            ['取较低值', Number.isSafeInteger(group.referenceCents) ? reimbursementAmount(group.referenceCents) : '待核对']]),
          h('p', { class: 't-caption', text: group.amount.message }), h('p', { class: 't-caption', text: group.name.message }),
          ...group.evidence.map(entry => h('section', { class: 'stack-2' }, h('b', { text: `${entry.name} · ${entry.materialType || '发票'}` }),
            entry.fields.length ? entry.fields.map(field => h('p', { class: 't-caption', text: `${field.state === 'extracted' ? field.value : '未可靠识别'} · ${field.evidence || '未定位到明确字段'}` }))
              : h('p', { class: 't-caption', text: '尚无可靠识别结果，请查看原件。' })))) : null,
        ...group.invoicePages.flatMap(entry => [entry.node, entry.evidence]));
      details.addEventListener('toggle', () => { if (details.isConnected) { if (details.open) expandedChecks.add(group.expenseItemId); else expandedChecks.delete(group.expenseItemId); } });
      return h('article', { class: 'material-analysis-page material-verification-item' },
        h('b', { class: 'material-verification-item__name', text: group.label }),
        h('div', { class: 'material-verification-badges' },
          checkBadge(titleState === 'matched' ? '抬头正确' : titleState === 'pending' ? '抬头核验中' : '抬头待核对', titleState, '购买方抬头应为南京大学'),
          checkBadge(sealState === 'matched' ? '疑似红章已检出' : sealState === 'pending' ? '红章核验中' : '红章待核对', sealState, '检测结果不能证明印章真实性'),
          checkBadge(!duplicate && amountState === 'matched' ? group.amountScope === 'order' ? '订单总额正确' : '金额正确' : !duplicate && amountState === 'pending' ? '金额核验中' : '金额待核对', duplicate ? 'different' : amountState, group.amount?.message || '缺少可靠关联信息'),
          checkBadge(nameState === 'matched' ? '物资名正确' : nameState === 'not-applicable' ? '本类别无需物资名核验' : nameState === 'pending' ? '物资名核验中' : '物资名待核对', nameState, group.name?.message || '缺少可靠关联信息')),
        group.amountScope === 'order' ? h('p', { class: 't-caption', text: '已按整单合计核验，各物品的金额分摊仍须人工确认。' }) : null,
        duplicate ? notice('发票号码重复，请核对是否重复上传。', { tone: 'error' }) : null,
        details);
    }), ...materialAnalysisFeedback(bundle, state).map(entry => {
      const message = notice(entry.message, { tone: 'error' });
      message.classList.add('material-analysis-feedback');
      return message;
    }));
  }
  update(initial);
  const unsubscribe = checks?.subscribe((id, state) => { if (id === bundle.id) update(state); });
  const header = h('div', { class: 'material-bundle-head' },
      h('p', { class: 't-secondary', text: originalsFirst ? `${bundle.sources.length} 份原材料 · 第 ${request?.revision || 1} 版`
        : `${bundle.sources.length} 份原材料 · 合并后 ${bundle.pageCount} 页` }),
      (!originalsFirst || mergedFirst) && bundle.mergedUrl ? downloadLink({ name: bundle.mergedName || '报销材料合并.pdf', url: bundle.mergedUrl,
        kind: bundle.sources.length === 1 ? bundle.sources[0].kind : null }, '下载合并 PDF', 'secondary') : null);
  const analysis = h('section', { class: 'stack-3 material-analysis' },
      h('h3', { class: 't-h4', text: '报销材料提取' }), summary,
      results);
  const originalSection = h('section', { class: 'stack-3 material-originals' }, h('h3', { class: 't-h4', text: `原始材料（${bundle.sources.length} 份）` }),
      bundle.sources.some(source => !source.startPage) ? h('p', { class: 't-caption', text: 'Word 材料保留原件，不包含在合并 PDF 中，请分别下载核对。' }) : null, originals, downloadStatus);
  const node = h('div', { class: 'stack-4 material-bundle' }, header,
    ...(mergedFirst ? [preview, analysis, originalSection] : originalsFirst ? [analysis, originalSection] : [analysis, originalSection, preview]));
  node.dispose = () => { unsubscribe?.(); preview?.dispose?.(); activeOriginal?.close(); };
  node.refreshRequest = () => { update(latestState); originals.replaceChildren(renderOriginals()); };
  return node;
}

export function requestInfo(item) {
  function editsDetail(changes) {
    if (!changes) return null;
    const rows = [['activityNameSnapshot', '活动名称'], ['activityId', '关联活动'], ['amountCents', '报销金额'],
      ['purpose', '事由'], ['expenseDate', '活动日期'], ['voucherNote', '特殊情况说明'], ['initialAssignment', '校区'], ['expenseItems', '物品及用途']];
    const format = (key, value) => key === 'amountCents' ? reimbursementAmount(value)
      : key === 'initialAssignment' ? value?.campus || '未填写'
        : key === 'expenseItems' ? (value || []).map(row => `${row.category ? `${row.category} · ` : ''}${row.label} · ${reimbursementAmount(row.amountCents)}${row.railJourney ? ` · ${row.railJourney.fromStation}-${row.railJourney.toStation}（${row.railJourney.journey}）` : ''}${row.note ? ` · ${row.note}` : ''}`).join('；') : value || '未填写';
    return h('details', {}, h('summary', { text: '查看审核修改记录' }), definitionList(rows.filter(([key]) => JSON.stringify(changes.before[key]) !== JSON.stringify(changes.after[key]))
      .map(([key, label]) => [label, `${format(key, changes.before[key])} → ${format(key, changes.after[key])}`])));
  }
  const actions = { submit: '提交申请', resubmit: '补充后重新提交', approve: '原一级审核通过', return: '退回补充',
    'initial-approve': '初审通过并送复审', 'initial-return': '初审退回申请人补充',
    'final-approve': '复审通过／待打款', 'final-return': '复审退回初审', 'payment-recorded': '登记已打款',
    'finance-item-moved': '调整条目所属活动', 'finance-request-edited': '终审修改申请信息', 'finance-item-paid': '登记条目已打款' };
  return h('div', { class: 'stack-4' }, definitionList([
    ['申请编号', item.code], ['申请人', item.name], ['报销金额', reimbursementAmount(item.amountCents)],
    ['事由', item.purpose], ['状态', item.statusLabel], ['材料版本', `第 ${item.revision} 版`],
    ...(item.initialAssignment ? [['活动举办校区', item.initialAssignment.campus], ['初审人', item.initialAssignment.name]] : []),
    ['关联活动', item.activityName || (item.activityId ? '已关联活动' : '未关联')], ['活动日期', item.expenseDate || '未填写'], ['特殊情况说明', item.voucherNote || '未填写'],
    ...(item.paymentRecord ? [['实际打款日期', item.paymentRecord.paidDate], ['登记打款金额', reimbursementAmount(item.paymentRecord.amountCents)],
      ['打款登记人员', item.paymentRecord.actor], ['打款凭证编号', item.paymentRecord.reference || '未填写']] : []),
  ]), item.expenseItems?.length ? h('section', { class: 'stack-2' }, h('h3', { class: 't-h4', text: '逐项支出' }),
    ...item.expenseItems.map(row => h('p', { class: 't-secondary', text: `${row.category ? `${row.category} · ` : ''}${row.label} · ${reimbursementAmount(row.amountCents)}${row.note ? ` · ${row.note}` : ''}` }))) : null,
    h('details', { class: 'material-finance-history' }, h('summary', { text: '提交与审核记录' }),
    ...item.history.map(event => h('div', { class: 'stack-2' }, h('p', { class: 't-caption', text: `${fmt.dateTime(event.at)} · ${actions[event.action] || event.action} · ${event.actor || '未记录操作人'} · 第 ${event.revision} 版${event.note ? ` · ${event.note}` : ''}` }), editsDetail(event.changes)))));
}
