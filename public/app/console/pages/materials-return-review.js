import { h } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { button, field, checkbox, notice, pageHead, definitionList, badge } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { materialEmpty } from '../../shared/material-ui.js';
import { asyncRegion } from '../lib.js';

const labels = { pending: '待核对', approved: '已归还入账', rejected: '已退回' };
export default async function returnReviewPage() {
  const filter = field({ label: '归还状态', name: 'returnReviewStatus', searchable: true, value: 'pending', options: [
    { value: 'pending', label: '待核对' }, { value: '', label: '全部' }, { value: 'approved', label: '已归还入账' }, { value: 'rejected', label: '已退回' }] });
  const list = h('div', { class: 'material-finance-list' });
  let records = [];
  function render() {
    const items = records.filter(item => !filter.control.value || item.status === filter.control.value);
    list.replaceChildren(...items.map(item => h('div', { class: 'material-finance-row' },
      h('div', { class: 'material-finance-row__body' }, h('div', { class: 'row-3 row-wrap' },
        h('b', { text: `${item.name} · ${item.quantity} ${item.unit}` }), badge(item.syncPending ? '已记账，状态待同步' : labels[item.status], { tone: item.status === 'pending' ? 'warning' : 'neutral' })),
      h('p', { class: 't-secondary', text: `原借用单 ${item.applicationCode}` }), h('p', { class: 't-caption', text: item.code })),
      button({ label: item.status === 'pending' ? '核对归还' : '查看记录', variant: 'secondary', onClick: () => open(item) }))));
    if (!items.length) list.append(materialEmpty('当前没有此状态的归还登记', '用户提交的归还会进入此处；核对实物后，按原借用单计入共用台账。', 'inbox'));
  }
  filter.control.addEventListener('change', render);
  const data = asyncRegion({ load: () => request('/api/preview/materials/returns'), render: payload => {
    records = payload.records; render();
    return [notice('本地联调：核对归还只更新内存副本。采购和捐赠使用管理端“出入库登记”；缺失或损耗由原借用单单独处理。', { tone: 'info' }),
      h('section', { class: 'panel' }, h('div', { class: 'panel__head material-review-toolbar' }, filter, button({ label: '刷新归还', variant: 'ghost', onClick: () => data.reload() })), h('div', { class: 'panel__body' }, list))];
  } });
  function open(item) {
    const feedback = h('div', { aria: { live: 'polite' } });
    const note = field({ label: '核对说明', name: 'returnReviewNote', multiline: true, rows: 2, maxlength: 500, hint: '数量或实物不一致时，请说明原因并退回。' });
    const checked = checkbox({ label: '已核对归还实物、数量与完好情况', name: 'physicalChecked' });
    let busy = false;
    const approve = button({ label: item.syncPending ? '重试归还状态同步' : '核对通过并入账', variant: 'primary', onClick: () => decide('approve') });
    const reject = button({ label: '退回登记', variant: 'secondary', disabled: Boolean(item.flowId), onClick: () => decide('reject') });
    const image = h('img', { class: 'material-return-photo', src: item.photoUrl, alt: '申请人上传的归还照片' });
    const drawer = openDrawer({ title: `归还核对 · ${item.code}`, width: 620, body: [definitionList([
      ['物资', item.name], ['类别码', item.assetCode], ['本次归还', `${item.quantity} ${item.unit}`], ['原借用单', item.applicationCode],
      ['归还说明', item.note || '无'], ['状态', item.syncPending ? '已记账，状态待同步' : labels[item.status]], ['核对意见', item.reviewNote || '无'], ['流水编号', item.flowId || '待登记'],
    ]), image, item.status === 'pending' ? h('div', { class: 'stack-4' },
      item.syncPending ? notice('归还已计入库存，重试只补齐借用单状态，不会再次增加库存。', { tone: 'warning' }) : null, checked, note, feedback) : null],
      footer: item.status === 'pending' ? [reject, approve] : [], closeOnBackdrop: false });
    async function decide(action) {
      if (busy) return;
      if (action === 'approve' && !checked.control.checked) { feedback.replaceChildren(notice('请先完成实物核对并勾选确认。', { tone: 'warning' })); return; }
      if (action === 'reject' && !note.control.value.trim()) { note.setError('请说明退回原因'); note.control.focus(); return; }
      busy = true; [approve, reject, note.control, checked.control].forEach(control => { control.disabled = true; });
      try {
        await request(`/api/preview/materials/returns/${encodeURIComponent(item.id)}/review`, { method: 'POST', body: {
          action, revision: item.revision, physicalChecked: checked.control.checked, note: note.control.value.trim(),
        } }); drawer.close(); await data.reload();
      } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); }
      finally { busy = false; [approve, note.control, checked.control].forEach(control => { control.disabled = false; }); reject.disabled = Boolean(item.flowId); }
    }
  }
  return { title: '归还核对', node: h('div', { class: 'view wspad wspad--wide' }, materialServices('intake', { console: true }),
    pageHead({ label: '出入库登记', title: '归还核对', description: '核对用户交回的实物与照片，确认后更新库存和原借用单的待还数量。', actions: [button({ label: '返回出入库登记', href: '/console/materials/intake', variant: 'secondary' })] }), data) };
}
