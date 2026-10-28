export async function checkReturnFeedback() {
  const { refreshSession } = await import('/app/core/api.js');
  const { default: reimbursementsPage } = await import('/app/console/pages/reimbursements.js');
  const passed = [];
  const check = (value, message) => { if (!value) throw Error(message); passed.push(message); };
  const until = async (predicate, message) => {
    const deadline = Date.now() + 15000;
    while (!predicate()) { if (Date.now() > deadline) throw Error(message); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  const findButton = (node, label) => [...node.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label);
  await refreshSession();
  const root = document.getElementById('root'); root.replaceChildren();
  const view = await reimbursementsPage(); root.append(view.node);
  try {
    await until(() => findButton(root, '初审材料'), '未加载合成初审申请');
    findButton(root, '初审材料').click();
    const drawer = document.querySelector('.drawer,.sheet');
    const note = drawer.querySelector('[name="reviewNote"]'), back = findButton(drawer, '退回申请人补充');
    const popup = drawer.querySelector('.material-return-feedback');
    check(popup.hidden, '未操作时不显示空意见提示');
    back.click();
    check(!popup.hidden && popup.textContent === '请先填写审核意见后退回', '空意见退回时显示明确红框提示');
    check(popup.getAttribute('role') === 'alert', '提示可由辅助工具立即读出');
    check(note.getAttribute('aria-invalid') === 'true' && document.activeElement === note, '保留字段错误并聚焦审核意见');
    check(!document.querySelector('.modal'), '空意见不进入确认退回弹窗');
    const bounds = popup.getBoundingClientRect(), buttonBounds = back.getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1, '红框在屏幕范围内完整显示');
    check(bounds.bottom <= buttonBounds.top && buttonBounds.top - bounds.bottom <= 20, '红框紧邻退回按钮上方');
    const color = getComputedStyle(popup.querySelector('.notice')).color.match(/[\d.]+/g).map(Number);
    check(color[0] > color[1] * 1.4 && color[0] > color[2] * 1.4, '提示文字为醒目的红色');
    note.value = '   '; note.dispatchEvent(new Event('input', { bubbles: true })); back.click();
    check(!popup.hidden && !document.querySelector('.modal'), '只填空格仍禁止退回');
    note.value = '请补充清晰的付款截图'; note.dispatchEvent(new Event('input', { bubbles: true }));
    check(popup.hidden, '填写有效意见后红框自动消失');
    back.click(); await until(() => findButton(document, '确认退回'), '有效意见未进入确认退回');
    check(popup.hidden && note.disabled, '确认期间隐藏错误并锁定审核意见');
    const modal = document.querySelector('.modal'); findButton(modal, '取消').click();
    await until(() => !note.disabled, '取消退回后未恢复编辑');
    check(note.value === '请补充清晰的付款截图', '取消确认后保留已填写意见');
    const data = await (await fetch('/api/reimbursements')).json();
    check(data.requests.every(item => item.status === 'pending'), '未确认操作不改变申请状态');
    check(data.requests.every(item => !item.notificationStatuses.some(job => job.stage === 'applicant-return')), '未确认操作不创建退回邮件');
    findButton(drawer, '关闭')?.click();
    return { viewport: { width: innerWidth, height: innerHeight }, passed };
  } finally { view.dispose(); root.replaceChildren(); }
}
