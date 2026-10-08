import { h } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { button, field, checkbox, notice, pageHead, definitionList, badge } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { materialEmpty } from '../../shared/material-ui.js';
import { asyncRegion } from '../lib.js';

const labels = { pending: '待核对', approved: '已入库', rejected: '已拒绝' };
export default async function inboundReviewPage() {
  const filter = field({ label: '登记状态', name: 'inboundReviewStatus', value: 'pending', options: [
    { value: 'pending', label: '待核对' }, { value: '', label: '全部' }, { value: 'approved', label: '已入库' }, { value: 'rejected', label: '已拒绝' }] });
  const list = h('div', { class: 'material-finance-list' });
  let records = [];
  function render() {
    const items = records.filter(item => !filter.control.value || item.status === filter.control.value);
    list.replaceChildren(...items.map(item => h('div', { class: 'material-finance-row' },
      h('div', { class: 'material-finance-row__body' }, h('div', { class: 'row-3 row-wrap' },
        h('b', { text: `${item.name} · ${item.quantity} ${item.unit}` }), badge(labels[item.status], { tone: item.status === 'pending' ? 'warning' : 'neutral' })),
      h('p', { class: 't-secondary', text: `${item.source} · ${item.location}` }), h('p', { class: 't-caption', text: item.code })),
      button({ label: item.status === 'pending' ? '核对入库' : '查看记录', variant: 'secondary', onClick: () => open(item) }))));
    if (!items.length) list.append(materialEmpty('当前没有此状态的登记', '保留此前的入库待核对记录，采购与捐赠现由管理员在出入库入口登记，核对通过后写入共用台账。', 'inbox'));
  }
  filter.control.addEventListener('change', render);
  const data = asyncRegion({ load: () => request('/api/preview/materials/inbound'), render: payload => {
    records = payload.records; render();
    return [notice('本地联调：确认实物后才登记入库。借用归还仍通过原借用单处理，存放位置的结构化资料在物资管理中维护。', { tone: 'info' }),
      h('section', { class: 'panel' }, h('div', { class: 'panel__head row-3 row-wrap' }, filter, button({ label: '刷新登记', variant: 'ghost', onClick: () => data.reload() })), h('div', { class: 'panel__body' }, list))];
  } });
  function open(item) {
    const feedback = h('div', { aria: { live: 'polite' } });
    const note = field({ label: '核对说明', name: 'inboundReviewNote', multiline: true, rows: 2, maxlength: 500, hint: '拒绝时须说明原因。' });
    const checked = checkbox({ label: '已核对实物、件数与存放位置', name: 'physicalChecked' });
    let busy = false;
    const approve = button({ label: '核对通过并入库', variant: 'primary', onClick: () => decide('approve') });
    const reject = button({ label: '拒绝登记', variant: 'secondary', onClick: () => decide('reject') });
    const drawer = openDrawer({ title: `入库登记 · ${item.code}`, width: 620, body: [definitionList([
      ['物资', item.name], ['类别码', item.assetCode], ['件数', `${item.quantity} ${item.unit}`], ['来源', item.source],
      ['存放位置', item.location], ['登记说明', item.note || '无'], ['状态', labels[item.status]], ['核对意见', item.reviewNote || '无'], ['流水编号', item.flowId || '待登记'],
    ]), item.status === 'pending' ? h('div', { class: 'stack-4' }, checked, note, feedback) : null],
      footer: item.status === 'pending' ? [reject, approve] : [], closeOnBackdrop: false });
    async function decide(action) {
      if (busy) return;
      if (action === 'approve' && !checked.control.checked) { feedback.replaceChildren(notice('请先完成实物核对并勾选确认。', { tone: 'warning' })); return; }
      if (action === 'reject' && !note.control.value.trim()) { note.setError('请说明拒绝原因'); note.control.focus(); return; }
      busy = true; [approve, reject, note.control, checked.control].forEach(control => { control.disabled = true; });
      try {
        await request(`/api/preview/materials/inbound/${encodeURIComponent(item.id)}/review`, { method: 'POST', body: {
          action, revision: item.revision, physicalChecked: checked.control.checked, note: note.control.value.trim(),
        } }); drawer.close(); await data.reload();
      } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); }
      finally { busy = false; [approve, reject, note.control, checked.control].forEach(control => { control.disabled = false; }); }
    }
  }
  return { title: '入库申请核对', node: h('div', { class: 'view wspad wspad--wide' }, materialServices('intake', { console: true }),
    pageHead({ label: '物资管理', title: '入库申请核对', description: '处理此前保留的入库待核对记录；新的采购与捐赠请使用扫码出入库入口。', actions: [button({ label: '扫码出入库', href: '/console/materials/intake', variant: 'secondary' })] }), data) };
}
