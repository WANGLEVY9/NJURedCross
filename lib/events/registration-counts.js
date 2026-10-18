/** Request-local public counters; source rows and identity fields never leave this closure. */
export function createRegistrationCounter(registrations) {
  const byActivity = new Map();
  for (const row of registrations) {
    const status = row['报名状态'];
    if (!['已确认', '已签到', '待筛选'].includes(status)) continue;
    const id = row['活动ID'];
    let counts = byActivity.get(id);
    if (!counts) {
      counts = { confirmed: 0, pending: 0 };
      byActivity.set(id, counts);
    }
    if (status === '待筛选') counts.pending++;
    else counts.confirmed++;
  }
  return activityIds => {
    const result = { confirmed: 0, pending: 0 };
    // Repeated source IDs must not count the same activity more than once.
    for (const id of new Set(activityIds)) {
      const counts = byActivity.get(id);
      if (counts) {
        result.confirmed += counts.confirmed;
        result.pending += counts.pending;
      }
    }
    return result;
  };
}
