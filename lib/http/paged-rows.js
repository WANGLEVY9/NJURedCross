import { assertRequestActive } from './request-budget.js';

function unavailable() {
  return Object.assign(
    new Error('数据分页读取失败或返回格式无效。'),
    { statusCode: 503, code: 'paged_read_unavailable' },
  );
}

function incomplete() {
  return Object.assign(
    new Error('数据读取不完整，已停止操作。'),
    { statusCode: 503, code: 'incomplete_operational_data' },
  );
}

export async function readPagedRows(client, table, {
  pageSize = 500,
  maxRows = 5_000,
  requireComplete = false,
} = {}) {
  if (
    !client || typeof client.listRows !== 'function'
    || typeof table !== 'string' || !table.trim()
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1 || pageSize > 1_000
    || !Number.isSafeInteger(maxRows)
    || maxRows < 1 || maxRows > 100_000
    || typeof requireComplete !== 'boolean'
  ) {
    throw new TypeError('分页读取参数无效。');
  }

  const rows = [];
  const seen = new Set();
  let truncated = false;

  async function page(start, limit) {
    assertRequestActive();

    let batch;

    try {
      batch = await client.listRows(
        table, '', '', false, start, limit,
      );
    } catch {
      assertRequestActive();
      throw unavailable();
    }

    assertRequestActive();

    if (!Array.isArray(batch) || batch.length > limit) {
      throw unavailable();
    }

    for (const row of batch) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw unavailable();
      }

      if (Object.hasOwn(row, '_id')) {
        if (
          typeof row._id !== 'string'
          || !row._id
          || seen.has(row._id)
        ) {
          throw unavailable();
        }

        seen.add(row._id);
      }
    }

    return batch;
  }

  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const batch = await page(rows.length, limit);
    rows.push(...batch);

    if (batch.readMeta?.truncated) {
      truncated = true;
      break;
    }

    if (batch.length < limit) break;

    if (rows.length === maxRows) {
      const overflow = await page(rows.length, 1);
      truncated = overflow.length > 0
        || Boolean(overflow.readMeta?.truncated);
    }
  }

  if (requireComplete && truncated) throw incomplete();

  Object.defineProperty(rows, 'readMeta', {
    value: { total: rows.length, truncated, maxRows },
    enumerable: false,
  });

  return rows;
}