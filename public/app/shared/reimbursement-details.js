import { h } from '../core/dom.js';
import { button, definitionList, notice } from '../ui/primitives.js';
import { reimbursementAmount } from './reimbursements-api.js';
import { invoiceCheckSummary } from './invoice-checks.js';
import { pdfPreview } from './pdf-preview.js';
import * as fmt from '../core/format.js';
import { MATERIAL_KINDS, INVOICE_FIELD_LABELS, invoicePages, currentMaterialName, requestMaterialFilename, materialExtension } from './reimbursement-files.js';
import { reimbursementMaterialGroups } from './reimbursement-groups.js';

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
  const originalPreviewTitle = h('h3', { class: 't-h4' });
  const originalPreviewBody = h('div');
  const originalPreview = h('section', { class: 'stack-3 material-original-preview' }, originalPreviewTitle, originalPreviewBody);
  function viewOriginal(file) {
    activeOriginal?.dispose?.();
    originalPreviewTitle.textContent = `原件预览 · ${originalName(file)}`;
    const extension = materialExtension(file.originalName || file.name);
    activeOriginal = extension === 'pdf' ? pdfPreview(file.url)
      : ['png', 'jpg', 'jpeg'].includes(extension) ? h('img', { class: 'material-original-image', src: file.url, alt: file.originalName || file.name })
        : notice('Word 材料保留原件，请下载后核对。', { tone: 'neutral' });
    originalPreviewBody.replaceChildren(activeOriginal);
  }
  function originalRow(file, index) {
    return h('li', {},
    h('span', { class: 'material-file-list__name', text: `${index + 1}. ${originalName(file)} · ${MATERIAL_KINDS[file.kind] || '原材料'}${withPreview ? bundle.sources[index].startPage > 0 ? ` · 合并页码 ${bundle.sources[index].startPage}–${bundle.sources[index].endPage}` : ' · Word 原件，请下载核对' : ''}` },
      file.originalName && file.originalName !== file.name ? h('small', { class: 't-caption', text: `原文件：${file.originalName}` }) : null),
    h('div', { class: 'row-2 row-wrap' }, originalsFirst ? button({ label: '查看原件', size: 'sm', variant: 'ghost', onClick: () => viewOriginal(file) }) : null,
      downloadLink(file)));
  }
  const originals = request && originalsFirst
    ? h('div', { class: 'stack-4 material-grouped-originals' }, ...reimbursementMaterialGroups(request).map(group => h('section', { class: 'stack-2 material-expense-group' },
      h('h4', { class: 't-h4', text: `${group.label}${Number.isInteger(group.amountCents) ? ` · ${reimbursementAmount(group.amountCents)}` : ''}` }),
      group.kind === 'common' ? h('p', { class: 't-caption', text: '共用材料单独保留，不重复计入各支出项目。' }) : null,
      group.kind === 'unassigned' ? notice('缺少可靠关联，请核查或退回补充。', { tone: 'warning' }) : null,
      group.files.length ? h('ul', { class: 'material-file-list' }, ...group.files.map(file => originalRow(bundle.originalUrls[file.index], file.index)))
        : h('p', { class: 't-caption', text: '此项目未关联材料，请核对是否需要补充。' }))))
    : h('ul', { class: 'material-file-list' }, ...bundle.originalUrls.map(originalRow));
  if (!withPreview) {
    const node = h('section', { class: 'stack-3 material-bundle' },
      h('h3', { class: 't-h4', text: `已上传材料（${bundle.originalUrls.length} 份）` }), originals, downloadStatus);
    node.dispose = () => {};
    return node;
  }
  const initial = checks?.ensure(bundle);
  if (originalsFirst && bundle.originalUrls.length) viewOriginal(bundle.originalUrls.find(file => file.kind === 'invoice') || bundle.originalUrls[0]);
  const preview = originalsFirst && !mergedFirst ? originalPreview : bundle.mergedUrl ? pdfPreview(bundle.mergedUrl)
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
        h('b', { text: `第 ${originalsFirst ? result.sourcePage || result.page - source.startPage + 1 : result.page} 页 · ${currentMaterialName(source?.name || result.sourceName || '发票', source?.kind)}` }),
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
  const header = h('div', { class: 'material-bundle-head' },
      h('p', { class: 't-secondary', text: originalsFirst ? `${bundle.sources.length} 份原材料 · 第 ${request?.revision || 1} 版`
        : `${bundle.sources.length} 份原材料 · 合并后 ${bundle.pageCount} 页` }),
      (!originalsFirst || mergedFirst) && bundle.mergedUrl ? downloadLink({ name: bundle.mergedName || '报销材料合并.pdf', url: bundle.mergedUrl,
        kind: bundle.sources.length === 1 ? bundle.sources[0].kind : null }, '下载合并 PDF', 'secondary') : null);
  const analysis = h('section', { class: 'stack-3 material-analysis' },
      h('h3', { class: 't-h4', text: '发票信息提取' }), summary,
      results);
  const originalSection = h('section', { class: 'stack-3 material-originals' }, h('h3', { class: 't-h4', text: `原始材料（${bundle.sources.length} 份）` }),
      bundle.sources.some(source => !source.startPage) ? h('p', { class: 't-caption', text: 'Word 材料保留原件，不包含在合并 PDF 中，请分别下载核对。' }) : null, originals, downloadStatus);
  const node = h('div', { class: 'stack-4 material-bundle' }, header,
    ...(mergedFirst ? [preview, analysis, h('details', { class: 'material-originals' }, h('summary', { text: '查看原始材料' }), originalSection, originalPreview)] : originalsFirst ? [originalSection, preview, analysis] : [analysis, originalSection, preview]));
  node.dispose = () => { unsubscribe?.(); preview.dispose?.(); activeOriginal?.dispose?.(); };
  return node;
}

