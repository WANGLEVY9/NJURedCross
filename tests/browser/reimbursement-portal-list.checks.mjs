import reimbursementsPage from '/app/portal/pages/reimbursements.js';
import { reimbursementsApi as api } from '/app/shared/reimbursements-api.js';
import { refreshSession } from '/app/core/api.js';

export async function checkPortalList(root) {
  const passed = [], check = (value, message) => { if (!value) throw Error(message); passed.push(message); };
  const until = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
    throw Error('等待用户端内容超时');
  };
  await refreshSession();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const activities = [{ id: 'suzhou', name: '苏州合成活动', date: today, campus: '苏州', category: '生命中心' },
    { id: 'nanjing', name: '南京合成活动', date: today, campus: '仙林', category: '博爱中心' },
    { id: 'uncategorized', name: '未分类合成活动', date: today, campus: '苏州', category: '' },
    { id: 'old', name: '过期合成活动', date: '2020-01-01', campus: '苏州', category: '生命中心' }];
  const item = { id: 'synthetic-returned', code: 'BX-HIDDEN-CODE', name: '合成申请人', amountCents: 2000, purpose: '合成用途',
    activityId: 'old', activityName: '过期合成活动', expenseDate: '2020-01-01', voucherNote: '特殊说明', status: 'returned',
    statusLabel: '待补充', initialAssignment: { campus: '苏州' }, expenseItems: [{ id: '1', category: '用品', label: '合成纸张', amountCents: 2000, note: '合成用途' }],
    history: [{ note: '请补充付款截图' }], bundle: { id: 'synthetic-original-bundle', originalUrls: [] } };
  const originals = { config: api.config, activities: api.activities, mine: api.mine, upload: api.upload, submit: api.submit };
  let uploads = 0, submission;
  api.config = async () => ({ materialUploads: { version: 3, supportingFormats: ['pdf', 'png'] } });
  api.activities = async () => ({ activities }); api.mine = async () => ({ requests: [item] });
  api.upload = async () => { uploads++; return { bundle: { id: 'synthetic-upload' } }; };
  api.submit = async (body, id) => { submission = { body, id }; throw Error('合成检查：内容已保留'); };
  let page;
  try {
    page = await reimbursementsPage(); root.append(page.node);
    await until(() => root.querySelector('.material-my-requests__table tbody tr'));
    const table = root.querySelector('.material-my-requests__table');
    check(table.querySelectorAll('tbody tr').length === 1 && table.querySelectorAll('tbody tr > *').length === 5, '每份申请一行、五列展示');
    check(!table.textContent.includes(item.code) && table.textContent.includes('合成纸张'), '列表以物资名开头并隐藏申请编号');
    check(table.textContent.includes('请补充付款截图'), '保留退回补充意见');
    const control = name => root.querySelector(`[name="${name}"]`);
    const choose = (name, value) => { const input = control(name); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };
    const options = name => [...control(name).options].map(option => option.value).filter(Boolean);
    check(control('reimbursementActivity').disabled && control('reimbursementActivityCategory').disabled, '未选校区前禁用下级选项');
    choose('reimbursementCampus', '苏州');
    check(options('reimbursementActivityCategory').includes('生命中心') && options('reimbursementActivityCategory').includes('未分类'), '活动类别来自校区目录，兼容未分类活动');
    choose('reimbursementActivityCategory', '生命中心');
    check(options('reimbursementActivity').join() === 'suzhou', '苏州活动不混入南京或过期活动');
    choose('reimbursementActivity', 'suzhou');
    check(control('expenseDate').value === today, '选择活动自动带出活动日期');
    // Exercise the custom searchable menu as well as its native backing control.
    const field = control('reimbursementActivity').closest('.field'); field.querySelector('.select-menu__trigger')?.click();
    const search = field.querySelector('input[type="search"]');
    if (search) { search.value = '过期'; search.dispatchEvent(new Event('input', { bubbles: true }));
      check(![...field.querySelectorAll('[role="option"]')].some(option => option.textContent.includes('过期')), '关键词搜索无法找到过期活动'); }
    field.querySelector('[popover]')?.hidePopover?.();
    choose('reimbursementCampus', '南京');
    check(!control('reimbursementActivity').value && !control('reimbursementActivityCategory').value, '切换校区清空原活动和类别');
    choose('reimbursementActivityCategory', '博爱中心');
    check(options('reimbursementActivity').join() === 'nanjing', '南京分组兼容仙林校区');
    check(root.querySelector('[name^="expenseAmount"]').closest('.field').textContent.includes('较小值'), '金额输入处保留较小值填写说明');
    [...table.querySelectorAll('button')].find(button => button.textContent === '补充后重提').click();
    check(control('reimbursementActivity').value === 'old' && control('reimbursementCampus').value === '苏州', '退回申请可保留过期原活动');
    check(control('expenseDate').value === '2020-01-01' && control('voucherNote').value === '特殊说明', '补充时还原原申请日期和说明');
    const transfer = new DataTransfer(); transfer.items.add(new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' }));
    const upload = root.querySelector('#reimbursement-invoice'); upload.files = transfer.files; upload.dispatchEvent(new Event('change', { bubbles: true }));
    [...root.querySelectorAll('button')].find(button => button.textContent === '提交补充材料').click();
    await until(() => submission);
    check(uploads === 1 && submission.id === item.id && submission.body.activityId === 'old', '补充提交使用原申请和活动，不新建申请');
    check(submission.body.expenseItems[0].amount === '20.00' && submission.body.expenseItems[0].label === '合成纸张', '补充提交保留原明细和金额');
    [...root.querySelectorAll('button')].find(button => button.textContent === '取消补充').click();
    choose('reimbursementCampus', '苏州'); choose('reimbursementActivityCategory', '生命中心');
    check(!options('reimbursementActivity').includes('old'), '退出补充后不再开放过期原活动');
    await document.fonts.ready;
    check(document.documentElement.scrollWidth <= innerWidth + 1, '窄屏仅表格内部滚动，整页无水平溢出');
    page.dispose(); root.replaceChildren();
    api.activities = async () => ({ activities: activities.map(({ id, name, date }) => ({ id, name, date })) });
    page = await reimbursementsPage(); root.append(page.node);
    await until(() => root.querySelector('.material-my-requests__table tbody tr'));
    check(control('reimbursementCampus').closest('.field').hidden && control('reimbursementActivityCategory').closest('.field').hidden,
      '旧预览未提供校区类别时保留原选择方式');
    check(options('reimbursementActivity').includes('suzhou') && options('reimbursementActivity').includes('nanjing')
      && !options('reimbursementActivity').includes('old'), '旧预览仍可选择近期活动，不开放过期活动');
    return { viewport: { width: innerWidth, height: innerHeight }, passed };
  } finally { Object.assign(api, originals); page?.dispose(); }
}
