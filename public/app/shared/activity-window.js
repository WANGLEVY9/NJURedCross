/** Activity scheduling uses Asia/Shanghai wall time, independent of browser timezone. */
export function shanghaiInstant(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(?:\+08:00)?$/.exec(String(value || ''));
  if (!match) return null;
  const local = `${match[1]}T${match[2]}:${match[3] || '00'}`;
  const canonical = `${local}+08:00`, timestamp = Date.parse(canonical);
  if (!Number.isFinite(timestamp) || new Date(timestamp + 8 * 3600000).toISOString().slice(0, 19) !== local) return null;
  return {local, canonical, timestamp};
}

export function activityWindow(start, end) {
  const from = shanghaiInstant(start), to = shanghaiInstant(end);
  if (!from || !to || to.timestamp <= from.timestamp) return null;
  return {start:from.canonical, end:to.canonical, seconds:(to.timestamp-from.timestamp)/1000};
}

export function positionWithinActivity(position, activity) {
  const parent = activityWindow(activity?.start, activity?.end);
  const child = activityWindow(position?.start, position?.end);
  return Boolean(parent && child && Date.parse(child.start) >= Date.parse(parent.start)
    && Date.parse(child.end) <= Date.parse(parent.end));
}
