// Group only explicit NJUTable project identities, never display names.
export function ordinaryProjectId(event) {
  try { const c=JSON.parse(event['报名页配置'] || '{}');return c.ordinary?.groupId || c.positionPlan?.groupId || ''; } catch { return ''; }
}
/** 献血车按周一归周：一个自然周（周一至周日）就是一个活动项目。 */
export function bloodWeekStart(date) {
  const value = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const day = new Date(`${value}T00:00:00Z`);
  if (day.toISOString().slice(0, 10) !== value) return '';
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}
export function bloodWeekEnd(monday) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monday || ''))) return '';
  const day = new Date(`${monday}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 6);
  return day.toISOString().slice(0, 10);
}
/** 11.2-11.8：周次区间标签，只显示月与日。 */
export function bloodWeekLabel(monday) {
  const end = bloodWeekEnd(monday);
  if (!end) return '';
  const part = date => `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
  return `${part(monday)}-${part(end)}`;
}
export function bloodWeekName(monday) {
  return bloodWeekLabel(monday) ? `${bloodWeekLabel(monday)} 市血液献血车志愿服务活动` : '';
}
export function projectEvents(events, event) {
  return events.filter(row => activityProjectKey(row) === activityProjectKey(event));
}
/** 一次遍历建立项目分桶；整表按项目过滤时避免 O(n²) 的键解析。 */
export function projectEventGroups(events) {
  const groups = new Map();
  for (const row of events) {
    const key = activityProjectKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}
export function projectEventsFrom(groups, event) {
  return groups.get(activityProjectKey(event)) || [event];
}
export function activityProjectKey(event) {
  const id = ordinaryProjectId(event);
  if (id) return `ordinary:${id}`;
  try {
    if (JSON.parse(event['报名页配置'] || '{}').blood) {
      const start = bloodWeekStart(event['报名日期']);
      if (start) return `blood:${start}`;
    }
  } catch { /* Unconfigured rows remain independent. */ }
  return `event:${event._id}`;
}
export function bloodWeekKey(monday) {
  return `blood:${monday}`;
}
/** 周次分组沿用的旧月度键；用于继承改版前的报名开关决策。 */
export function legacyBloodMonthKey(event) {
  try {
    if (JSON.parse(event['报名页配置'] || '{}').blood && /^\d{4}-\d{2}-\d{2}$/.test(String(event['报名日期'] || ''))) return `blood:${String(event['报名日期']).slice(0, 7)}`;
  } catch { /* Unconfigured rows remain independent. */ }
  return '';
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
    const representative = parent || sessions.find(row => row['状态'] === '报名中') || sessions.find(row => row['状态'] === '进行中') || sessions.find(row => row['状态'] === '停点') || sessions[0];
    const blood = activityProjectKey(representative).startsWith('blood:');
    const weekName = blood ? bloodWeekName(bloodWeekStart(representative['报名日期'])) : '';
    return { ...representative, sessions, projectName: weekName || (blood ? `${String(representative['报名日期']).slice(0,7)} 献血车志愿服务` : representative.registrationControl?.groupName || representative['活动名称']) };
  });
}
