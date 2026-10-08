import { assertRequestActive } from '../http/request-budget.js';

export function buildAccountLookupQuery(value, {
  aliases = false,
  offset = 0,
} = {}) {
  if (
    !Number.isSafeInteger(offset)
    || offset < 0
    || offset > 10_000
    || offset % 100 !== 0
    || typeof aliases !== 'boolean'
  ) {
    throw new TypeError('账号查询参数无效。');
  }

  const key = String(value || '').trim().toLowerCase();

  if (!key) return null;

  // Keep unusual legacy identifiers on the existing lookup path.
  // Never interpolate quotes, backslashes or control characters.
  if (
    key.length > 160
    || /['"\\`\u0000-\u001f\u007f]/.test(key)
  ) {
    return null;
  }

  const fields = aliases
    ? ['登录名', '邮箱', '学号', '真实姓名']
    : ['登录名', '邮箱'];

  const conditions = fields.map(field =>
    `lower(trim(\`${field}\`)) = '${key}'`,
  );

  return [
    'SELECT * FROM `平台账号表`',
    `WHERE (${conditions.join(' OR ')})`,
    'ORDER BY `_id`',
    `LIMIT 100 OFFSET ${offset}`,
  ].join(' ');
}
function unavailable() {
  return Object.assign(
    new Error('账号候选数据无法完整读取，本次查询停止。'),
    { code: 'account_query_unavailable', statusCode: 503 },
  );
}

export async function readAccountCandidates(client, value, {
  aliases = false,
} = {}) {
  const firstQuery = buildAccountLookupQuery(value, { aliases });

  // null explicitly requests the existing compatibility lookup.
  if (
    firstQuery === null
    || !client
    || typeof client.query !== 'function'
  ) {
    return null;
  }

  const rows = [];
  const seen = new Set();

  try {
    for (let offset = 0; offset <= 10_000; offset += 100) {
      const sql = offset === 0
        ? firstQuery
        : buildAccountLookupQuery(value, { aliases, offset });

      assertRequestActive();
      const batch = await client.query(sql);
      assertRequestActive();

      if (
        !Array.isArray(batch)
        || batch.length > 100
        || batch.readMeta?.truncated
      ) {
        throw unavailable();
      }

      for (const row of batch) {
        if (
          !row || typeof row !== 'object' || Array.isArray(row)
          || typeof row._id !== 'string' || !row._id
          || seen.has(row._id)
        ) {
          throw unavailable();
        }

        seen.add(row._id);
        rows.push(row);
      }

      if (rows.length > 10_000) throw unavailable();

      if (batch.length < 100) return rows;
    }

    throw unavailable();
  } catch {
    assertRequestActive();
    throw unavailable();
  }
}