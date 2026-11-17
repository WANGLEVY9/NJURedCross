import { assertRequestActive } from '../http/request-budget.js';

/**
 * 上游读取失败时保留 SeaTable 的状态码。
 *
 * 原先任何异常都被压成同一个 503 `profile_query_unavailable`：token 过期（401）、
 * 限流（429）、上游崩溃（500）、本地查询写错，在页面和日志里长得一模一样，
 * 运维只能靠猜。带上 `response.status` 之后 `apiFailure()` 会把它们分开——
 * 401/403 ⇒ 503 `seatable_auth_failed`（连接不可用），其余上游状态 ⇒
 * 502 并在响应体里带出 `seaTableStatus`（请求失败）。
 * 确实没有上游状态（网络中断、请求超时）时才回落到原来的错误码。
 */
function unavailable(cause) {
  const upstream = Number.isInteger(cause?.response?.status)
    && cause.response.status >= 400
    && cause.response.status <= 599
    ? cause.response.status
    : null;

  return Object.assign(
    new Error('资料查询结果暂不可确认，已停止自动同步。'),
    { code: 'profile_query_unavailable' },
    // 有上游状态就交给 apiFailure 分类，没有才用本地 503 兜底。
    upstream === null ? { statusCode: 503 } : { response: { status: upstream } },
  );
}

export async function readProfileCandidates(client, studentId) {
  if (
    !client
    || typeof client.query !== 'function'
    || typeof studentId !== 'string'
    || !/^\d{6,20}$/.test(studentId)
  ) {
    throw unavailable();
  }

  assertRequestActive();

  let rows;

  try {
    rows = await client.query(
      `SELECT * FROM \`个人主页（编辑版）\` WHERE \`学号\` = '${studentId}' LIMIT 3`,
    );
  } catch (error) {
    assertRequestActive();
    throw unavailable(error);
  }

  assertRequestActive();

  if (
    !Array.isArray(rows)
    || rows.length > 3
    || rows.readMeta?.truncated
  ) {
    throw unavailable();
  }

  const seen = new Set();

  for (const row of rows) {
    if (
      !row
      || typeof row !== 'object'
      || Array.isArray(row)
      || typeof row._id !== 'string'
      || !row._id.trim()
      || seen.has(row._id)
      || String(row['学号'] ?? '').trim() !== studentId
    ) {
      throw unavailable();
    }

    seen.add(row._id);
  }

  return rows;
}

/**
 * 按学号批量取回资料候选，避免逐行查询把岗位名单放大成同样多的往返。
 *
 * 与 `readProfileCandidates` 一样只返回精确命中该学号的行；任一批次不可用
 * 时该批次返回空 Map，由调用方决定是否继续（岗位名单退化为不补充资料）。
 */
export async function readProfileCandidatesByIds(client, studentIds, {batchSize = 50} = {}) {
  const unique = [...new Set(studentIds.filter(id => typeof id === 'string' && /^\d{6,20}$/.test(id)))];
  const found = new Map();
  if (!unique.length) return found;
  if (!client || typeof client.query !== 'function') return found;

  for (let offset = 0; offset < unique.length; offset += batchSize) {
    const batch = unique.slice(offset, offset + batchSize);
    const list = batch.map(id => `'${id}'`).join(',');
    let rows;
    // 与逐条查询一致：读取不可确认就整体失败，绝不用半份资料渲染名单。
    try {
      rows = await client.query(
        `SELECT * FROM \`个人主页（编辑版）\` WHERE \`学号\` IN (${list}) LIMIT ${batch.length * 10 + 10}`,
      );
    } catch (error) {
      assertRequestActive();
      throw unavailable(error);
    }
    if (!Array.isArray(rows) || rows.readMeta?.truncated) throw unavailable();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row._id !== 'string' || !row._id.trim()) throw unavailable();
      const key = String(row['学号'] ?? '').trim();
      if (!key || !batch.includes(key)) throw unavailable();
      const bucket = found.get(key);
      if (bucket) bucket.push(row);
      else found.set(key, [row]);
    }
  }
  return found;
}