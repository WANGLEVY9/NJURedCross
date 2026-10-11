import { h } from '../core/dom.js';
import { button, definitionList, notice } from '../ui/primitives.js';
import { reimbursementAmount } from './reimbursements-api.js';
import { invoiceCheckSummary } from './invoice-checks.js';
import { pdfPreview } from './pdf-preview.js';
import * as fmt from '../core/format.js';
import { MATERIAL_KINDS, INVOICE_FIELD_LABELS, invoicePages, currentMaterialName } from './reimbursement-files.js';

export function bundleDetails(bundle, { withPreview = false, checks = null } = {}) {
  const downloadStatus = h('div', { aria: { live: 'polite' } });
  const supportingFiles = bundle.originalUrls.filter(file => file.kind === 'supporting');
  const originalName = file => currentMaterialName(file.name, file.kind, supportingFiles.indexOf(file));
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
  const originals = h('ul', { class: 'material-file-list' }, ...bundle.originalUrls.map((file, index) => h('li', {},
    h('span', { class: 'material-file-list__name', text: `${index + 1}. ${originalName(file)} · ${MATERIAL_KINDS[file.kind] || '原材料'}${withPreview ? bundle.sources[index].startPage > 0 ? ` · 合并页码 ${bundle.sources[index].startPage}–${bundle.sources[index].endPage}` : ' · Word 原件，请下载核对' : ''}` },
      file.originalName && file.originalName !== file.name ? h('small', { class: 't-caption', text: `原文件：${file.originalName}` }) : null),
    downloadLink(file))));
  if (!withPreview) {
    const node = h('section', { class: 'stack-3 material-bundle' },
      h('h3', { class: 't-h4', text: `已上传材料（${bundle.originalUrls.length} 份）` }), originals, downloadStatus);
    node.dispose = () => {};
    return node;
  }
  const initial = checks?.ensure(bundle);
  const preview = bundle.mergedUrl ? pdfPreview(bundle.mergedUrl)
    : h('p', { class: 't-secondary', text: '本申请只有 Word 材料，请下载原件核对。' });
  const summary = h('p', { class: 't-secondary', aria: { live: 'polite' } });
  const results = h('div', { class: 'stack-3 material-analysis-results' });
  function update(state) {
    summary.textContent = !state || !state.pageCount || !state.complete || state.errors.length ? invoiceCheckSummary(state) : '';
    summary.hidden = !summary.textContent;
    const analyses = state?.analyses || [];
    const numberCounts = new Map();
    analyses.forEach(result => { const number = result.invoice?.fields?.invoiceNumber?.value; if (number) numberCounts.set(number, (numberCounts.get(number) || 0) + 1); });
    results.replaceChildren(...invoicePages(bundle).map(page => {
      const source = bundle.sources.find(source => page >= source.startPage && page <= source.endPage);
      const check = source?.checks?.find(check => check.page === page - source.startPage + 1);
      const result = analyses.find(result => result.page === page) || { page, buyer: check || { state: 'unknown' },
        seal: { state: 'waiting', regions: [], message: '正在等待图像检查' }, invoice: check?.invoice };
      const titleResult = result.buyer.state === 'matched' ? '识别为“南京大学”'
        : result.buyer.state === 'different' ? `识别为其他购买方：“${result.buyer.name}”` : '无法判断，请人工核对';
      const sealResult = result.seal.state === 'waiting' ? '正在自动检查' : result.seal.state === 'candidate' ? '检测到疑似红章' : '未检测到红章，请人工核对';
      return h('div', { class: 'material-analysis-page' },
        h('b', { text: `第 ${result.page} 页 · ${currentMaterialName(source?.name || result.sourceName || '发票', source?.kind)}` }),
        h('div', { class: 'material-invoice-checks' }, definitionList([['购买方抬头', titleResult], ['红章', sealResult]])),
        h('section', { class: 'material-invoice-fields', aria: { label: '六项发票信息' } },
          definitionList(Object.entries(INVOICE_FIELD_LABELS).map(([key, label]) => {
          const field = result.invoice?.fields?.[key];
          return [label, field?.state === 'extracted' ? field.value : field?.state === 'conflict' ? '有多个候选值，请核对原件'
            : result.seal.state === 'waiting' ? '正在识别，请稍候' : '未可靠识别，请核对原件'];
          }))),
        numberCounts.get(result.invoice?.fields?.invoiceNumber?.value) > 1 ? notice('发票号码重复，请核对是否重复上传。', { tone: 'warning' }) : null,
        h('details', {}, h('summary', { class: 't-caption', text: '查看识别详情' }),
          h('p', { class: 't-caption', text: result.buyer.message }),
          h('p', { class: 't-caption', text: result.seal.message }),
          ...(result.invoice ? Object.values(result.invoice.fields).filter(field => field.evidence).map(field => h('p', { class: 't-caption', text: `${field.label} · ${field.method === 'pdf-text' ? 'PDF 文字层' : '本地 OCR'}：${field.evidence}` })) : []),
          result.textSnippet ? h('pre', { class: 'material-ocr-text', text: result.textSnippet }) : null));
    }), ...(state?.errors || []).map(error => notice(`第 ${error.page} 页：${error.message}`, { tone: 'warning' })));
  }
  update(initial);
  const unsubscribe = checks?.subscribe((id, state) => { if (id === bundle.id) update(state); });
  const node = h('div', { class: 'stack-4 material-bundle' },
    h('div', { class: 'material-bundle-head' },
      h('p', { class: 't-secondary', text: `${bundle.sources.length} 份原材料 · 合并后 ${bundle.pageCount} 页` }),
      bundle.mergedUrl ? downloadLink({ name: bundle.mergedName || '报销材料合并.pdf', url: bundle.mergedUrl,
        kind: bundle.sources.length === 1 ? bundle.sources[0].kind : null }, '下载合并 PDF', 'secondary') : null),
    h('section', { class: 'stack-3 material-analysis' },
      h('h3', { class: 't-h4', text: '发票信息提取' }), summary,
      results),
    h('section', { class: 'stack-3 material-originals' }, h('h3', { class: 't-h4', text: `原始材料（${bundle.sources.length} 份）` }),
      bundle.sources.some(source => !source.startPage) ? h('p', { class: 't-caption', text: 'Word 材料保留原件，不包含在合并 PDF 中，请分别下载核对。' }) : null, originals, downloadStatus),
    preview);
  node.dispose = () => { unsubscribe?.(); preview.dispose?.(); };
  return node;
}

