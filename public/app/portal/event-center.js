/** Normalize activity departments without changing their source records. */
export function eventCenterLabel(event) {
  const categories = [event.center, event.category, event.type, event['所属部门'], event['活动类别']]
    .map(value => String(value || '').trim()).filter(Boolean);
  const category = categories[0] || '';
  if (event.blood || categories.some(value => /献血车/.test(value))) return '献血车专项';
  if (/^博爱|^一加助残/.test(category)) return '博爱中心';
  if (/^生命/.test(category)) return '生命中心';
  if (/^综事/.test(category)) return '综事中心';
  if (/^主席团/.test(category)) return '主席团';
  // Legacy Suzhou activities retain their label until a centre is assigned.
  return category || '公益活动';
}
