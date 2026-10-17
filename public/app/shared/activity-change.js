export function isActivityChangeSupported(event) {
  let config;
  try { config = JSON.parse(event['报名页配置'] || '{}'); } catch { return false; }
  return event['状态'] === '报名中' && !config.blood && !config.ordinary && !config.positionPlan && !config.parentActivityId
    && config.bookingMode !== 'grouped' && config.source?.kind !== 'generated_blood';
}

export function activityChangePatch(event, values) {
  const fields = ['活动名称', '报名日期', '报名时段', '容量', '服务时长', '培训时长', '交通时长', '地点', '工作内容', '通知草稿'];
  const next = { ...values };
  if (Object.hasOwn(values, 'windowStart') || Object.hasOwn(values, 'windowEnd')) {
    const normalize = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value + ':00' : value;
    const start = normalize(values.windowStart || ''), end = normalize(values.windowEnd || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(end) || start >= end) throw new Error('请选择有效的活动起止时间');
    next['报名日期'] = start.slice(0, 10);
    next['报名时段'] = `${start.replace('T', ' ')} — ${end.replace('T', ' ')}`;
  }
  return Object.fromEntries(fields.filter(field => Object.hasOwn(next, field))
    .map(field => [field, String(next[field] ?? '').trim()])
    .filter(([field, value]) => String(event[field] ?? '') !== value));
}
