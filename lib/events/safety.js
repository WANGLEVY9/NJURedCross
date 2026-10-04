/** Single-instance event mutations share one queue, including aliases and sessions. */
export function createMutationQueue() {
  let tail = Promise.resolve();
  return async task => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  };
}

export function assertCompleteRows(...datasets) {
  if (datasets.some(rows => !Array.isArray(rows) || rows.readMeta?.truncated)) {
    const error = new Error('数据读取不完整，已停止操作，请联系管理员核对后重试。');
    error.statusCode = 503;
    error.code = 'incomplete_operational_data';
    throw error;
  }
}