export function requestInfo(item) {
  const actions = { submit: '提交申请', resubmit: '补充后重新提交', approve: '原一级审核通过', return: '退回补充',
    'initial-approve': '初审通过并送复审', 'initial-return': '初审退回申请人补充',
    'final-approve': '复审通过／待打款', 'final-return': '复审退回初审', 'payment-recorded': '登记已打款' };
  return h('div', { class: 'stack-4' }, definitionList([
    ['申请编号', item.code], ['申请人', item.name], ['报销金额', reimbursementAmount(item.amountCents)],
    ...(item.bankAccount ? [['银行卡号', item.bankAccount]] : []),
    ['事由', item.purpose], ['状态', item.statusLabel], ['材料版本', `第 ${item.revision} 版`],
    ...(item.initialAssignment ? [['活动举办校区', item.initialAssignment.campus], ['初审人', item.initialAssignment.name]] : []),
    ...(item.notificationStatuses?.length ? [['邮件通知', item.notificationStatuses.map(entry => `${entry.stage === 'initial' ? '初审' : '终审'}：${({ queued: '待发送', sending: '发送处理中', sent: '发信服务器已接收', 'waiting-configuration': '待配置收件人', 'needs-attention': '需核查发送结果', cancelled: '旧版通知已取消' })[entry.status] || entry.status}`).join('；')]] : []),
    ['关联活动', item.activityName || (item.activityId ? '已关联活动' : '未关联')], ['费用发生日期', item.expenseDate || '未填写'], ['凭证说明', item.voucherNote || '未填写'],
    ...(item.paymentRecord ? [['实际打款日期', item.paymentRecord.paidDate], ['登记打款金额', reimbursementAmount(item.paymentRecord.amountCents)],
      ['打款登记人员', item.paymentRecord.actor], ['打款凭证编号', item.paymentRecord.reference || '未填写']] : []),
  ]), item.expenseItems?.length ? h('section', { class: 'stack-2' }, h('h3', { class: 't-h4', text: '逐项支出' }),
    ...item.expenseItems.map(row => h('p', { class: 't-secondary', text: `${row.category ? `${row.category} · ` : ''}${row.label} · ${reimbursementAmount(row.amountCents)}${row.note ? ` · ${row.note}` : ''}` }))) : null,
    h('details', { class: 'material-finance-history' }, h('summary', { text: '提交与审核记录' }),
    ...item.history.map(event => h('p', { class: 't-caption', text: `${fmt.dateTime(event.at)} · ${actions[event.action] || event.action} · ${event.actor || '未记录操作人'} · 第 ${event.revision} 版${event.note ? ` · ${event.note}` : ''}` }))));
}
