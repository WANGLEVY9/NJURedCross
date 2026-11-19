/**
 * 名单审核结果的独立存储。
 *
 * 结果原来塞在「报名页配置」这一个文本单元格里，而 NJUTable 文本列在 10000
 * 字符处静默截断：150 人的活动审核到八成左右就再也写不进去，整份配置从此
 * 不可解析、报名通知整批停发。这里把逐行结果搬进独立表，配置只保留阶段、
 * 版本号等元信息，上限与报名人数彻底脱钩。
 *
 * 表的幂等键是 `报名行ID`，不是 SeaTable 的 `_id`：报名行被重建后仍然对得上。
 */
import { decodeRosterResult, encodeRosterResult } from '../../public/app/shared/roster-review.js';
import { readPagedRows } from '../http/paged-rows.js';

export const ROSTER_RESULT_TABLE = '网站名单审核结果表';
export const ROSTER_RESULT_COLUMNS = [
  '活动ID', '报名行ID', '报名ID', '姓名', '学号',
  '结果', '版本', '说明',
  '暂定决定', '暂定说明',
  '待提交结果', '待提交版本',
  '投递状态', '投递时间', '投递键',
  '更新时间',
];
// 差量比较只看内容列；更新时间每次都会变，参与比较会让每一行都被判定为脏。
const CONTENT_COLUMNS = ROSTER_RESULT_COLUMNS.filter(name => name !== '更新时间');
const RESULT_STATUSES = new Set(['已确认', '已签到', '未入选']);
const DECISIONS = new Set(['confirm', 'reject', 'reset']);

const text = value => (value === undefined || value === null ? '' : String(value));
const sameRow = (left, right) => CONTENT_COLUMNS.every(name => text(left?.[name]) === text(right?.[name]));

/** 配置里只剩元信息；老活动的逐行结果仍然内联在同一个字段里。 */
export function inlineReview(event) {
  try { return JSON.parse(event?.['报名页配置'] || '{}').rosterReview || null; } catch { return null; }
}
export const needsTableReview = meta => Boolean(meta) && meta.results === 'table';
/**
 * 报名行ID → 结果表行 _id。用 Symbol 挂在事件对象上：发信时每封都要落一次投递
 * 回执，有了这张表就不必为每一封再定向查询一次结果表。JSON 序列化会忽略 Symbol，
 * 因此不会渗进接口输出。
 */
export const RESULT_ROW_IDS = Symbol.for('njuredcross.rosterResultRowIds');

/** 把一个报名行的四类审核状态摊平成结果表的一行。 */
export function resultRow(eventId, registrationId, entry, stamp) {
  const { published, draft, target, delivery, registration } = entry;
  return {
    活动ID: text(eventId),
    报名行ID: text(registrationId),
    报名ID: text(registration?.['报名ID']),
    姓名: text(registration?.['姓名']),
    学号: text(registration?.['学号']),
    结果: RESULT_STATUSES.has(published?.status) ? published.status : '',
    版本: text(published?.version),
    说明: text(published?.reason),
    暂定决定: DECISIONS.has(draft?.decision) ? draft.decision : '',
    暂定说明: text(draft?.reason),
    待提交结果: RESULT_STATUSES.has(target?.status) ? target.status : '',
    待提交版本: text(target?.version),
    投递状态: text(delivery?.status),
    投递时间: text(delivery?.sentAt),
    投递键: text(delivery?.key),
    更新时间: stamp,
  };
}

/** 结果表的一行还原成 `published` / `drafts` / `deliveries` / `target` 四个区块。 */
export function reviewSections(rows) {
  const published = {}, drafts = {}, deliveries = {}, target = {};
  for (const row of [...rows].sort((left, right) => text(left['报名行ID']).localeCompare(text(right['报名行ID'])))) {
    const id = text(row['报名行ID']);
    if (!id) continue;
    if (RESULT_STATUSES.has(row['结果']))
      published[id] = { status: row['结果'], version: text(row['版本']), reason: text(row['说明']) };
    if (DECISIONS.has(row['暂定决定']))
      drafts[id] = { decision: row['暂定决定'], reason: text(row['暂定说明']) };
    if (RESULT_STATUSES.has(row['待提交结果']))
      target[id] = encodeRosterResult({ status: row['待提交结果'], version: text(row['待提交版本']) });
    if (row['投递键'])
      deliveries[row['投递键']] = { status: text(row['投递状态']), sentAt: text(row['投递时间']) };
  }
  return { published, drafts, deliveries, target };
}

/**
 * 从 review 收集每行要写的列。deliveries 反查回报名行：投递键由报名行 + 当前
 * 版本推导，同一条报名行只保留当前版本的记录，历史版本的键本来就再也不会被查。
 */