export function requestInfo(item) {
  const actions = { submit: '提交申请', resubmit: '补充后重新提交', approve: '审核通过', return: '退回补充' };
  return h('div', { class: 'stack-4' }, definitionList([
    ['申请编号', item.code], ['申请人', item.name], ['报销金额', reimbursementAmount(item.amountCents)],
    ...(item.bankAccount ? [['银行卡号', item.bankAccount]] : []),
    ['事由', item.purpose], ['状态', item.statusLabel], ['材料版本', `第 ${item.revision} 版`],
    ['关联活动', item.activityName || (item.activityId ? '已关联活动' : '未关联')], ['费用发生日期', item.expenseDate || '未填写'], ['凭证说明', item.voucherNote || '未填写'],
  ]), item.expenseItems?.length ? h('section', { class: 'stack-2' }, h('h3', { class: 't-h4', text: '逐项支出' }),
    ...item.expenseItems.map(row => h('p', { class: 't-secondary', text: `${row.category ? `${row.category} · ` : ''}${row.label} · ${reimbursementAmount(row.amountCents)}${row.note ? ` · ${row.note}` : ''}` }))) : null,
    h('details', { class: 'material-finance-history' }, h('summary', { text: '提交与审核记录' }),
    ...item.history.map(event => h('p', { class: 't-caption', text: `${fmt.dateTime(event.at)} · ${actions[event.action]} · 第 ${event.revision} 版${event.note ? ` · ${event.note}` : ''}` }))));
}
