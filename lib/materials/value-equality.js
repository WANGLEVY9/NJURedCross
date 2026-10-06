const dateFields = new Set([
  '操作时间',
  '实际借用日期',
  '实际归还日期',
]);

function calendarDate(value) {
  if (typeof value !== 'string') return null;

  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0{1,3})?\+08:00)?$/,
  );
  if (!match) return null;

  const day = match[1];
  const date = new Date(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== day
  ) {
    return null;
  }

  return day;
}

export function materialFieldEqual(key, actual, expected) {
  if (dateFields.has(key)) {
    const actualDay = calendarDate(actual);
    const expectedDay = calendarDate(expected);
    if (actualDay !== null && expectedDay !== null) {
      return actualDay === expectedDay;
    }
  }

  return JSON.stringify(actual ?? null)
    === JSON.stringify(expected ?? null);
}