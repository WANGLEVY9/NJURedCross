const config = event => {
  const value = event?.['报名页配置'];
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
};
const idFor = row => row?.['活动ID'] || row?._id || '';
const compare = (a, b) => String(a).localeCompare(String(b), 'zh-CN');
const positionName = row => row?.name || row?.['岗位'] || '';

export function positionLabel(number) {
  if (!Number.isSafeInteger(number) || number < 1) return '';
  const digits = '零一二三四五六七八九';
  if (number >= 1000) return `岗位${number}`;
  const hundreds = Math.floor(number / 100), tens = Math.floor(number / 10) % 10, ones = number % 10;
  let text = hundreds ? `${digits[hundreds]}百` : '';
  if (hundreds && !tens && ones) text += '零';
  if (tens) text += `${tens === 1 && !hundreds ? '' : digits[tens]}十`;
  if (ones) text += digits[ones];
  return `岗位${text}`;
}

export function createPositionLabels({ event = {}, events = [event], registrations = [] } = {}) {
  const allEvents = [...new Map([event, ...events].filter(Boolean).map(row => [idFor(row), row])).values()];
  const configs = new Map(allEvents.map(row => [row, config(row)]));
  const selectedConfig = config(event);
  const parentId = selectedConfig.parentActivityId;
  const parent = allEvents.find(row => parentId && idFor(row) === parentId)
    || allEvents.find(row => configs.get(row).positionPlan || configs.get(row).positionDraft);
  const parentConfig = parent ? configs.get(parent) : selectedConfig;
  const plan = parentConfig.positionPlan || parentConfig.positionDraft;
  const entries = [], byEvent = new Map(), byName = new Map();
  const add = (position, eventId = '', child = null) => {
    const childConfig = child ? configs.get(child) || config(child) : {};
    const start = position.start || childConfig.ordinary?.start || '';
    const end = position.end || childConfig.ordinary?.end || '';
    const entry = { number: entries.length + 1, label: positionLabel(entries.length + 1),
      name: positionName(position) || positionName(child), eventId,
      location: position.location || child?.['地点'] || '', campus: position.campus || childConfig.ordinary?.campus || '',
      date: start.slice(0, 10) || child?.['报名日期'] || '',
      slot: start && end ? `${start.slice(11, 19)}-${end.slice(11, 19)}` : child?.['报名时段'] || '' };
    entries.push(entry);
    if (eventId) byEvent.set(eventId, entry);
    if (entry.name) {
      if (!byName.has(entry.name)) byName.set(entry.name, []);
      byName.get(entry.name).push(entry);
    }
    return entry;
  };
  const childMatches = (row, position) => {
    const ordinary = configs.get(row).ordinary || {};
    return positionName(row) === positionName(position)
      && (!position.location || row['地点'] === position.location)
      && (!position.campus || ordinary.campus === position.campus)
      && (!position.start || ordinary.start === position.start)
      && (!position.end || ordinary.end === position.end);
  };
  if (Array.isArray(plan?.positions)) {
    for (const [index, position] of plan.positions.entries()) {
      const eventId = plan.eventIds?.[index] || position.eventId || position['活动ID'] || '';
      const children = allEvents.filter(row => (!parent || configs.get(row).parentActivityId === idFor(parent)) && childMatches(row, position));
      const child = eventId ? allEvents.find(row => idFor(row) === eventId) : children.length === 1 ? children[0] : null;
      add(position, eventId || idFor(child), child);
    }
  } else if (Array.isArray(plan?.eventIds)) {
    for (const eventId of plan.eventIds) add({}, eventId, allEvents.find(row => idFor(row) === eventId));
  }
  const legacyChildren = allEvents.filter(row => positionName(row) && !byEvent.has(idFor(row)))
    .sort((a, b) => compare(idFor(a), idFor(b)));
  for (const child of legacyChildren) {
    const names = byName.get(positionName(child)) || [];
    const matches = names.filter(entry => childMatches(child, { name: entry.name, location: entry.location, campus: entry.campus }));
    if (matches.length === 1 && !matches[0].eventId) {
      matches[0].eventId = idFor(child); byEvent.set(idFor(child), matches[0]);
    } else add({}, idFor(child), child);
  }
  const legacyNames = [...new Set(registrations.map(positionName).filter(name => name && !byName.has(name)))].sort(compare);
  for (const name of legacyNames) add({ name });
  const entryFor = row => {
    const eventEntry = byEvent.get(idFor(row));
    if (eventEntry && (!positionName(row) || !eventEntry.name || positionName(row) === eventEntry.name)) return eventEntry;
    const candidates = byName.get(positionName(row)) || [];
    if (candidates.length === 1) return candidates[0];
    const matches = candidates.filter(entry => (!row?.['报名日期'] || entry.date === row['报名日期'])
      && (!row?.['报名时段'] || entry.slot === row['报名时段']) && (!row?.['地点'] || entry.location === row['地点']));
    return matches.length === 1 ? matches[0] : null;
  };
  const legend = entries.map(entry => `${entry.label}：${entry.name || '未命名岗位'}${entry.campus || entry.location ? `（${[entry.campus && `${entry.campus}校区`, entry.location].filter(Boolean).join(' · ')}）` : ''}`).join('；');
  return { entries, entryFor, labelFor: row => entryFor(row)?.label || positionName(row) || '不限岗位', legend };
}

export function numeral(index) {
  return positionLabel(Number(index)).slice(2);
}

export function positionCode(index) {
  return positionLabel(Number(index));
}

export function buildPositionMap(positions = []) {
  const map = new Map();
  const eventRows = positions.some(item => item && typeof item === 'object' && (item['报名页配置'] || item['活动ID']));
  const contextualPositions = positions.some(item => item && typeof item === 'object' && (item.campus || item.location || item.start || item.end || item.eventId));
  if (eventRows || contextualPositions) {
    const labels = eventRows ? createPositionLabels({ event: positions[0], events: positions })
      : createPositionLabels({ event: { 报名页配置: { positionDraft: { positions } } } });
    for (const entry of labels.entries) {
      const sameName = labels.entries.filter(item => item.name === entry.name);
      map.set(sameName.length === 1 ? entry.name : entry.eventId || entry.label,
        { ...entry, code: entry.label, index: entry.number });
    }
    map.entryFor = row => {
      const entry = labels.entryFor(row);
      return entry ? { ...entry, code: entry.label, index: entry.number } : null;
    };
    return map;
  }
  for (const item of positions) {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    if (!name || map.has(name)) continue;
    map.set(name, { code: positionCode(map.size + 1), index: map.size + 1, name });
  }
  return map;
}

export function buildPositionMapFromRows(rows = []) {
  return buildPositionMap(rows.map(row => String(row?.['岗位'] || '').trim()));
}

export function labelPosition(map, name) {
  const row = name && typeof name === 'object' ? name : null;
  const label = String(row ? positionName(row) : name || '').trim();
  const item = row ? map?.entryFor?.(row) || map?.get?.(label) : map?.get?.(label);
  if (item) return `${item.code} · ${item.name}`;
  return label || '不限岗位';
}

export function positionLegend(map) {
  const items = [...(map?.values?.() || [])];
  if (items.length < 2) return '';
  return items.map(item => `${item.code} ${item.name}${item.campus || item.location ? `（${[item.campus && `${item.campus}校区`, item.location].filter(Boolean).join(' · ')}）` : ''}`).join(' · ');
}
