import { assertRequestActive } from '../http/request-budget.js';

/** Identity tables and columns allowed in targeted SQL lookups. */
const IDENTITY_LOOKUP_TABLES = new Set([
  '平台账号表',
  '账号关联表',
  '邮箱验证码表',
]);
const IDENTITY_LOOKUP_FIELDS = new Set([
  '登录名',
  '邮箱',
  '学号',
  '真实姓名',
  '账号ID',
]);

export function buildIdentityLookupQuery(table, field, value, {
  offset = 0,
} = {}) {
  if (
    !IDENTITY_LOOKUP_TABLES.has(table)
    || !IDENTITY_LOOKUP_FIELDS.has(field)
    || !Number.isSafeInteger(offset)
    || offset < 0
    || offset > 10_000
    || offset % 100 !== 0
  ) {
    throw new TypeError('身份定向查询参数无效。');
  }

  const key = String(value || '').trim().toLowerCase();

  if (!key) return null;

  // Never interpolate quotes, backslashes or control characters.
  if (
    key.length > 160
    || /['"\\`\u0000-\u001f\u007f]/.test(key)
  ) {
    return null;
  }

  return [
    `SELECT * FROM \`${table}\``,
    `WHERE lower(trim(\`${field}\`)) = '${key}'`,
    'ORDER BY `_id`',
    `LIMIT 100 OFFSET ${offset}`,
  ].join(' ');
}

/**
 * Complete targeted read of one identity column value.
 * Returns null when a targeted query is unavailable so callers can keep
 * their existing full-table fallback; throws when a read cannot be trusted.
 */
export async function readIdentityRowsByField(client, table, field, value) {
  const firstQuery = buildIdentityLookupQuery(table, field, value);

  if (firstQuery === null || !client || typeof client.query !== 'function') {
    return null;
  }

  const rows = [];
  const seen = new Set();

  for (let offset = 0; offset <= 10_000; offset += 100) {
    const sql = offset === 0
      ? firstQuery
      : buildIdentityLookupQuery(table, field, value, { offset });

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
}

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