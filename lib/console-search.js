const VIEWS_BY_SCOPE = {
  materials: ['materials'],
  events: ['activities', 'events', 'services', 'volunteers'],
  outreach: ['outreach'],
  community: ['community'],
};

export async function searchBusinessRecords({
  query,
  permissions,
  providers,
  limit = 20,
}) {
  const text = typeof query === 'string'
    ? query.trim().slice(0, 120)
    : '';
  const allowed = new Set(permissions || []);
  const maximum = Number.isFinite(limit)
    ? Math.max(1, Math.min(50, Math.floor(limit)))
    : 20;

  if (text.length < 2) {
    return {
      ok: true,
      items: [],
      unavailable: [],
      truncated: false,
    };
  }

  const needle = text.toLocaleLowerCase();
  const active = providers.filter((provider) =>
    allowed.has(provider.scope) &&
    VIEWS_BY_SCOPE[provider.scope] &&
    typeof provider.load === 'function');

  const results = await Promise.allSettled(
    active.map((provider) => Promise.resolve().then(() => provider.load())),
  );

  const matches = [];
  const unavailable = [];
  const seen = new Set();
  let incomplete = false;

  results.forEach((result, index) => {
    const provider = active[index];
    if (
      result.status !== 'fulfilled' ||
      !Array.isArray(result.value?.items)
    ) {
      unavailable.push(provider.scope);
      return;
    }

    if (result.value.complete === false) incomplete = true;

    for (const record of result.value.items) {
      if (
        typeof record?.id !== 'string' ||
        !record.id.trim() ||
        typeof record.title !== 'string' ||
        !record.title.trim() ||
        !VIEWS_BY_SCOPE[provider.scope].includes(record.view)
      ) {
        continue;
      }

      const detail = typeof record.detail === 'string' ? record.detail : '';
      const searchable = [
        record.title,
        detail,
        record.id,
        typeof record.target?.id === 'string' ? record.target.id : '',
      ].join(' ').toLocaleLowerCase();

      if (!searchable.includes(needle)) continue;

      const identity = `${provider.scope}:${record.view}:${record.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      matches.push({
        id: record.id,
        title: record.title,
        detail,
        view: record.view,
        ...(record.target ? { target: record.target } : {}),
      });
    }
  });

  return {
    ok: true,
    items: matches.slice(0, maximum),
    unavailable: [...new Set(unavailable)],
    truncated: incomplete || matches.length > maximum,
  };
}