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