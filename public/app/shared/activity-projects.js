// Group only explicit project identities, never display names.
function legacyProjectConfig(event) {
  try {
    const config = JSON.parse(event?.['报名页配置'] || '{}');
    return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
  } catch { return null; }
}
export function legacyActivityRelation(event, legacy=legacyProjectConfig(event)) {
  return {
    groupId:String(legacy?.ordinary?.groupId || legacy?.positionPlan?.groupId || '').trim(),
    parentId:String(legacy?.parentActivityId || '').trim(),
  };
}
export const activityProjectId=event=>legacyActivityRelation(event).groupId;
export const activityParentId=event=>legacyActivityRelation(event).parentId;
/** 献血车按周一归周：一个自然周（周一至周日）就是一个活动项目。 */
export function bloodWeekStart(date) {
  const value = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const day = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) return '';
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
  return projectKey(event, legacyProjectConfig(event));
}

function projectKey(event, config) {
  const stored = String(event?.['活动组ID'] || '').trim();
  if (stored) {
    if (!compatibleStoredActivityGroup(event)) return 'event:'+event._id;
    return stored.startsWith('schedule:') || stored.startsWith('blood:') ? stored : 'ordinary:'+stored;
  }
  return historicalProjectKey(event, config);
}

function historicalProjectKey(event, config) {
  const { special, blood } = config || {};
  if (['schedule','hospital-examination','hospital-vaccination'].includes(special?.type) && special.rootId && special.week) {
    if (bloodWeekStart(special.week) === special.week) return `schedule:${special.rootId}:${special.week}`;
    return `event:${event._id}`;
  }
  const id = legacyActivityRelation(event, config).groupId;
  if (id) return `ordinary:${id}`;
  if (blood) {
    const start = blood.weekStart ?? bloodWeekStart(event['报名日期']);
    if (start && bloodWeekStart(start) === start) return bloodWeekKey(start);
  }
  if (config?.bookingMode === 'grouped' && !config.parentActivityId && event['活动ID']) {
    return `ordinary:PROJECT-${event['活动ID']}`;
  }
  return `event:${event._id}`;
}

/** The ordinary value is a foreign key to the project table; weekly sources
 * use their own namespaces. Never create a group for an independent row. */
export function storedActivityGroup(event, { legacyDates = false } = {}) {
  const config = legacyProjectConfig(event);
  if (!config) return '';
  if (config.blood && !config.blood.weekStart && !legacyDates) return '';
  const key = historicalProjectKey(event, config);
  if (key.startsWith('ordinary:')) return legacyActivityRelation(event, config).groupId;
  return key.startsWith('schedule:') || key.startsWith('blood:') ? key : '';
}

export function compatibleStoredActivityGroup(event) {
  const stored=event?.['活动组ID'];
  if (!stored) return true;
  const config=legacyProjectConfig(event);
  if (!config || typeof stored!=='string') return false;
  if (config.blood&&!config.blood.weekStart&&stored.startsWith('blood:')) {
    const week=stored.slice(6);
    return Boolean(week&&bloodWeekStart(week)===week);
  }
  return stored===storedActivityGroup(event);
}

/** Management API grouping follows the same scope as the roster. */
export function activityGroupId(event) {
  if (!event?._id || event.configurationError || event.relationshipError || event.sourceSuperseded || !compatibleStoredActivityGroup(event)) return null;
  const config = legacyProjectConfig(event);
  return config ? projectKey(event, config) : null;
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
    const damaged=sessions.find(row=>row.configurationError);
    const relationshipDamaged=sessions.find(row=>row.relationshipError);
    const key = activityProjectKey(representative);
    const blood = key.startsWith('blood:');
    const weekName = blood ? bloodWeekName(key.slice('blood:'.length)) : '';
    return { ...representative, sessions, ...(damaged?{configurationError:true,damagedEventId:damaged._id}:{}), ...(relationshipDamaged?{relationshipError:true,relationshipDamagedEventId:relationshipDamaged._id}:{}), projectName: weekName || (blood ? `${String(representative['报名日期']).slice(0,7)} 献血车志愿服务` : representative.registrationControl?.groupName || representative['活动名称']) };
  });
}
