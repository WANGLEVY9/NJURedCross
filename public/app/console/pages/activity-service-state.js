const approved = entry => ['已批准', '已入账'].includes(entry?.['状态']);

export function serviceStatus(entry, isReview) {
  if (approved(entry)) return '已通过';
  if (entry?.['状态'] === '已退回') return '退回待改';
  if (entry?.['状态'] === '待批准') return isReview ? '待审核' : '已提交';
  return '待签到';
}

export function matchesServiceFilter(filter, entry, isReview) {
  if (filter === 'all') return true;
  if (filter === 'approved') return approved(entry);
  if (filter === 'returned') return entry?.['状态'] === '已退回';
  if (filter === 'submitted') return entry?.['状态'] === '待批准' || approved(entry);
  return isReview ? entry?.['状态'] === '待批准' : !entry || entry['状态'] === '已退回';
}

export function attendanceBlockReason(registration, entry, blood) {
  if (approved(entry)) return '已通过审核，可到⑤导出。';
  if (entry?.['状态'] === '待批准') return '已提交到⑤，等待审核。';
  if (!['已确认', '已签到'].includes(registration['报名状态'])) return '请先确认报名名单。';
  if (registration['请假状态'] === '待审批') return '请先在报名环节处理请假。';
  if (blood && !registration['签到照片ID']) return '等待参与者提交签到照片。';
  return '';
}

export function reviewBlockReason(entry, actor, superAdmin) {
  if (approved(entry)) return '已通过，可直接导出。';
  if (entry?.['状态'] === '已退回') return '请回④修改后重新提交。';
  if (entry?.['状态'] !== '待批准') return '请先在④确认签到并录入。';
  if (!superAdmin && (entry['核对人'] === actor || entry['账号ID'] === actor)) return '需由另一位管理员审核，不能审核自己录入或参与的记录。';
  return '';
}
