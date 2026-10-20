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

  if (item.view === 'outreach') {
    const target = item.target;

    if (
      !['submission', 'campaign'].includes(target?.kind) ||
      typeof target.id !== 'string' ||
      !target.id.trim()
    ) {
      return route;
    }

    const query = new URLSearchParams({
      tab: target.kind === 'submission' ? 'public' : 'board',
      [target.kind]: target.id,
    });

    return `${route}?${query.toString()}`;
  }

  if (item.view === 'community') {
    const target = item.target;

    if (
      !target ||
      !['interest', 'submission'].includes(target.kind) ||
      typeof target.id !== 'string' ||
      !target.id.trim() ||
      !['birthday', 'morning'].includes(target.program)
    ) {
      return route;
    }

    const query = new URLSearchParams({
      program: target.program,
      tab: target.kind === 'interest' ? 'interests' : 'submissions',
      [target.kind]: target.id,
    });

    return `${route}?${query.toString()}`;
  }

  if (['services', 'volunteers'].includes(item.view)) {
    const target = item.target;

    if (
      target?.kind !== 'hours' ||
      typeof target.id !== 'string' ||
      !target.id.trim()
    ) {
      return route;
    }

    const query = new URLSearchParams({ hours: target.id });
    return `${route}?${query.toString()}`;
  }

  if (['activities', 'events'].includes(item.view)) {
    const target = item.target;
    if(target?.kind==='draft'&&typeof target.id==='string'&&target.id.trim())return `${route}?${new URLSearchParams({draft:target.id})}`;

    if (
      target?.kind === 'event' &&
      typeof target.id === 'string' &&
      target.id.trim()
    ) {
      const query = new URLSearchParams({
        event: target.id,
        scope: 'session',
        mode: target.mode === 'trash' ? 'trash' : 'all',
        tab: 'overview',
      });
      return `${route}?${query.toString()}`;
    }

    if (
      target?.kind !== 'source' ||
      typeof target.id !== 'string' ||
      !target.id.startsWith('managed:') ||
      !target.id.slice('managed:'.length).trim()
    ) {
      return route;
    }

    const query = new URLSearchParams({
      source: target.id,
      mode: 'sources',
      tab: 'overview',
    });
    return `${route}?${query.toString()}`;
  }

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