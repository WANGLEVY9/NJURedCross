import { assertRequestActive } from '../http/request-budget.js';

function unavailable() {
  return Object.assign(
    new Error('资料查询结果暂不可确认，已停止自动同步。'),
    {
      statusCode: 503,
      code: 'profile_query_unavailable',
    },
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
  } catch {
    assertRequestActive();
    throw unavailable();
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
    } catch {
      throw unavailable();
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