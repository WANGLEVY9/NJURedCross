import { assertRequestActive } from '../http/request-budget.js';

function unavailable() {
  return Object.assign(new Error('邮件发送记录暂不可确认，请稍后重试。'), {
    statusCode: 503,
    code: 'mail_history_unavailable',
  });
}

export async function hasDeliveredMail(client, key, {
  pageSize = 200,
  maxRows = 10_000,
  transport,
  expectedIntent,
} = {}) {
  if (typeof key !== 'string' || !key.trim()) {
    throw new TypeError('必须提供邮件幂等键。');
  }

  if (
    !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > 1000
    || !Number.isSafeInteger(maxRows)
    || maxRows < 1
    || maxRows > 100_000
  ) {
    throw new TypeError('邮件历史读取上限无效。');
  }

  if (
    transport !== undefined
    && !['smtp', 'console'].includes(transport)
  ) {
    throw new TypeError('未知邮件通道。');
  }

  if (
    expectedIntent !== undefined
    && (
      !expectedIntent
      || typeof expectedIntent.to !== 'string'
      || typeof expectedIntent.subject !== 'string'
      || typeof expectedIntent.kind !== 'string'
    )
  ) {
    throw new TypeError('邮件历史核对内容无效。');
  }

  if (!client || typeof client.listRows !== 'function') {
    throw unavailable();
  }

  let count = 0;
  let offset = 0;
  const seen = new Set();

  for (;;) {
    assertRequestActive();

    // Read one extra row when needed to distinguish an exact cap from overflow.
    const limit = Math.min(pageSize, maxRows - count + 1);
    let rows;

    try {
      rows = await client.listRows(
        '邮件发件记录表', '', '', false, offset, limit,
      );
    } catch {
      assertRequestActive();
      throw unavailable();
    }

    assertRequestActive();

    if (
      !Array.isArray(rows)
      || rows.length > limit
      || rows.readMeta?.truncated
    ) {
      throw unavailable();
    }

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw unavailable();
      }

      if (Object.hasOwn(row, '_id')) {
        if (
          typeof row._id !== 'string'
          || !row._id.trim()
          || seen.has(row._id)
        ) {
          throw unavailable();
        }
        seen.add(row._id);
      }
    }

    count += rows.length;
    if (count > maxRows) throw unavailable();

    for (const row of rows) {
      if (
        String(row.幂等键 || '') !== key
        || String(row.状态 || '') !== '已发送'
      ) {
        continue;
      }

      if (transport && row.通道 !== transport) {
        if (!['smtp', 'console'].includes(row.通道)) throw unavailable();
        continue;
      }

      if (expectedIntent && (
        row.收件人 !== expectedIntent.to
        || row.主题 !== expectedIntent.subject.slice(0, 120)
        || row.类型 !== expectedIntent.kind
      )) {
        throw unavailable();
      }

      return true;
    }

    if (rows.length < limit) return false;
    offset += rows.length;
  }
}