import { assertRequestActive } from '../http/request-budget.js';

// Only these exact subtables and lookup columns may enter a query. No caller
// supplies SQL, operators, identifiers or ordering expressions.
const LOOKUPS = new Map(Object.entries({
  早安晚安名片表: ['名片ID', '账号ID', '审核状态'],
  早安晚安名片修订表: ['修订ID', '名片ID', '账号ID', '审核状态'],
  早安晚安邀约表: ['邀约ID', '名片ID', '发起人账号ID', '收件人账号ID'],
  早安晚安评论表: ['评论ID', '名片ID', '举报状态'],
  早安晚安黑名单表: ['黑名单ID', '账号ID', '状态'],
  早安晚安兴趣标签表: ['标签', '状态'],
  平台账号表: ['账号ID'],
  温暖连接参加表: ['登记ID', '参与者标识', '来源', '项目', '生日月日', '状态'],
  温暖连接投稿表: ['投稿ID', '提交人', '项目', '投递方式', '状态', '计划投递日期'],
  温暖祝福库表: ['投稿ID', '来源投稿人', '状态', '分类'],
  温暖祝福投递表: ['投稿ID', '收件人学号', '收件人标识', '站内状态', '触发日期'],
  温暖祝福举报表: ['举报ID', '投稿ID', '举报人标识'],
  温暖连接黑名单表: ['黑名单ID', '参与者标识', '学号', '状态'],
  温暖连接操作锁表: ['锁键'],
}));

function unavailable() {
  return Object.assign(new Error('内建记录未能完整读取，请稍后重试。'), {
    statusCode: 503, code: 'community_query_unavailable',
  });
}

/** Objects are AND conditions; an array of objects is OR. Arrays of values are IN. */
export async function readCommunityRows(client, table, filter, listRows, { maxRows = 5000 } = {}) {
  const allowed = LOOKUPS.get(table);
  const groups = Array.isArray(filter) ? filter : [filter];
  if (!allowed || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000
    || groups.length > 100 || groups.some(group => !group || !Object.keys(group).length)) {
    throw new TypeError('内建查询范围无效。');
  }
  const conditions = groups.map(group => Object.entries(group).map(([field, input]) => {
    if (!allowed.includes(field)) throw new TypeError('内建查询字段无效。');
    const values = [...new Set((Array.isArray(input) ? input : [input]).map(value => {
      if (typeof value !== 'string') throw new TypeError('内建查询值无效。');
      return value;
    }))];
    return { field, values };
  })).filter(group => group.every(item => item.values.length));
  if (!conditions.length) return [];
  const matches = row => conditions.some(group => group.every(({ field, values }) => values.includes(String(row[field] || ''))));

  // SeaTable's installed query(sql) API has no bind-parameter argument. Keep
  // quotes, escapes and control characters entirely out of SQL. Rare legacy
  // identifiers use a bounded complete compatibility read and exact matching.
  const safe = conditions.every(group => group.every(({ values }) => values.every(value =>
    value.length > 0 && value.length <= 200 && !/['"\\`\u0000-\u001f\u007f]/.test(value))));
  if (!safe || typeof client?.query !== 'function') {
    assertRequestActive();
    const rows = await listRows(client, table, { maxRows, requireComplete: true });
    assertRequestActive();
    if (!Array.isArray(rows) || rows.readMeta?.truncated || rows.length > maxRows) throw unavailable();
    return rows.filter(matches);
  }

  // Bound IN batches without broadening the predicate. Recombine by row ID.
  const large = conditions.flatMap((group, groupIndex) => group.map((item, itemIndex) => ({ ...item, groupIndex, itemIndex })))
    .find(item => item.values.length > 100);
  if (large) {
    const merged = new Map();
    for (let start = 0; start < large.values.length; start += 100) {
      const sliced = conditions.map(group => Object.fromEntries(group.map(item => [item.field, item.values])));
      sliced[large.groupIndex][large.field] = large.values.slice(start, start + 100);
      for (const row of await readCommunityRows(client, table, sliced, listRows, { maxRows })) {
        merged.set(row._id, row);
        if (merged.size > maxRows) throw unavailable();
      }
    }
    return [...merged.values()];
  }
  const where = conditions.map(group => '(' + group.map(({ field, values }) =>
    '`' + field + '` IN (' + values.map(value => "'" + value + "'").join(',') + ')').join(' AND ') + ')').join(' OR ');
  const rows = [], seen = new Set();
  try {
    for (let offset = 0; offset <= maxRows;) {
      const limit = Math.min(100, maxRows + 1 - offset);
      assertRequestActive();
      const batch = await client.query('SELECT * FROM `' + table + '` WHERE ' + where
        + ' ORDER BY `_id` LIMIT ' + limit + ' OFFSET ' + offset);
      assertRequestActive();
      if (!Array.isArray(batch) || batch.length > limit || batch.readMeta?.truncated) throw unavailable();
      for (const row of batch) {
        if (!row || typeof row._id !== 'string' || !row._id || seen.has(row._id) || !matches(row)) throw unavailable();
        seen.add(row._id);
        rows.push(row);
      }
      if (rows.length > maxRows) throw unavailable();
      if (batch.length < limit) return rows;
      offset += batch.length;
    }
    throw unavailable();
  } catch {
    assertRequestActive();
    // A failed targeted read must never silently become a full-table scan.
    throw unavailable();
  }
}
