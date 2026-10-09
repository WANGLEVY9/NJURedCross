export const EVENT_CATEGORIES = [
  { value: '', label: '全部' },
  { value: 'nanjing', label: '南京地区' },
  { value: 'suzhou', label: '苏州地区' },
  { value: 'blood', label: '献血车专项' },
];
export function eventCategory(event) {
  if (event.blood || /献血车/.test(String(event.type || ''))) return 'blood';
  const place = [event.campus, event.location, event.type, event.name].filter(Boolean).join(' ');
  if (/苏州/.test(place)) return 'suzhou';
  // Match the activity centre: other ordinary activities belong to Nanjing.
  return 'nanjing';
}

export const EVENT_CAMPUSES = ['仙林校区', '苏州校区', '浦口校区', '鼓楼校区'];
export function campusName(value) {
 const name=String(value||'').trim();
 return ['仙林','苏州','浦口','鼓楼'].includes(name)?`${name}校区`:name;
}
