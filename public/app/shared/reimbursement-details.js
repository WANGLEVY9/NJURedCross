import { h } from '../core/dom.js';
import { button, definitionList, notice } from '../ui/primitives.js';
import { reimbursementAmount } from './reimbursements-api.js';
import { invoiceCheckSummary } from './invoice-checks.js';
import { pdfPreview } from './pdf-preview.js';
import * as fmt from '../core/format.js';
import { materialSection } from './material-ui.js';

export function bundleDetails(bundle, { withPreview = false, checks = null } = {}) {
  const originals = h('ul', { class: 'material-file-list' }, ...bundle.originalUrls.map((file, index) => h('li', {},
    h('span', { class: 'material-file-list__name', text: `${index + 1}. ${file.name}${withPreview ? ` · 合并页码 ${bundle.sources[index].startPage}–${bundle.sources[index].endPage}` : ''}` }),
    h('a', { class: 'btn btn--ghost btn--sm', href: file.url, download: file.name, text: '下载原件' }))));
  if (!withPreview) {
    const node = h('section', { class: 'stack-3 material-bundle' },
      h('h3', { class: 't-h4', text: `已上传材料（${bundle.originalUrls.length} 份）` }), originals);
    node.dispose = () => {};
    return node;
  }
  const initial = checks?.ensure(bundle);
  const preview = pdfPreview(bundle.mergedUrl, { regions: initial?.analyses || bundle.analyses || [] });
  const summary = h('p', { class: 't-secondary', aria: { live: 'polite' } });
  const results = h('div', { class: 'stack-3 material-analysis-results' });
  function update(state) {
    summary.textContent = invoiceCheckSummary(state);
    results.replaceChildren(...(state?.analyses || []).map(result => {
      preview.showRegions(result.page, result.seal.regions);
      const titleResult = result.buyer.state === 'matched' ? '识别为“南京大学”'
        : result.buyer.state === 'different' ? `识别为其他购买方：“${result.buyer.name}”` : '无法判断，请人工核对';
      const sealResult = result.seal.state === 'candidate' ? '检测到疑似红章' : '未检测到红章，请人工核对';
      return h('div', { class: 'material-analysis-page' },
        h('b', { text: `第 ${result.page} 页` }),
        definitionList([['购买方抬头', titleResult], ['红章', sealResult]]),
        h('details', {}, h('summary', { class: 't-caption', text: '查看识别详情' }),
          h('p', { class: 't-caption', text: result.buyer.message }),
          h('p', { class: 't-caption', text: result.seal.message }),
          result.textSnippet ? h('pre', { class: 'material-ocr-text', text: result.textSnippet }) : null));
    }), ...(state?.errors || []).map(error => notice(`第 ${error.page} 页：${error.message}`, { tone: 'warning' })));
  }
  update(initial);
  const unsubscribe = checks?.subscribe((id, state) => { if (id === bundle.id) update(state); });
  const node = h('div', { class: 'stack-4 material-bundle' },
    h('div', { class: 'material-bundle-head' },
      h('p', { class: 't-secondary', text: `${bundle.sources.length} 份原材料 · 合并后 ${bundle.pageCount} 页` }),
      button({ label: '下载合并 PDF', variant: 'secondary', iconName: 'download', href: bundle.mergedUrl })),
    h('section', { class: 'stack-3 material-analysis' },
      materialSection('发票辅助检查', '自动逐页检查购买方是否为南京大学、是否有疑似红章。'), summary,
      h('p', { class: 't-caption', text: '结果供人工审核参考；未识别出抬头或红章不代表一定不存在。不读取章内文字，蓝框标记候选位置。' }),
      h('details', {}, h('summary', { text: '各页检查结果' }), results)),
    h('details', { class: 'material-originals' }, h('summary', { text: `原始材料与合并页码（${bundle.sources.length} 份）` }), originals),
    preview);
  node.querySelector(`a[href="${bundle.mergedUrl}"]`)?.setAttribute('download', '报销材料合并.pdf');
  node.dispose = () => { unsubscribe?.(); preview.dispose(); };
  return node;
}

export function requestInfo(item) {
  const actions = { submit: '提交申请', resubmit: '补充后重新提交', approve: '审核通过', return: '退回补充' };
  return h('div', { class: 'stack-4' }, definitionList([
    ['申请编号', item.code], ['申请人', item.name], ['报销金额', reimbursementAmount(item.amountCents)],
    ['事由', item.purpose], ['状态', item.statusLabel], ['材料版本', `第 ${item.revision} 版`],
    ['关联活动', item.activityName || (item.activityId ? '已关联活动' : '未关联')], ['费用发生日期', item.expenseDate || '未填写'], ['凭证说明', item.voucherNote || '未填写'],
  ]), item.expenseItems?.length ? h('section', { class: 'stack-2' }, h('h3', { class: 't-h4', text: '逐项支出' }),
    ...item.expenseItems.map(row => h('p', { class: 't-secondary', text: `${row.label} · ${reimbursementAmount(row.amountCents)}${row.note ? ` · ${row.note}` : ''}` }))) : null,
    h('details', { class: 'material-finance-history' }, h('summary', { text: '提交与审核记录' }),
    ...item.history.map(event => h('p', { class: 't-caption', text: `${fmt.dateTime(event.at)} · ${actions[event.action]} · 第 ${event.revision} 版${event.note ? ` · ${event.note}` : ''}` }))));
}
