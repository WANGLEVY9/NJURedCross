const ROUTES = new Map([
  ['materials', '/console/materials'],
  ['activities', '/console/events'],
  ['events', '/console/events'],
  ['services', '/console/volunteers'],
  ['volunteers', '/console/volunteers'],
  ['outreach', '/console/outreach'],
  ['community', '/console/community'],
]);

export function taskRoute(item) {
  const route = ROUTES.get(item?.view);
  if (!route) return null;

  if (item.view !== 'materials') return route;

  const target = item.target;
  if (
    !target ||
    typeof target.id !== 'string' ||
    !target.id.trim() ||
    !['application', 'inventory'].includes(target.kind)
  ) {
    return route;
  }

  const query = new URLSearchParams({
    tab: target.kind === 'inventory' ? 'inventory' : 'applications',
    [target.kind]: target.id,
  });

  return `${route}?${query.toString()}`;
}