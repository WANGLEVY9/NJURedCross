// Group only explicit NJUTable project identities, never display names.
export function ordinaryProjectId(event) {
  try { const c=JSON.parse(event['报名页配置'] || '{}');return c.ordinary?.groupId || c.positionPlan?.groupId || ''; } catch { return ''; }
}
export function projectEvents(events, event) {
  return events.filter(row => activityProjectKey(row) === activityProjectKey(event));
}
export function activityProjectKey(event) {
  const id = ordinaryProjectId(event);
  if (id) return `ordinary:${id}`;
  try {
    if (JSON.parse(event['报名页配置'] || '{}').blood && /^\d{4}-\d{2}-\d{2}$/.test(event['报名日期'])) return `blood:${event['报名日期'].slice(0,7)}`;
  } catch { /* Unconfigured rows remain independent. */ }
  return `event:${event._id}`;
}
export function activityProjects(events) {
  const groups = new Map();
  for (const event of events.filter(row => !row.sourceSuperseded)) {
    const key = activityProjectKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.values()].map(sessions => {
    sessions.sort((a, b) => `${a['报名日期']} ${a['报名时段']} ${a._id}`.localeCompare(`${b['报名日期']} ${b['报名时段']} ${b._id}`));
    const parent=sessions.find(row=>{try{return Boolean(JSON.parse(row['报名页配置']||'{}').positionPlan);}catch{return false;}});
    const representative = parent || sessions.find(row => row['状态'] === '报名中') || sessions[0];
    const blood = activityProjectKey(representative).startsWith('blood:');
    return { ...representative, sessions, projectName: blood ? `${representative['报名日期'].slice(0,7)} 献血车志愿服务` : representative.registrationControl?.groupName || representative['活动名称'] };
  });
}
