const SOURCES = {
  inventory: {
    scope: 'materials',
    view: 'materials',
    label: '物资台账',
  },
  event: {
    scope: 'events',
    view: 'activities',
    label: '活动记录',
  },
  campaign: {
    scope: 'outreach',
    view: 'outreach',
    label: '宣传内容看板',
  },
  submission: {
    scope: 'outreach',
    view: 'outreach',
    label: '宣传投稿',
  },
};

export function agentContextQueries(brief) {
  if (typeof brief !== 'string' || !brief.trim()) {
    throw new Error('缺少有效需求');
  }

  // 第一版采用有限关键词匹配，不把整段需求当成精确搜索词。
  const known = [
    '急救', 'AED', '心肺复苏', '献血', '博爱青春',
    '新生', '生日', '讲座', '培训',
  ].filter(word => brief.toLowerCase().includes(word.toLowerCase()));

  if (known.length) return known.slice(0, 2);

  const fragments = brief.split(/[\s，。；：、,.;:!?！？]+/)
    .map(value => value.trim())
    .filter(value => value.length >= 2);

  return [...new Set(fragments)]
    .slice(0, 2)
    .map(value => value.slice(0, 40));
}

export async function readAgentBusinessContext({
  brief,
  permissions,
  search,
  now = () => new Date().toISOString(),
}) {
  if (typeof search !== 'function') {
    throw new Error('缺少业务搜索接口');
  }

  const scopes = ['events', 'materials', 'outreach']
    .filter(scope => Array.isArray(permissions) && permissions.includes(scope));
  const queries = agentContextQueries(brief);
  const items = [];
  const unavailable = new Set();
  const seen = new Set();
  let truncated = false;

  if (scopes.length) {
    // 顺序查询，避免同时重复读取业务来源。
    for (const query of queries) {
      let payload;

      try {
        payload = await search(query, scopes);
      } catch {
        scopes.forEach(scope => unavailable.add(scope));
        continue;
      }

      if (payload?.ok !== true || !Array.isArray(payload.items)) {
        scopes.forEach(scope => unavailable.add(scope));
        continue;
      }

      if (payload.truncated === true) truncated = true;

      if (Array.isArray(payload.unavailable)) {
        payload.unavailable
          .filter(scope => scopes.includes(scope))
          .forEach(scope => unavailable.add(scope));
      }

      for (const record of payload.items) {
        const definition = SOURCES[record?.target?.kind];

        if (
          !definition ||
          !scopes.includes(definition.scope) ||
          record.view !== definition.view ||
          typeof record.target.id !== 'string' ||
          !record.target.id.trim() ||
          typeof record.title !== 'string' ||
          !record.title.trim()
        ) {
          continue;
        }

        const identity = `${record.target.kind}:${record.target.id}`;
        if (seen.has(identity)) continue;
        seen.add(identity);

        if (items.length >= 8) {
          truncated = true;
          continue;
        }

        items.push({
          id: identity,
          title: record.title.slice(0, 200),
          detail: typeof record.detail === 'string'
            ? record.detail.slice(0, 600)
            : '',
          scope: definition.scope,
          source: definition.label,
          view: definition.view,
          target: {
            kind: record.target.kind,
            id: record.target.id,
          },
        });
      }
    }
  }

  return {
    queries,
    checkedAt: now(),
    items,
    unavailable: [...unavailable],
    truncated,
    note: '关键词匹配结果仅供参考；未匹配不代表系统没有相关记录，库存也不代表已预留。',
  };
}

export function normalizeAgentBusinessContext(
  context,
  permissions = ['events', 'materials', 'outreach'],
) {
  if (
    !context ||
    !Array.isArray(context.queries) ||
    context.queries.length > 2 ||
    context.queries.some(query =>
      typeof query !== 'string' || query.length > 40) ||
    !Array.isArray(context.items) ||
    context.items.length > 8 ||
    !Array.isArray(context.unavailable) ||
    typeof context.truncated !== 'boolean' ||
    typeof context.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(context.checkedAt))
  ) {
    throw new Error('系统参考信息格式不正确');
  }

  const allowed = ['events', 'materials', 'outreach']
    .filter(scope => permissions.includes(scope));

  const items = [];

  for (const item of context.items) {
    const definition = SOURCES[item?.target?.kind];

    if (
      !definition ||
      item.scope !== definition.scope ||
      item.view !== definition.view ||
      item.source !== definition.label ||
      typeof item.target.id !== 'string' ||
      !item.target.id.trim() ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      typeof item.detail !== 'string'
    ) {
      throw new Error('系统参考记录格式不正确');
    }

    if (!allowed.includes(definition.scope)) continue;

    items.push({
      id: `${item.target.kind}:${item.target.id}`,
      title: item.title.slice(0, 200),
      detail: item.detail.slice(0, 600),
      scope: definition.scope,
      source: definition.label,
      view: definition.view,
      target: {
        kind: item.target.kind,
        id: item.target.id,
      },
    });
  }

  return {
    queries: [...context.queries],
    checkedAt: context.checkedAt,
    items,
    unavailable: [...new Set(context.unavailable)]
      .filter(scope => allowed.includes(scope)),
    truncated: context.truncated,
    note: '关键词匹配结果仅供参考；未匹配不代表系统没有相关记录，库存也不代表已预留。',
  };
}