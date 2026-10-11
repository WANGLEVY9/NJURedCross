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
