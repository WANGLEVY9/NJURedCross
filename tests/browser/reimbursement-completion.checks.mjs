import { refreshSession } from '/app/core/api.js';
import portalPage from '/app/portal/pages/reimbursements.js';
import financePage from '/app/console/pages/reimbursement-finance.js';
import { initialReviewEditor } from '/app/console/reimbursement-initial-editor.js';
import { reimbursementsApi as api } from '/app/shared/reimbursements-api.js';
import { ACTIVITY_CATEGORY_OPTIONS } from '/app/shared/activity-taxonomy.js';

export async function checkCompletion(seed) {
  const root = document.getElementById('root'), passed = [];
  const check = (value, label) => { if (!value) throw Error(label); passed.push(label); };
  const until = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('等待界面更新超时'); };
  const control = name => document.getElementsByName(name)[0];
  const set = (name, value, event = 'input') => { const input = control(name); if (!input) throw Error(`缺少${name}`); input.value = value; input.dispatchEvent(new Event(event, { bubbles: true })); return input; };
  const button = (label, scope = document) => [...scope.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label);
  const role = async name => { await fetch(`/__completion-role/${name}`, { method: 'POST' }); await refreshSession(); };
  let view;
  const mount = async factory => { view?.dispose(); root.replaceChildren(); view = await factory(); root.append(view.node); };
  const originalUpload = api.upload, uploads = [];
  api.upload = async form => { uploads.push([...form.values()].filter(value => value instanceof File).length); return originalUpload(form); };
  try {
    await role('owner'); history.replaceState(null, '', `/__completion-suite?layout=${seed.layout}&request=${seed.returned.id}`);
    await mount(portalPage); await until(() => button('提交补充材料'));
    check(root.querySelectorAll('.material-typed-file').length === 2, '邮件链接直接打开原申请，带回两份附件');
    check((await (await fetch('/__completion-stats')).json()).originalReads === 0, '进入补充页不下载旧附件图片或PDF');
    const pdf = await (await fetch('/__completion-pdf')).arrayBuffer();
    const transfer = new DataTransfer(); transfer.items.add(new File([pdf], 'payment-new.pdf', { type: 'application/pdf' }));
    const replacement = root.querySelector('#reimbursement-supporting').closest('section').querySelector('.material-typed-file input[type=file]');
    replacement.files = transfer.files; replacement.dispatchEvent(new Event('change', { bubbles: true }));
    const materialType = root.querySelector('[name^=materialType]'); materialType.value = '付款截图'; materialType.dispatchEvent(new Event('change', { bubbles: true }));
    check(root.textContent.includes('payment-new.pdf') && root.textContent.includes('已保存原件'), '替换一份材料时保留其余原附件');
    button('提交补充材料').click();
    await until(() => root.textContent.includes('申请已进入审核队列'));
    check(uploads[0] === 1, '只上传替换文件，保留原件由服务端从Box读取');
    let item = (await api.mine()).requests.find(item => item.id === seed.returned.id);
    check(item.revision === 2 && item.bundle.sources[1].materialType === '付款截图', '补充生成新版本并保留原申请编号');
    const original = await fetch(seed.returned.bundle.originalUrls[0].url), current = await fetch(item.bundle.originalUrls[0].url);
    const a = new Uint8Array(await original.arrayBuffer()), b = new Uint8Array(await current.arrayBuffer());
    check(a.length === b.length && a.every((value, i) => value === b[i]), '保留的Box原件字节与历史原件一致');
    const session = await (await fetch('/api/auth/session')).json();
    await fetch(`/api/reimbursements/requests/${item.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': session.csrfToken, 'x-synthetic-user': 'initial-suzhou' },
      body: JSON.stringify({ action: 'initial-return', revision: item.revision, stateVersion: item.stateVersion, note: '合成：只修改说明' }) });
    history.replaceState(null, '', `/__completion-suite?layout=${seed.layout}&request=${item.id}`);
    await mount(portalPage); await until(() => button('提交补充材料')); set('voucherNote', '只修改说明，附件不变'); button('提交补充材料').click();
    await until(() => root.textContent.includes('申请已进入审核队列'));
    check(uploads[1] === 0, '只改文字时无需重新上传任何旧附件');

    history.replaceState(null, '', `/__completion-suite?layout=${seed.layout}`);
    await mount(portalPage); await until(() => control('reimbursementCampus'));
    await until(() => root.querySelector('.material-application')?.isConnected);
    set('reimbursementCampus', '苏州', 'change');
    check(ACTIVITY_CATEGORY_OPTIONS.every(category => [...control('reimbursementActivityCategory').options].some(option => option.value === category)), '财务显示活动广场全部七类，不因暂时没有活动而丢失类别');
    set('reimbursementActivityCategory', '排班专项', 'change');
    check(control('reimbursementActivity').disabled && !control('reimbursementActivity').value, '空类别不混入其他类别活动');
    set('reimbursementActivityCategory', '生命中心', 'change'); set('reimbursementActivity', seed.activityId, 'change');
    set('reimbursementPurpose', `new-${seed.layout}`);
    let category = root.querySelector('[name^=expenseCategory]'); category.value = '打车'; category.dispatchEvent(new Event('input', { bubbles: true }));
    const itemName = root.querySelector('[name^=expenseLabel]'), itemAmount = root.querySelector('[name^=expenseAmount]');
    itemName.value = '合成出行'; itemName.dispatchEvent(new Event('input', { bubbles: true })); itemAmount.value = '20.00'; itemAmount.dispatchEvent(new Event('input', { bubbles: true }));
    const invoiceTransfer = new DataTransfer(); invoiceTransfer.items.add(new File([pdf], 'train-invoice.pdf', { type: 'application/pdf' }));
    const invoice = root.querySelector('#reimbursement-invoice'); invoice.files = invoiceTransfer.files; invoice.dispatchEvent(new Event('change', { bubbles: true }));
    button('提交审核申请').click();
    check(root.querySelector('.material-submit-feedback').textContent.includes('一笔订单'), '未确认单笔订单时拦截提交');
    control('reimbursementSingleOrder').click(); button('提交审核申请').click();
    check(root.querySelector('.material-submit-feedback').textContent.includes('行程单'), '打车缺少行程单和截图时明确拦截');
    category.value = '火车票/高铁票'; category.dispatchEvent(new Event('input', { bubbles: true }));
    const rail = root.querySelector('.material-rail-journey:not([hidden])');
    set(rail.querySelector('[name$=FromStation]').name, '南京南'); set(rail.querySelector('[name$=ToStation]').name, '上海虹桥');
    set('reimbursementMeeting', 'yes', 'change'); button('提交审核申请').click();
    check(root.querySelector('.material-submit-feedback').textContent.includes('会议邀请函'), '参加会议时额外要求邀请函');
    set('reimbursementMeeting', 'no', 'change'); button('提交审核申请').click();
    await until(() => root.textContent.includes('申请已进入审核队列'));
    const fresh = (await api.mine()).requests.find(item => item.purpose === `new-${seed.layout}`);
    check(fresh.materialRulesVersion === 1 && fresh.singleOrderConfirmed && fresh.bundle.sources.length === 1, '非会议火车票仅发票即可提交并持久化规则版本');
    check(fresh.bundle.originalUrls[0].name.includes('火车票-南京南-上海虹桥（单程）') && fresh.bundle.originalUrls[0].name.includes(`new-${seed.layout}`), '火车票按站点、行程类型和用户填写事由命名');

    await role('final'); history.replaceState(null, '', `/__completion-suite?layout=${seed.layout}`); await mount(() => financePage({ view: 'items' }));
    const row = root.querySelector(`[data-finance-request="${seed.finalPending.id}"]`); check(Boolean(row), '终审工作台显示待终审条目');
    button('修改信息', row).click(); await until(() => control('initialItemCategory0'));
    set('initialItemCategory0', '打印材料'); set('initialItemName0', `终审修订-${seed.layout}`); set('initialItemUse0', '终审修订用途');
    set('initialItemAmount0', '18.00'); set('initialPurpose', '终审修订事由'); set('initialSpecialNote', '终审补充说明');
    button('保存申请修改').click(); await until(() => !document.querySelector('.material-final-editor'));
    item = (await api.requestDetails(seed.finalPending.id)).request;
    check(item.expenseItems[0].category === '打印材料' && item.amountCents === 1800 && item.purpose === '终审修订事由', '终审直接修改类别名称用途金额事由并保存');
    check(item.initialReview.actor === seed.finalPending.initialReview.actor && item.status === 'final_pending', '终审编辑保留初审结论，不自动终审通过');
    check(item.history.at(-1).changes && root.textContent.includes(`终审修订-${seed.layout}`), '修改记录持久化，工作台刷新显示修订名称');
    set('financeGroupBy', 'owner', 'change'); check(root.textContent.includes('跨活动汇总'), '可按申请人跨活动汇总');

    await role('initial-suzhou'); view.dispose(); root.replaceChildren();
    const pending = seed.pending, editor = initialReviewEditor(pending); root.append(editor.node);
    set('initialItemCategory0', '新报销类别');
    const updated = await api.review(pending.id, { action: 'initial-approve', revision: pending.revision, stateVersion: pending.stateVersion, materialsChecked: true, changes: editor.read() });
    check(updated.request.expenseItems[0].category === '新报销类别', '初审可修改旧申请的报销类别并送复审'); editor.dispose();
    check(document.documentElement.scrollWidth <= innerWidth + 1, '手机和桌面页面没有水平溢出');
    return { passed, layout: seed.layout, width: innerWidth };
  } finally { api.upload = originalUpload; view?.dispose(); }
}
