/** Legacy options plus the owner's explicitly confirmed blood-vehicle category. */
export const ACTIVITY_CATEGORY_OPTIONS = ['苏州分部', '主席团', '一加助残', '博爱中心', '生命中心', '综事中心', '献血车专项'];
export const ACTIVITY_CENTER_OPTIONS = ['博爱中心', '生命中心', '综事中心', '主席团'];
const aliases = { 苏州类: '苏州分部', 主席团类: '主席团', 博爱类: '博爱中心', 博爱: '博爱中心', 一加助残: '博爱中心', 生命类: '生命中心', 生命: '生命中心', 综事类: '综事中心', 综事: '综事中心' };

export function workflowActivityCenter(row, config = {}) {
  const value = [row['组织类别'], config.center, row['活动类别']].find(value => value && value !== '未分类');
  return value ? activityKind({center: value}) : '';
}

export function activityKind(event) {
  const explicit = String(event.center || event.activityCategory || '').trim();
  if (explicit) return aliases[explicit] || explicit;
  const candidate = String(event.type || '').trim();
  return aliases[candidate] || (ACTIVITY_CATEGORY_OPTIONS.includes(candidate) ? candidate : '未分类');
}

/** Region and organisational category are independent; programme is not a region. */
export function activityRegion(event) {
  if (['nanjing', 'suzhou'].includes(event.region)) return event.region;
  if (['苏州活动','苏州地区'].includes(event.region)) return 'suzhou';
  if (['南京活动','南京地区'].includes(event.region)) return 'nanjing';
  return /苏州/.test([event.campus, event.location, activityKind(event)].filter(Boolean).join(' ')) ? 'suzhou' : 'nanjing';
}

export function categoryFacets(events, options = ACTIVITY_CATEGORY_OPTIONS) {
  return [...new Set([...options, ...events.map(activityKind)])];
}