export function desiredRows(event, review, rows) {
  const byId = new Map(rows.filter(row => row?._id).map(row => [row._id, row]));
  const identity = new Map();
  for (const row of rows) if (row?._id && row['报名ID']) identity.set(row['报名ID'], row);
  const stamp = new Date().toISOString();
  const desired = new Map();
  const touch = id => {
    if (!id || !byId.has(id)) return null;
    if (!desired.has(id)) desired.set(id, { registration: byId.get(id), published: null, draft: null, target: null, delivery: null });
    return desired.get(id);
  };
  const add = (id, kind, value) => {
    const entry = touch(id);
    if (entry) entry[kind] = value;
  };
  for (const [id, entry] of Object.entries(review?.published || {}))
    add(id, 'published', entry && typeof entry === 'object' ? entry : decodeRosterResult(entry, byId.get(id)));
  for (const [id, entry] of Object.entries(review?.drafts || {})) add(id, 'draft', entry);
  for (const [id, entry] of Object.entries(review?.target || {}))
    add(id, 'target', typeof entry === 'object' ? entry : decodeRosterResult(entry, byId.get(id)));
  for (const [key, value] of Object.entries(review?.deliveries || {})) {
    // 键里的报名ID 能直接定位报名行，避免再解析一遍 idempotency 结构。
    const id = /^WF-RESULT:([^:]+):/.exec(key)?.[1];
    const registration = identity.get(id);
    if (registration) add(registration._id, 'delivery', { ...value, key });
  }
  const out = new Map();
  for (const [id, entry] of desired)
    out.set(id, resultRow(event['活动ID'], id, entry, stamp));
  return out;
}

/**
 * 写结果表。批量接口可用时一次提交并核对行数，否则逐行写入；两者都由调用方
 * 回读核对，批量失败退回逐行不改变结果。
 */
export function createRosterResultStore({ base, table = ROSTER_RESULT_TABLE, load = null } = {}) {
  const readRows = async eventIds => {
    const ids = [...new Set((eventIds || []).filter(Boolean))];
    if (!ids.length) return [];
    if (load) return load(ids);
    if (typeof base.query === 'function') {
      const rows = [];
      for (let start = 0; start < ids.length; start += 100) {
        const where = ids.slice(start, start + 100).map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
        const batch = await base.query(`SELECT * FROM \`${table}\` WHERE \`活动ID\` IN (${where}) LIMIT 1000`);
        if (!Array.isArray(batch) || batch.readMeta?.truncated) throw new Error('名单审核结果读取失败或数据不完整');
        rows.push(...batch);
      }
      return rows;
    }
    return (await readPagedRows(base, table, { maxRows: 100_000, requireComplete: true }))
      .filter(row => ids.includes(row['活动ID']));
  };
  async function write(changes) {
    const updates = changes.filter(change => change.id), created = changes.filter(change => !change.id);
    const batched = typeof base.batchUpdateRows === 'function' && typeof base.batchAppendRows === 'function';
    if (batched) {
      try {
        for (let start = 0; start < updates.length; start += 100) {
          const chunk = updates.slice(start, start + 100);
          const result = await base.batchUpdateRows(table, chunk.map(change => ({ row_id: change.id, row: change.values })));
          if (result && Array.isArray(result.failed) && result.failed.length) throw new Error('名单审核结果部分写入失败');
        }
        for (let start = 0; start < created.length; start += 100) {
          const chunk = created.slice(start, start + 100);
          const result = await base.batchAppendRows(table, chunk.map(change => change.values));
          const inserted = Number(result?.inserted_row_count);
          if (Number.isFinite(inserted) && inserted !== chunk.length) throw new Error('名单审核结果部分写入失败');
        }
        return;
      } catch { /* 退回逐行写入，语义不变 */ }
    }
    for (const change of updates) await base.updateRow(table, change.id, change.values);
    for (const change of created) {
      const row = await base.appendRow(table, change.values);
      if (!row?._id) throw new Error('名单审核结果写入结果不完整');
    }
  }
  return {
    table,
    load: readRows,
    /** 全量对齐：多退少补，内容未变的行不发写请求。 */
    async commit(event, review, rows) {
      const existing = await readRows([event['活动ID']]);
      const current = new Map();
      for (const row of existing) if (text(row['活动ID']) === text(event['活动ID'])) current.set(text(row['报名行ID']), row);
      const desired = desiredRows(event, review, rows);
      const changes = [];
      const stamp = new Date().toISOString();
      for (const [id, values] of desired) {
        const found = current.get(id);
        if (!found) changes.push({ values });
        else if (!sameRow(found, values)) changes.push({ id: found._id, values });
      }
      // 报名行从结果里消失（撤销暂定、被清理）时清空内容而不是删行：行数上限远大于
      // 一次活动的报名人数，留着空行换掉一次删除请求与一个 SDK 能力依赖更划算。
      for (const [id, row] of current) if (!desired.has(id)) {
        const blank = { 活动ID: text(event['活动ID']), 报名行ID: id, 更新时间: stamp };
        if (!sameRow(row, blank)) changes.push({ id: row._id, values: blank });
      }
      await write(changes);
      return { written: changes.length };
    },
    /** 单行投递状态：发一封信只写这一行，避免整份名单反复重写。 */
    async saveDelivery(event, registrationId, key, entry) {
      const values = { 投递状态: text(entry?.status), 投递时间: text(entry?.sentAt), 投递键: text(key),
        更新时间: new Date().toISOString() };
      const known = event?.[RESULT_ROW_IDS]?.get(String(registrationId));
      if (known) return base.updateRow(table, known, values);
      const rows = await readRows([event['活动ID']]);
      const found = rows.find(row => text(row['报名行ID']) === text(registrationId));
      if (found) return base.updateRow(table, found._id, values);
      return base.appendRow(table, { 活动ID: text(event['活动ID']), 报名行ID: text(registrationId), ...values });
    },
  };
}
