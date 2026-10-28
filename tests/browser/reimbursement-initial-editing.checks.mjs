export async function checkInitialEditing() {
  const { refreshSession } = await import('/app/core/api.js');
  const { default: portalPage } = await import('/app/portal/pages/reimbursements.js');
  const { default: consolePage } = await import('/app/console/pages/reimbursements.js');
  const passed = [], root = document.getElementById('root'), layout = new URL(location.href).searchParams.get('layout') || 'desktop';
  const check = (value, message) => { if (!value) throw Error(message); passed.push(message); };
  const until = async (predicate, message) => { const deadline = Date.now() + 15000; while (!predicate()) {
    if (Date.now() > deadline) throw Error(message); await new Promise(resolve => setTimeout(resolve, 40));
  } };
  const button = (node, label) => [...node.querySelectorAll('button')].find(control => control.textContent === label || control.getAttribute('aria-label') === label);
  const set = (name, value, type = 'input') => { const control = document.querySelector(`[name="${name}"]`); control.value = value; control.dispatchEvent(new Event(type, { bubbles: true })); return control; };
  async function role(value) {
    await fetch(`/__initial-edit-role?user=${value}`); await refreshSession();
    root.className = value === 'owner' ? 'portal' : 'console'; document.documentElement.dataset.surface = value === 'owner' ? 'portal' : 'console';
    const style = document.querySelector('#qa-surface-style');
    const href = '/styles/app.css';
    if (style && new URL(style.href).pathname !== href) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('页面样式未加载')), 10000);
      style.onload = () => { clearTimeout(timer); resolve(); }; style.onerror = () => { clearTimeout(timer); reject(Error('页面样式加载失败')); }; style.href = href;
    });
  }
  await role('owner');
  const portal = await portalPage(); root.replaceChildren(portal.node);
  await until(() => root.querySelector('.material-application'), '用户表单未加载');
  check(!root.querySelector('[name="reimbursementBankAccount"]') && !root.textContent.includes('银行卡号'), '用户端不再展示或填写银行卡号');
  check(root.textContent.includes('特殊情况说明') && root.textContent.includes('活动日期'), '用户端字段名称更新');
  check(!root.textContent.includes('凭证说明') && !root.textContent.includes('费用发生日期'), '用户端移除旧名称');
  const noteHeight = root.querySelector('[name="voucherNote"]').getBoundingClientRect().height;
  check(noteHeight <= 52, '特殊情况说明使用紧凑输入高度');
  portal.dispose(); root.replaceChildren(); await role('initial-suzhou');
  const view = await consolePage(); root.append(view.node);
  try {
    await until(() => [...root.querySelectorAll('.material-finance-row')].some(row => row.textContent.includes(`隔离初审修改 ${layout}`)), '初审申请未加载');
    const row = [...root.querySelectorAll('.material-finance-row')].find(row => row.textContent.includes(`隔离初审修改 ${layout}`));
    button(row, '初审材料').click();
    const drawer = document.querySelector('.drawer,.sheet');
    await until(() => drawer.querySelector('[name="initialActivity"] option[value="synthetic-other"]'), '可编辑活动目录未加载');
    check(drawer.textContent.includes('申请编号') && drawer.textContent.includes('合成申请人') && !drawer.querySelector('[name="owner"],[name="code"],[name="applicant"]'), '申请编号与申请人只读');
    check(!drawer.textContent.includes('银行卡号') && !drawer.textContent.includes('邮件通知'), '初审详情移除银行卡和邮件状态');
    check(drawer.textContent.includes('李婉荣') && drawer.textContent.includes('通过后状态') && drawer.textContent.includes('待复审'), '初审人固定并明确通过后待复审');
    const materialRow = drawer.querySelector('.material-originals .material-file-list li');
    check(!materialRow.textContent.includes('原文件：'), '原件列表不再显示第二行原文件名');
    check(materialRow.getBoundingClientRect().height <= 64, '原件材料压缩为窄的一行');
    check(materialRow.scrollWidth <= materialRow.clientWidth + 1, '长材料名不会撑宽原件行');
    set('initialActivity', 'synthetic-other', 'change');
    set('initialActivityName', `修订活动 ${layout}`); set('initialCampus', '南京', 'change');
    set('initialItemName0', '修订物资'); set('initialItemUse0', '修订用途'); set('initialAmount', '18.50');
    set('initialPurpose', `修订事由 ${layout}`); set('initialActivityDate', '2026-10-21'); set('initialSpecialNote', '特殊情况补充');
    check(drawer.querySelector('[name="initialItemAmount0"]').value === '18.50', '单项报销金额与逐项金额同步');
    check(drawer.querySelector('.material-originals').textContent.includes('修订物资') && drawer.querySelector('.material-originals').textContent.includes('18.50'), '编辑时原件名称和金额即时更新');
    const checked = drawer.querySelector('[name="materialsChecked"]'); checked.click();
    set('initialSpecialNote', '修订后的特殊情况说明');
    check(!checked.checked, '修改申请后要求重新核对材料'); checked.click();
    const originalId = (await (await fetch('/api/reimbursements')).json()).requests.find(item => item.purpose === `隔离初审修改 ${layout}`).id;
    button(drawer, '初审通过并送复审').click(); await until(() => button(document, '确认通过'), '修改后未弹出审核确认');
    check(document.querySelector('.modal').textContent.includes('18.50'), '通过确认显示修订后的金额');
    button(document, '确认通过').click();
    await until(() => !document.querySelector('.material-initial-editor'), '修改后初审未提交成功');
    const result = await (await fetch(`/api/reimbursements/requests/${originalId}`)).json();
    const updated = result.request;
    check(updated.status === 'final_pending' && updated.statusLabel === '待复审', '保存修改后直接进入待复审');
    check(updated.amountCents === 1850 && updated.expenseItems[0].label === '修订物资' && updated.expenseItems[0].note === '修订用途', '物品用途与报销金额保存正确');
    check(updated.initialAssignment.campus === '南京' && updated.initialAssignment.key === 'initial-suzhou' && updated.initialAssignment.name === '李婉荣', '跨校区修正保留原初审归属');
    check(updated.activityName === `修订活动 ${layout}` && updated.activityId === 'synthetic-other' && updated.expenseDate === '2026-10-21', '活动名称关联和日期保存正确');
    check(updated.voucherNote === '修订后的特殊情况说明' && updated.history.at(-1).changes, '特殊情况及初审修改记录保存');
    check(document.documentElement.scrollWidth <= innerWidth + 1, '当前屏幕页面无水平溢出');
    return { viewport: { width: innerWidth, height: innerHeight }, passed };
  } finally { view.dispose(); root.replaceChildren(); }
}
