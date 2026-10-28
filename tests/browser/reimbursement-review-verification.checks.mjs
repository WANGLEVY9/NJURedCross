export async function checkReviewVerification() {
  const { bundleDetails } = await import('/app/shared/reimbursement-details.js');
  const { openDrawer } = await import('/app/ui/overlay.js');
  const passed = [];
  function check(value, message) { if (!value) throw Error(message); passed.push(message); }
  const field = value => ({ state: 'extracted', value, evidence: `合成核验依据：${value}`, method: 'local-ocr' });
  const files = [
    { kind: 'invoice', name: 'invoice.pdf', originalName: 'invoice.pdf', expenseItemId: 'a', startPage: 1, endPage: 1, url: '/__preview-files/original.pdf' },
    { kind: 'supporting', name: 'order.png', originalName: 'order.png', expenseItemId: 'a', materialType: '订单截图', startPage: 2, endPage: 2, url: '/__preview-files/original.png' },
    { kind: 'supporting', name: 'payment.png', originalName: 'payment.png', expenseItemId: 'a', materialType: '付款截图', startPage: 3, endPage: 3, url: '/__preview-files/original.png' },
  ];
  const bundle = { id: 'synthetic-cross', sources: files, originalUrls: files, pageCount: 3 };
  const request = { name: '合成申请人', amountCents: 8000, revision: 1, expenseItems: [{ id: 'a', label: '抽纸', amountCents: 8000 }], bundle };
  const state = { pageCount: 3, complete: true, errors: [], analyses: [
    { page: 1, buyer: { state: 'matched', message: '南京大学' }, seal: { state: 'candidate', message: '疑似红章' }, invoice: { fields: { invoiceNumber: field('12345678'), totalAmount: field('100.00') } } },
    { page: 2, materialKind: 'supporting', supporting: { productName: field('活动用抽纸') } },
    { page: 3, materialKind: 'supporting', supporting: { paidAmount: field('80.00') } },
  ] };
  let listener;
  const checks = { ensure: () => state, subscribe: callback => { listener = callback; return () => {}; } };
  const detail = bundleDetails(bundle, { withPreview: true, originalsFirst: true, request, checks });
  const drawer = openDrawer({ title: '初审核验 · 合成材料', body: detail, width: 1050, onClose: () => detail.dispose() });
  await new Promise(resolve => requestAnimationFrame(resolve));
  let item = detail.querySelector('.material-verification-item');
  check(item.querySelector('b').textContent === '抽纸', '条目首行显示物资名称');
  check(item.querySelectorAll('.material-verification-badge.is-matched').length === 4, '四项核验一致时显示绿色勾');
  check(item.textContent.includes('疑似红章已检出'), '红章结果保留疑似说明');
  check(!item.querySelector('details').open, '六项发票字段与核验依据默认折叠');
  check(Math.abs(item.querySelector('details').getBoundingClientRect().height - item.querySelector('summary').getBoundingClientRect().height) <= 1, '默认不占用展开字段的页面高度');
  check(!document.querySelector('.material-preview-dialog') && !detail.querySelector('img,canvas'), '初审进入时不自动加载原件');
  const badges = item.querySelector('.material-verification-badges').getBoundingClientRect();
  check(badges.width <= item.getBoundingClientRect().width, '核验条目在当前屏宽内排列');
  const disclosure = item.querySelector('details'); disclosure.querySelector('summary').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  check(disclosure.open && item.querySelector('.material-invoice-fields').getBoundingClientRect().height > 0, '可展开查看六项发票信息');
  check(disclosure.textContent.includes('100.00') && disclosure.textContent.includes('80.00') && disclosure.textContent.includes('取较低值'), '展开后显示发票金额实付款与较低值');
  check(disclosure.textContent.includes('活动用抽纸') && disclosure.textContent.includes('填写物资名'), '展开后显示订单与申报物资名');
  state.analyses[2].supporting.paidAmount = field('70.00');
  state.analyses[1].supporting.productName = field('文件夹');
  listener(bundle.id, state); item = detail.querySelector('.material-verification-item');
  check(item.querySelectorAll('.material-verification-badge.is-different').length === 2, '金额与物资名不一致时显示红叉');
  check(item.querySelector('details').open, '识别结果刷新时保留已展开的详情');
  state.analyses[0].buyer.state = 'different'; state.analyses[0].seal.state = 'not-detected';
  listener(bundle.id, state); item = detail.querySelector('.material-verification-item');
  check(item.querySelectorAll('.material-verification-badge:not(.is-matched)').length === 4, '抬头不符和未检测到红章也醒目标红');
  state.analyses[2].supporting.paidAmount = { state: 'unknown', value: '', method: 'local-ocr' };
  listener(bundle.id, state);
  check(detail.querySelector('.material-analysis-feedback').textContent.includes('第 3 页（付款截图）：未提取到有效付款金额'), '识别无有效信息时明确提示页码材料类型及缺失字段');
  state.errors = [{ page: 2, message: '补充材料不进行发票识别，请查看原件。' }];
  listener(bundle.id, state);
  check([...detail.querySelectorAll('.material-analysis-feedback')].some(entry => entry.textContent.includes('第 2 页（订单截图）：当前识别服务尚未支持')), '服务未支持与实际提取失败使用不同提示');
  state.errors = [];
  state.analyses.pop(); listener(bundle.id, state); item = detail.querySelector('.material-verification-item');
  check([...item.querySelectorAll('.material-verification-badge.is-unknown')].some(badge => badge.textContent.includes('金额待核对')), '缺少付款识别结果不能显示金额正确');
  check(!item.textContent.includes('付款时间'), '本轮不加入付款时间核验');
  const view = [...detail.querySelectorAll('button')].find(button => button.textContent === '查看原件');
  view.click();
  check(Boolean(document.querySelector('.material-preview-dialog')), '新版核验条目保留原件弹窗');
  await drawer.close();
  await new Promise(resolve => requestAnimationFrame(resolve));
  check(!document.querySelector('.material-preview-dialog'), '关闭初审详情时清理原件弹窗');
  return { viewport: { width: innerWidth, height: innerHeight }, passed };
}
