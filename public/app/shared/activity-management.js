/** Shared display rules; this module contains no network or storage access. */
export const ACTIVITY_CENTERS = ['博爱类', '生命类', '综事类', '主席团类', '苏州类'];
export const HALF_HOURS = Array.from({length:48}, (_, i) => `${String(Math.floor(i / 2)).padStart(2,'0')}:${i % 2 ? '30' : '00'}`);
export function serviceDuration(start, end) {
  if (!HALF_HOURS.includes(start) || !HALF_HOURS.includes(end)) return null;
  const hours = (HALF_HOURS.indexOf(end) - HALF_HOURS.indexOf(start)) / 2;
  return hours > 0 ? hours : null;
}
function scheduledRegistrationLine(publishAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})(?::00)?(?:\+08:00)?$/.exec(publishAt || '');
  return match && HALF_HOURS.includes(match[4]) ? `【报名开始】：${Number(match[2])}月${Number(match[3])}日 ${match[4]} 开始报名（北京时间）` : '';
}
export function syncNoticeSchedule(text, publishAt) {
  const source = String(text || ''), newline = source.includes('\r\n') ? '\r\n' : '\n';
  const announcement = scheduledRegistrationLine(publishAt), lines = [];
  let inserted = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^【报名开始】\s*[：:]/.test(line)) {
      if (announcement && !inserted) { lines.push(announcement); inserted = true; }
    } else lines.push(line);
  }
  if (announcement && !inserted) {
    const position = lines.findIndex(line => /^【报名方式】/.test(line));
    lines.splice(position < 0 ? lines.length : position, 0, announcement);
  }
  return lines.join(newline);
}
export function noticeTemplate(config) {
  const name = String(config.name || '').replace(/^南大红会\s*/, '');
  const registrationStart = scheduledRegistrationLine(config.publishAt);
  return [`南大红会 ${name}`, '', `【活动时间】：${config.date || '待定'} ${config.slot || ''}`,
    `【活动地点】：${config.location || '待定'}`, `【活动内容】：${config.content || config.work || ''}`,
    `【志愿福利】：${config.benefits || '丰富的志愿时长'}`, `【报名要求】：${config.requirements || '按时到岗，服从活动安排'}`,
    `【录取名额】：${config.capacity} 人`,
    ...(registrationStart ? [registrationStart] : []),
    '【报名方式】：登录平台活动中心，选择本活动报名。'].join('\n');
}
export function registrationOpen(event, now = Date.now()) {
  let config = {}; try { config = JSON.parse(event['报名页配置'] || '{}'); } catch { return false; }
  return event['状态'] === '报名中' && !config.rosterReview?.closed && (!config.publishAt || Date.parse(config.publishAt) <= now);
}
export function matchesActivity(item, {mode = 'all', category = '', search = ''} = {}) {
  if (mode === 'trash' ? item.status !== '已归档' : item.status === '已归档') return false;
  if (mode === 'review' && !['草稿','待审核','可发布'].includes(item.status)) return false;
  if (mode === 'open' && !['报名中','停点'].includes(item.status)) return false;
  if (mode === 'sources' && item.status !== '待配置') return false;
  if (category && item.center !== category && item.category !== category && !(category === '苏州类' && item.region === '苏州活动')) return false;
  const haystack = [item.name,item.category,item.center,item.team,item.date,item.region].join(' ').normalize('NFKC').toLowerCase();
  return search.normalize('NFKC').trim().toLowerCase().split(/\s+/).every(word => haystack.includes(word));
}
export function filterRoster(rows, {search = '', campus = '', certificate = '', core = '', status = '', order = 'asc'} = {}) {
  const campuses = Array.isArray(campus) ? campus : campus ? [campus] : [];
  return rows.filter(r => {
    const p = r.participant || {};
    return (!search.trim() || `${r['姓名']} ${r['学号']}`.includes(search.trim())) &&
      (!campuses.length || campuses.includes(p.campus)) && (!certificate || (p.certificateStatus || 'unknown') === certificate) &&
      (!core || (p.coreMemberStatus || 'unknown') === core) && (!status || (status === 'success' ? ['已确认','已签到'].includes(r['报名状态']) : r['报名状态'] === status));
  }).sort((a,b) => Number(b['报名状态']==='待筛选')-Number(a['报名状态']==='待筛选') || ((Date.parse(a['创建时间']) || 0) - (Date.parse(b['创建时间']) || 0)) * (order === 'desc' ? -1 : 1) || a._id.localeCompare(b._id));
}
export const canDecideRegistration = row => row?.['报名状态']==='待筛选'&&row['请假状态']!=='待审批';
export const hasRegistrationResult = row => ['已确认','已签到','未入选'].includes(row?.['报名状态']);
export function selectedPendingIds(rows, selected) {
  return rows.filter(row=>selected.has(row._id)&&canDecideRegistration(row)).map(row=>row._id);
}
export function selectedResultIds(rows, selected) {
  return rows.filter(row=>selected.has(row._id)&&hasRegistrationResult(row)).map(row=>row._id);
}
