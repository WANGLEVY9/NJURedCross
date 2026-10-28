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

  const collect = (batch, limit) => {
    rows.push(...batch);

    if (batch.readMeta?.truncated) {
      truncated = true;
      return false;
    }

    // 短页即表尾：后续页不存在，停止。
    return batch.length >= limit;
  };

  // 跨境读取每次往返几百毫秒，串行翻页会把往返次数直接叠加到墙钟时间上。
  // 这里按自适应波次并发取页（1→2→4→…），仍按偏移顺序校验与拼接，遇到短页即停；
  // 波次末尾多取的那几页只是丢弃，不会增加等待时间。
  const concurrency = () => {
    const raw = Number(process.env.PLATFORM_PAGED_READ_CONCURRENCY);
    return Number.isSafeInteger(raw) && raw >= 1 && raw <= 16 ? raw : 8;
  };

  {
    const limit = Math.min(pageSize, maxRows);
    const batch = await page(0, limit);
    let running = collect(batch, limit);

    let wave = 1;
    while (running && rows.length < maxRows) {
      const offsets = [];
      for (let index = 0; index < wave; index += 1) {
        const start = rows.length + index * pageSize;
        if (start >= maxRows) break;
        offsets.push(start);
      }
      if (!offsets.length) break;

      const pages = await Promise.all(offsets.map(start => page(start, Math.min(pageSize, maxRows - start))));
      for (const [index, batchRows] of pages.entries()) {
        running = collect(batchRows, Math.min(pageSize, maxRows - offsets[index]));
        if (!running) break;
      }
      wave = Math.min(wave * 2, concurrency());
    }

    if (running && rows.length === maxRows) {
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