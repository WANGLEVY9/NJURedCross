const PAGE_SIZE = 500;
const MAX_SCAN_ROWS = 100000;

export const identifier = value => `\`${String(value).replaceAll('`', '``')}\``;

export function timestampOf(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const text = String(value).trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (local) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = local;
    const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const at = Date.parse(normalized + '+08:00');
    if (!Number.isFinite(at) || new Date(at + 8 * 3600000).toISOString().slice(0, 19) !== normalized) return null;
    return at;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? at : null;
}

async function countRows(base, table) {
  const rows = await base.query(`SELECT COUNT(*) AS total FROM ${identifier(table)}`);
  const raw = rows?.[0]?.total;
  const count = Number(raw);
  if (!Array.isArray(rows) || rows.length !== 1 || raw == null
    || rows.readMeta?.truncated || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Incomplete count for ${table}`);
  }
  return count;
}

export async function readExpiredRows(base, rule, cutoff, maxDeletions) {
  const total = await countRows(base, rule.table);
  if (total > MAX_SCAN_ROWS) throw new Error(`Retention scan limit exceeded for ${rule.table}`);
  const fields = ['_id', rule.column, ...(rule.expiredOnly ? ['状态'] : [])];
  const seen = new Set();
  const expiredRowIds = [];
  let readCount = 0;
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const limit = Math.min(PAGE_SIZE, total - offset);
    const rows = await base.query(`SELECT ${fields.map(identifier).join(', ')} FROM ${identifier(rule.table)} ORDER BY \`_id\` LIMIT ${limit} OFFSET ${offset}`);
    if (!Array.isArray(rows) || rows.length !== limit || rows.readMeta?.truncated) {
      throw new Error(`Incomplete read for ${rule.table}`);
    }
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row._id !== 'string' || !row._id || seen.has(row._id)) {
        throw new Error(`Invalid retention row for ${rule.table}`);
      }
      seen.add(row._id);
      readCount++;
      const at = timestampOf(row[rule.column]);
      if (at === null || at >= cutoff) continue;
      if (rule.expiredOnly && row['状态'] !== '已过期' && row['状态'] !== '已失效') continue;
      if (expiredRowIds.length < maxDeletions) expiredRowIds.push(row._id);
    }
    if (expiredRowIds.length === maxDeletions) break;
  }
  if (await countRows(base, rule.table) !== total) throw new Error(`Retention table changed during scan: ${rule.table}`);
  return { expiredRowIds, expiredCount: expiredRowIds.length, readCount, totalCount: total,
    capped: expiredRowIds.length === maxDeletions, scanComplete: readCount === total };
}
