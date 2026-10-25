/** The organisation's 部门 field, distinct from the account's 院系/department. */
/** 借用资格只排除普通志愿者（含苏州志愿者），其余红会成员部门均可申请。 */
export const MATERIAL_BORROW_EXCLUDED_DEPARTMENTS = Object.freeze([
  '志愿者', '苏州志愿者',
]);

export function materialBorrowEligibility(membership) {
  if (membership?.status !== 'verified') {
    const unavailable = membership?.status === 'unavailable';
    return { eligible: false, status: unavailable ? 'unavailable' : 'unverified', department: '',
      message: unavailable ? '暂时无法核验借用资格，请稍后重试。' : '尚未核验个人主页的部门信息，请联系管理员核对。' };
  }
  const department = typeof membership.department === 'string' ? membership.department.trim() : '';
  const eligible = department !== '' && !MATERIAL_BORROW_EXCLUDED_DEPARTMENTS.includes(department);
  return { eligible, status: eligible ? 'eligible' : 'not-internal', department,
    message: eligible ? '已具备物资借用资格。' : '物资借用仅向红会成员开放，普通志愿者无法申请。' };
}
