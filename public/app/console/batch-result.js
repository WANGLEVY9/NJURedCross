export function summarizeBatchResult(selected, response) {
  if (!Array.isArray(selected)) {
    throw new TypeError('批量选择必须是数组');
  }

  const ids = new Set();
  for (const item of selected) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      ids.has(item.id)
    ) {
      throw new TypeError('批量选择包含无效或重复编号');
    }
    ids.add(item.id);
  }

  const results = response?.results;
  const byId = new Map();
  let malformed = !Array.isArray(results);

  if (!malformed) {
    for (const result of results) {
      if (
        !result ||
        typeof result.id !== 'string' ||
        !ids.has(result.id) ||
        byId.has(result.id) ||
        typeof result.ok !== 'boolean'
      ) {
        malformed = true;
        break;
      }
      byId.set(result.id, result);
    }
  }

  const items = selected.map(item => {
    const result = malformed ? null : byId.get(item.id);

    if (!result) {
      return {
        id: item.id,
        name: item.name || item.id,
        status: 'unknown',
        message: '未收到明确结果，请刷新并核对记录，避免重复提交。',
      };
    }

    return {
      id: item.id,
      name: item.name || item.id,
      status: result.ok ? 'succeeded' : 'failed',
      message: result.ok
        ? '服务端已确认处理成功。'
        : typeof result.message === 'string' && result.message.trim()
          ? result.message
          : '本条未完成，请核对当前状态和处理条件。',
    };
  });

  return {
    items,
    succeeded: items.filter(item => item.status === 'succeeded').length,
    failed: items.filter(item => item.status === 'failed').length,
    unknown: items.filter(item => item.status === 'unknown').length,
  };
}

export function summarizeRosterDraftResult(selected, response) {
  const completed = response?.result?.completed;
  const selectedIds = new Set(selected.map(item => item.id));

  const valid = response?.ok === true &&
    Array.isArray(completed) &&
    new Set(completed).size === completed.length &&
    completed.every(id =>
      typeof id === 'string' && selectedIds.has(id)
    );

  const summary = summarizeBatchResult(
    selected,
    valid
      ? { results: completed.map(id => ({ id, ok: true })) }
      : null,
  );

  for (const item of summary.items) {
    if (item.status === 'succeeded') {
      item.message = '暂定结果已保存，尚未最终公布或发送通知。';
    }
  }

  return summary;
}