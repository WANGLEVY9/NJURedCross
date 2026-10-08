import { h } from '../core/dom.js';
import { button, definitionList, notice } from '../ui/primitives.js';
import { reimbursementAmount, reimbursementsApi } from './reimbursements-api.js';
import { pdfPreview } from './pdf-preview.js';
import * as fmt from '../core/format.js';
import { materialSection } from './material-ui.js';

export function bundleDetails(bundle, { withPreview = true } = {}) {
  let selectedPage = 1, recognizing = false, disposed = false;
  const analyses = new Map((bundle.analyses || []).map(item => [item.page, item]));
  const analysisSlot = h('div', { class: 'stack-3 material-analysis-results', aria: { live: 'polite' } });
  const analyzeButton = button({ label: '本地识别第 1 页', variant: 'secondary', onClick: analyze });
  const preview = withPreview ? pdfPreview(bundle.mergedUrl, { regions: bundle.analyses || [], onPage: page => {
    selectedPage = page; analyzeButton.querySelector('span').textContent = `本地识别第 ${page} 页`; renderAnalysis();
  } }) : null;
  function renderAnalysis() {
    const result = analyses.get(selectedPage);
    analysisSlot.replaceChildren();
    if (!result) return;
    const titleResult = result.buyer.state === 'matched' ? '是，识别为“南京大学”'
      : result.buyer.state === 'different' ? `否，识别为“${result.buyer.name}”` : '无法判断，请人工核对';
    const sealResult = result.seal.state === 'candidate' ? '检测到疑似红章' : '未检测到红章，请人工核对';
    analysisSlot.append(h('p', { class: 't-secondary', text: `第 ${result.page} 页检查结果` }),
      definitionList([['抬头是否为南京大学', titleResult], ['是否检测到红章', sealResult]]),
      h('p', { class: 't-caption', text: '识别结果供审核参考，未检测到不代表原票一定无章。' }),
      h('details', {}, h('summary', { class: 't-caption', text: '查看识别详情' }),
        h('p', { class: 't-caption', text: result.buyer.message }),
        h('p', { class: 't-caption', text: result.seal.message }),
        result.buyer.method === 'local-ocr' ? h('p', { class: 't-caption', text: `OCR 引擎评分 ${result.buyer.confidence} / 100，仅表示引擎评分，不是准确率。` }) : null,
        result.textSnippet ? h('pre', { class: 'material-ocr-text', text: result.textSnippet }) : null));
  }
  async function analyze() {
    if (recognizing) return;
    const page = selectedPage; recognizing = true; analyzeButton.disabled = true;
    analysisSlot.replaceChildren(notice(`正在本地识别第 ${page} 页，请稍候。`, { tone: 'info' }));
    try {
      const result = await reimbursementsApi.analyze(bundle.id, page);
      if (disposed) return;
      analyses.set(page, result.analysis); preview?.showRegions(page, result.analysis.seal.regions);
      renderAnalysis();
    } catch (error) { if (!disposed) analysisSlot.replaceChildren(notice(error.message, { tone: 'warning', title: '本地识别未完成' })); }
    finally { recognizing = false; analyzeButton.disabled = false; }
  }
  const checks = bundle.sources.map(source => h('div', { class: 'material-source-check' },
    h('b', { text: source.name }), ...source.checks.map(check => h('p', { class: 't-caption',
      text: `第 ${check.page} 页：${check.message}${check.textAvailable ? '' : ' 无可用文本。'}` }))));
  const node = h('div', { class: 'stack-4 material-bundle' },
    h('div', { class: 'material-bundle-head' },
      h('p', { class: 't-secondary', text: `${bundle.sources.length} 份原材料 · 合并后 ${bundle.pageCount} 页` }),
      button({ label: '下载合并 PDF', variant: 'secondary', iconName: 'download', href: bundle.mergedUrl })),
    h('details', { class: 'material-originals' }, h('summary', { text: `原始材料与合并页码（${bundle.sources.length} 份）` }),
      h('ul', { class: 'material-file-list' }, ...bundle.originalUrls.map((file, index) => h('li', {},
      h('span', { class: 'material-file-list__name', text: `${index + 1}. ${file.name} · 合并页码 ${bundle.sources[index].startPage}–${bundle.sources[index].endPage}` }),
      h('a', { class: 'btn btn--ghost btn--sm', href: file.url, download: file.name, text: '下载原件' }))))),
    preview,
    withPreview ? h('section', { class: 'stack-3 material-analysis' },
      materialSection('发票辅助检查', '检查购买方是否为南京大学、是否有疑似红章。'), analyzeButton,
      h('p', { class: 't-caption', text: '仅识别印章外观，不读取章内文字；蓝框辅助查看，结果需人工核对。' }), analysisSlot) : null,
    h('details', {}, h('summary', { class: 't-secondary', text: '发票文本检查提示' }),
      notice('以下为上传时的文字检查。扫描件可点击本地识别；红章候选、名称识别和低质量结果都需人工核对。', { tone: 'neutral' }),
      ...checks),
  );
  // PDF links should download rather than enter the SPA router.
  node.querySelector(`a[href="${bundle.mergedUrl}"]`)?.setAttribute('download', '报销材料合并.pdf');
  node.dispose = () => { disposed = true; preview?.dispose(); };
  return node;
}

export function requestInfo(item) {
  const actions = { submit: '提交申请', resubmit: '补充后重新提交', approve: '审核通过', return: '退回补充' };
  return h('div', { class: 'stack-4' }, definitionList([
    ['申请编号', item.code], ['申请人', item.name], ['报销金额', reimbursementAmount(item.amountCents)],
    ['事由', item.purpose], ['状态', item.statusLabel], ['材料版本', `第 ${item.revision} 版`],
  ]), h('details', { class: 'material-finance-history' }, h('summary', { text: '提交与审核记录' }),
    ...item.history.map(event => h('p', { class: 't-caption', text: `${fmt.dateTime(event.at)} · ${actions[event.action]} · 第 ${event.revision} 版${event.note ? ` · ${event.note}` : ''}` }))));
}
