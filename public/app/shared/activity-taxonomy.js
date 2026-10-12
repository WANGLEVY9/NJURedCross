/** Legacy 活动报名总表 single-select options, verified against NJUTable. */
export const ACTIVITY_CATEGORY_OPTIONS = ['苏州分部', '主席团', '一加助残', '博爱中心', '生命中心', '综事中心'];
const aliases = { 苏州类: '苏州分部', 主席团类: '主席团', 博爱类: '博爱中心', 生命类: '生命中心', 综事类: '综事中心' };

export function activityKind(event) {
  const explicit = String(event.activityCategory || event.center || '').trim();
  if (explicit) return aliases[explicit] || explicit;
  const candidate = String(event.type || '').trim();
  return aliases[candidate] || (ACTIVITY_CATEGORY_OPTIONS.includes(candidate) ? candidate : '未分类');
}

/** Region and organisational category are independent; programme is not a region. */
export function activityRegion(event) {
  if (['nanjing', 'suzhou'].includes(event.region)) return event.region;
  if (event.region === '苏州活动') return 'suzhou';
  if (event.region === '南京活动') return 'nanjing';
  return /苏州/.test([event.campus, event.location, activityKind(event)].filter(Boolean).join(' ')) ? 'suzhou' : 'nanjing';
}

export function categoryFacets(events, options = ACTIVITY_CATEGORY_OPTIONS) {
  return [...new Set([...options, ...events.map(activityKind)])];
}
