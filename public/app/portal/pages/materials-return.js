import { h, icon } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { button, field, notice, badge, receipt } from '../../ui/primitives.js';
import { materialServices } from '../../shared/material-services.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { reportError, notify } from '../../core/toast.js';

const labels = { pending: '待核对', approved: '已归还入账', rejected: '已退回' };
export default async function materialsReturnPage() {
  const slot = h('section', { class: 'stack-4' }), mine = h('section', { class: 'stack-3' });
  let loans = [], disposed = false, busy = false, key = crypto.randomUUID();
  const loan = field({ label: '原借用单', name: 'applicationId', required: true, searchable: true, options: [{ value: '', label: '请选择原借用单' }] });
  const quantity = field({ label: '本次归还数量', name: 'quantity', type: 'number', min: 1, step: 1, value: '1', required: true });
  const photo = field({ label: '归还照片', name: 'photo', type: 'file', required: true, hint: 'JPG、PNG 或 WebP，单张不超过 8 MB。' });
  photo.control.accept = 'image/jpeg,image/png,image/webp';
  const note = field({ label: '归还说明', name: 'note', multiline: true, rows: 2, maxlength: 500, placeholder: '例如分次归还、缺失或损坏情况，管理员会现场核对。' });
  const balance = h('p', { class: 't-caption', aria: { live: 'polite' } });
  const feedback = h('div', { aria: { live: 'polite' } });
  const submit = button({ label: '提交归还登记', variant: 'primary', onClick: save });
  const refresh = button({ label: '刷新借用与归还状态', variant: 'ghost', onClick: load });
  const controls = [loan.control, quantity.control, photo.control, note.control, submit, refresh];
  loan.control.addEventListener('change', () => {
    const selected = loans.find(item => item.id === loan.control.value);
    balance.textContent = selected ? `${selected.name} · 当前待还 ${selected.outstanding} ${selected.unit}，支持分次归还。` : '选择已出库的个人借用单。';
    quantity.control.max = selected ? String(selected.outstanding) : '';
  });
  function buildForm() {
    if (!loans.some(item => !item.pendingReturn)) {
      slot.replaceChildren(notice('暂无可登记归还的借用单。借用单须已出库，且没有待核对归还。历史借用的账号归属需由管理员核实。', { tone: 'neutral' }), refresh);
      return;
    }
    const previous = loan.control.value;
    loan.control.replaceChildren(...[{ value: '', label: '请选择原借用单' }, ...loans.filter(item => !item.pendingReturn).map(item => ({ value: item.id, label: `${item.name} · 待还 ${item.outstanding} ${item.unit} · ${item.code}` }))]
      .map(item => h('option', { value: item.value, text: item.label })));
    loan.control.value = loans.some(item => item.id === previous && !item.pendingReturn) ? previous : '';
    loan.control.dispatchEvent(new Event('change'));
    slot.replaceChildren(h('div', { class: 'fieldset' }, h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '归还信息' })),
      loan, balance, quantity, photo, note, feedback), h('div', { class: 'row-3 row-wrap' }, refresh, h('span', { class: 'spacer' }), submit));
  }
  async function load() {
    if (busy) return;
    if (!isSignedIn()) { slot.replaceChildren(loginRequiredPanel({ what: '物资归还', hint: '登录后选择属于自己的原借用单。' })); return; }
    try {
      const [eligible, history] = await Promise.all([publicApi.materialLoans(), publicApi.materialReturnsMine()]);
      if (disposed) return;
      loans = eligible.loans; buildForm();
      mine.replaceChildren(h('h2', { class: 't-h3', text: '我的归还登记' }), ...history.records.slice().reverse().map(item =>
        h('div', { class: 'panel' }, h('div', { class: 'panel__body stack-2' },
          h('div', { class: 'row-3 row-wrap' }, h('b', { text: `${item.name} · ${item.quantity} ${item.unit}` }), badge(item.syncPending ? '已记账，状态待同步' : labels[item.status], { tone: item.status === 'pending' ? 'warning' : 'neutral' })),
          h('p', { class: 't-caption', text: `${item.code} · 原借用单 ${item.applicationCode}` }),
          item.reviewNote ? h('p', { class: 't-secondary', text: `核对意见：${item.reviewNote}` }) : null,
          h('a', { class: 'btn btn--ghost', href: item.photoUrl, target: '_blank', rel: 'noopener', text: '查看归还照片' })))));
      if (!history.records.length) mine.append(h('p', { class: 't-secondary', text: '暂无归还记录。' }));
    } catch (error) {
      if (disposed || redirectIfAuthError(error)) return;
      slot.replaceChildren(notice(`归还信息未加载：${error.message}`, { tone: 'error' }), refresh);
    }
  }
  async function save() {
    if (busy) return;
    feedback.replaceChildren(); [loan, quantity, photo, note].forEach(item => item.setError(null));
    const selected = loans.find(item => item.id === loan.control.value), count = Number(quantity.control.value), image = photo.control.files[0];
    if (!selected) { loan.setError('请选择原借用单'); loan.control.focus(); return; }
    if (!Number.isSafeInteger(count) || count < 1 || count > selected.outstanding) { quantity.setError(`请填写 1 到 ${selected.outstanding} 之间的整数`); quantity.control.focus(); return; }
    if (!image || !/^image\/(jpeg|png|webp)$/.test(image.type) || image.size > 8 * 1024 * 1024) { photo.setError('请选择不超过 8 MB 的 JPG、PNG 或 WebP 照片'); photo.control.focus(); return; }
    const form = new FormData();
    form.set('applicationId', selected.id); form.set('quantity', String(count)); form.set('note', note.control.value.trim()); form.set('idempotencyKey', key); form.set('photo', image);
    busy = true; controls.forEach(control => { control.disabled = true; });
    try {
      const result = await publicApi.materialReturn(form);
      if (disposed) return;
      key = crypto.randomUUID(); photo.control.value = ''; note.control.value = '';
      notify.success('归还登记已提交', '管理员核对后才更新库存与待还数量。');
      busy = false; await load();
      slot.prepend(receipt({ title: '归还登记已提交', rows: [['登记编号', result.record.code], ['物资', `${result.record.name} · ${result.record.quantity} ${result.record.unit}`], ['状态', '待管理员核对']] }));
    } catch (error) { if (!disposed && !redirectIfAuthError(error)) reportError(error, '归还登记未提交'); }
    finally { busy = false; controls.forEach(control => { control.disabled = false; }); }
  }
  const node = h('div', { class: 'view formpage' }, materialServices('return'),
    h('header', { class: 'stack-3' }, h('a', { class: 't-caption row-2', href: '/materials' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回物资广场' })),
      h('h1', { class: 't-h1', text: '物资归还' }), h('p', { class: 't-prose', text: '关联原借用单，登记实际交回的件数与照片。提交后由管理员核对实物，再计入共用台账。' })),
    slot, mine);
  await load();
  return { title: '物资归还', node, dispose: () => { disposed = true; } };
}
