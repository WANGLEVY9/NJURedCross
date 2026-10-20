/** Organization categories are independent of geographical region. */
export const ACTIVITY_CATEGORY_OPTIONS = Object.freeze(['主席团专项', '博爱中心', '生命中心', '综事中心', '排班专项', '一加助残专项', '献血车专项']);
const aliases = { 主席团: '主席团专项', 主席团类: '主席团专项', 一加助残:'一加助残专项', 博爱类: '博爱中心', 生命类: '生命中心', 综事类: '综事中心' };

/** Preserve historical category keys without changing persisted business records. */
export const canonicalActivityCategory = value => value === '排班类' || value === '排版类' ? '排班专项' : value;

export function activityKind(event) {
  const explicit = canonicalActivityCategory(String(event.activityCategory || event.center || '').trim());
  if (explicit) return aliases[explicit] || (ACTIVITY_CATEGORY_OPTIONS.includes(explicit) ? explicit : '未分类');
  const candidate = canonicalActivityCategory(String(event.type || '').trim());
  return aliases[candidate] || (ACTIVITY_CATEGORY_OPTIONS.includes(candidate) ? candidate : '未分类');
}

/** Region and organisational category are independent; programme is not a region. */
export function activityRegion(event) {
  if (['nanjing', 'suzhou'].includes(event.region)) return event.region;
  if (['苏州活动','苏州地区'].includes(event.region)) return 'suzhou';
  if (['南京活动','南京地区'].includes(event.region)) return 'nanjing';
  return /苏州/.test([event.campus, event.location, event.center, event.type, activityKind(event)].filter(Boolean).join(' ')) ? 'suzhou' : 'nanjing';
}

export function categoryFacets(events, options = ACTIVITY_CATEGORY_OPTIONS) {
  return [...new Set(options.filter(value=>ACTIVITY_CATEGORY_OPTIONS.includes(value)))];
}
