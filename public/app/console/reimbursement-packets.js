import { h } from '../core/dom.js';
import { button, notice } from '../ui/primitives.js';
import { reimbursementsApi as api, reimbursementAmount } from '../shared/reimbursements-api.js';
import { pdfPreview } from '../shared/pdf-preview.js';

export function reimbursementPackets(item, checked, { canGenerate = ['pending', 'approved'].includes(item.status), autoPreview = false } = {}) {
  const feedback = h('div', { aria: { live: 'polite' } }), results = h('div', { class: 'stack-3' });
  const previewSlot = h('div');
  let disposed = false, busy = true, activePreview = null;
  const enabled = canGenerate;
  const generate = button({ label: '生成按项目合并材料', variant: 'secondary', iconName: 'file', onClick: async () => {
    if (busy || !enabled) return;
    if (!checked.checked) {
      feedback.replaceChildren(notice('请先逐份核对原材料与申请金额，并勾选确认。', { tone: 'warning' }));
      checked.focus(); return;
    }
    busy = true; generate.disabled = true;
    feedback.replaceChildren(notice('正在按项目整理材料，请稍候。', { tone: 'info' }));
    try {
      const payload = await api.generateMaterialPackets(item.id, { revision: item.revision, bundleId: item.bundle.id, materialsChecked: true });
      if (disposed) return;
      render(payload.packets);
      feedback.replaceChildren(notice('按项目材料已生成，申请审核状态保持不变。', { tone: 'success' }));
    } catch (error) { if (!disposed) feedback.replaceChildren(notice(error.message, { tone: 'error' })); }
    finally { busy = false; generate.disabled = !enabled; }
  } });
  generate.disabled = true;
  generate.hidden = !canGenerate;
  function preview(file) {
    activePreview?.dispose?.(); activePreview = pdfPreview(file.url);
    previewSlot.replaceChildren(h('h4', { class: 't-h4', text: file.name }), activePreview);
  }
  function download(file, label, variant = 'ghost') {
    const link = button({ label, variant, size: 'sm', href: file.url });
    link.setAttribute('download', file.name);
    return link;
  }
  function render(packets) {
    results.replaceChildren();
    if (!packets) { results.append(h('p', { class: 't-caption', text: '本版尚未生成按项目材料。' })); return; }
    for (const group of packets.groups) {
      const links = h('div', { class: 'row-2 row-wrap' });
      if (group.merged.url) {
        links.append(button({ label: '预览项目合并 PDF', variant: 'ghost', size: 'sm', onClick: () => preview(group.merged) }),
          download(group.merged, '下载项目合并 PDF', 'secondary'));
      }
      if (group.orderPayment.url) links.append(download(group.orderPayment, '下载订单及付款 PDF'));
      results.append(h('section', { class: 'stack-2 material-expense-group' },
        h('h4', { class: 't-h4', text: `${group.label} · ${reimbursementAmount(group.amountCents)}` }),
        group.merged.url ? h('p', { class: 't-caption', text: `${group.merged.name} · ${group.merged.pageCount} 页` })
          : h('p', { class: 't-caption', text: '本组仅含 Word 原件，请分别下载核对。' }),
        links, ...group.originalOnly.map(file => h('p', { class: 't-caption', text: `另附 Word 原件：${file.name}（未合入 PDF）` }))));
    }
    if (autoPreview && !activePreview) {
      const file = packets.groups.find(group => group.merged.url)?.merged;
      if (file) preview(file);
    }
  }
  async function load() {
    try { const payload = await api.materialPackets(item.id); if (!disposed) render(payload.packets); }
    catch (error) { if (!disposed) feedback.replaceChildren(notice(error.message, { tone: 'error' }), button({ label: '重新读取材料包', onClick: load })); }
    finally { busy = false; generate.disabled = !enabled; }
  }
  load();
  const node = h('section', { class: 'stack-3 material-item-packets' },
    h('h3', { class: 't-h4', text: '按项目合并材料' }),
    h('p', { class: 't-caption', text: canGenerate
      ? '核对原件后手动生成。每组依次为发票、订单及付款、其他材料；整份申请共用材料单独保留。'
      : '核对本版项目合并材料，可追溯下方原件；Word 材料另附原件。' }),
    generate, feedback, results, previewSlot);
  node.dispose = () => { disposed = true; activePreview?.dispose?.(); };
  return node;
}
