/** The organisation's 部门 field, distinct from the account's 院系/department. */
export const MATERIAL_BORROW_DEPARTMENTS = Object.freeze([
  '主席团 & 指导组', '综事中心主任团', '生命中心主任团', '博爱中心主任团', '工作组主任团',
]);

export function materialBorrowEligibility(membership) {
  if (membership?.status !== 'verified') {
    const unavailable = membership?.status === 'unavailable';
    return { eligible: false, status: unavailable ? 'unavailable' : 'unverified', department: '',
      message: unavailable ? '暂时无法核验借用资格，请稍后重试。' : '尚未核验个人主页的部门信息，请联系管理员核对。' };
  }
  const department = typeof membership.department === 'string' ? membership.department.trim() : '';
  const eligible = MATERIAL_BORROW_DEPARTMENTS.includes(department);
  return { eligible, status: eligible ? 'eligible' : 'not-internal', department,
    message: eligible ? '已具备物资借用资格。' : '物资借用仅向指定的五类红会内部部门开放，当前部门无法申请。' };
}
