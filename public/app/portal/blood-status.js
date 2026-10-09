/** Display-only states; capacity and permissions remain server controlled. */
export function bloodSlotState(event, registrations = []) {
  const own = registrations.find(record => record.eventId === event.id && ['待筛选', '已确认', '已签到'].includes(record.status));
  if (own) {
    if (own.status === '已签到') return { key: 'attended', label: '我的 · 已签到', icon: 'check', own };
    if (own.status === '已确认') return { key: 'confirmed', label: '我的 · 报名成功', icon: 'check', own };
    return { key: 'pending', label: '我的 · 待审核', icon: 'clock', own };
  }
  if (Number(event.remaining ?? event.capacity) <= 0) return { key: 'full', label: '已报满', icon: 'lock' };
  return { key: 'available', label: '可报名', icon: 'calendar' };
}
