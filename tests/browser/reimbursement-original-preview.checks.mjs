/** Runs in a real browser, with synthetic files served by the caller. */
export async function checkOriginalPreview() {
  const { bundleDetails } = await import('/app/shared/reimbursement-details.js');
  const { openDrawer } = await import('/app/ui/overlay.js');
  const passed = [];
  function check(value, message) {
    if (!value) throw Error(message);
    passed.push(message);
  }
  async function until(predicate, message) {
    const deadline = Date.now() + 15000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error(message);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const findButton = (node, label) => [...node.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
  const originalReads = () => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/__preview-files/original')).length;
  const files = [
    { name: '发票一.pdf', kind: 'invoice', url: '/__preview-files/original.pdf', startPage: 1, endPage: 1 },
    { name: '发票二.pdf', kind: 'invoice', url: '/__preview-files/original-second.pdf', startPage: 2, endPage: 2 },
    { name: '付款截图.png', kind: 'supporting', url: '/__preview-files/original.png', startPage: 3, endPage: 3 },
    { name: '说明.docx', kind: 'supporting', url: '/__preview-files/original.docx', startPage: 0, endPage: 0 },
  ];
  const bundle = { id: 'isolated-preview', pageCount: 3, sources: files, originalUrls: files, mergedUrl: '/__preview-files/merged.pdf' };
  const analyses = [1, 2].map(page => ({ page, buyer: { state: 'matched', message: '合成抬头检查' },
    seal: { state: 'candidate', message: '合成红章检查' }, invoice: { fields: { invoiceNumber: { state: 'extracted', value: 'SYNTHETIC-DUPLICATE' } } } }));
  const checks = { ensure: () => ({ complete: true, pageCount: 2, analyses, errors: [] }), subscribe: () => () => {} };
  const detail = bundleDetails(bundle, { withPreview: true, originalsFirst: true, checks });
  const drawer = openDrawer({ title: '合成报销审核', body: detail, width: 1050, onClose: () => detail.dispose() });
  await new Promise(resolve => requestAnimationFrame(resolve));
  check(!document.querySelector('.material-preview-dialog'), '进入详情时不弹出原件');
  check(!detail.querySelector('img, canvas, .material-original-preview'), '详情中不嵌入原件预览');
  check(originalReads() === 0, '未点击时不请求原始材料');
  const warning = detail.querySelector('.material-analysis-page > .notice--error');
  const color = getComputedStyle(warning).color.match(/[\d.]+/g).map(Number);
  check(color[0] > color[1] * 1.4 && color[0] > color[2] * 1.4, '重复发票提示文字为红色');
  check(warning.nextElementSibling.getBoundingClientRect().top - warning.getBoundingClientRect().bottom >= 10, '重复提示与识别详情留有间距');
  check(detail.querySelectorAll('button').length === files.length, '每份原始材料均可点击查看');
  const viewButtons = [...detail.querySelectorAll('button')];
  viewButtons[2].focus(); viewButtons[2].click();
  let dialog = document.querySelector('.material-preview-dialog');
  check(dialog?.getAttribute('role') === 'dialog' && dialog.getAttribute('aria-modal') === 'true', '原件以可访问弹窗展示');
  await until(() => dialog.querySelector('img')?.naturalWidth, '图片原件未成功显示');
  check(originalReads() === 1, '只加载点击的图片原件');
  check(drawer.scrim.inert, '预览打开时下层审核面板不可误操作');
  const rect = dialog.getBoundingClientRect();
  check(rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1, '弹窗在当前屏幕范围内');
  check(dialog.scrollWidth <= dialog.clientWidth, '预览工具栏不撑宽弹窗');
  findButton(dialog, '放大原件').click();
  check(dialog.style.getPropertyValue('--material-preview-zoom') === '1.25', '图片支持放大');
  findButton(dialog, '缩小原件').click();
  check(dialog.style.getPropertyValue('--material-preview-zoom') === '1', '图片支持缩小');
  findButton(dialog, '放大原件').click(); findButton(dialog, '恢复适应宽度').click();
  check(dialog.style.getPropertyValue('--material-preview-zoom') === '1', '支持恢复适应宽度');
  findButton(dialog, '全屏查看原件').click();
  check(dialog.classList.contains('is-fullscreen') && Math.abs(dialog.getBoundingClientRect().width - innerWidth) <= 1, '支持全屏查看');
  findButton(dialog, '退出全屏查看').click();
  const image = dialog.querySelector('img');
  findButton(dialog, '关闭原件预览').click();
  await until(() => !document.querySelector('.material-preview-dialog'), '关闭按钮未关闭预览');
  check(!image.hasAttribute('src'), '关闭图片时释放原件地址');
  check(!drawer.scrim.inert && document.activeElement === viewButtons[2], '关闭后恢复审核面板与原按钮焦点');
  viewButtons[0].click(); dialog = document.querySelector('.material-preview-dialog');
  await until(() => dialog.querySelector('canvas:not([hidden])'), 'PDF 原件未成功显示');
  findButton(dialog, '放大原件').click();
  check(dialog.style.getPropertyValue('--material-preview-zoom') === '1.25', 'PDF 支持放大');
  const canvas = dialog.querySelector('canvas');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => !document.querySelector('.material-preview-dialog'), 'Esc 未关闭预览');
  check(canvas.width === 0 && canvas.height === 0, '关闭 PDF 时释放画布内存');
  check(document.contains(drawer.surface), 'Esc 只关闭最上层原件预览');
  viewButtons[3].click(); dialog = document.querySelector('.material-preview-dialog');
  check(dialog.textContent.includes('Word 材料请下载原件后核对'), 'Word 原件提供下载提示');
  check(!dialog.querySelector('img, canvas') && originalReads() === 2, 'Word 原件不被预加载');
  dialog.parentElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await until(() => !document.querySelector('.material-preview-dialog'), '点击遮罩未关闭预览');
  viewButtons[0].click();
  await drawer.close();
  await until(() => !document.querySelector('.material-preview-dialog'), '关闭审核面板未清理原件弹窗');
  check(!document.documentElement.style.overflow, '关闭所有面板后恢复页面滚动');
  const simple = bundleDetails(bundle);
  document.getElementById('root').append(simple);
  findButton(simple, '查看原件').click();
  check(Boolean(document.querySelector('.material-preview-dialog')), '用户已上传材料也可按需预览');
  simple.dispose(); simple.remove();
  await until(() => !document.querySelector('.material-preview-dialog'), '用户材料卸载未清理弹窗');
  const merged = bundleDetails(bundle, { withPreview: true, originalsFirst: true, mergedFirst: true, checks });
  document.getElementById('root').append(merged);
  await until(() => merged.querySelector('.material-pdf canvas:not([hidden])'), '原有合并 PDF 审核预览未保留');
  check(merged.querySelectorAll('.material-originals button').length === files.length, '合并材料下方直接展示原件列表');
  merged.dispose(); merged.remove();
  return { viewport: { width: innerWidth, height: innerHeight }, passed };
}
