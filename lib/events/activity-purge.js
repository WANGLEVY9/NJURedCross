/**
 * 取消活动时的痕迹清理。
 *
 * 2026-11-14 定案：活动负责人**随时可以取消活动**，不再因为「已经有人报名」
 * 被迫降级成「提前结束」。取消即彻底删除，该活动名下的一切参与痕迹一并清除。
 *
 * 为什么必须一次删干净：报名行被签到表、时长明细表的 `报名行ID` 引用。
 * 只删报名不删签到，时长统计会指向不存在的报名；只删明细不重算汇总，
 * 成员主页的志愿时长会停在旧值。反过来，先把引用方删掉再删报名行，
 * 任何一步失败重试都是幂等的（按活动 ID 重新查，查不到就跳过）。
 */
import { deleteRows as defaultDeleteRows } from '../http/batch-write.js';

/** 需要按「活动 → 报名 → 签到 / 时长」顺序清理的表。 */
export const PURGE_TABLES = Object.freeze({
  ledger: '网站服务时长明细表',
  checkins: '网站活动签到表',
  registrations: '网站活动报名总表',
  wishlist: '网站献血车心愿清单',
  notifications: '网站报名通知任务表',
});

/** 从活动行里收集所有可能出现在参与记录上的活动 ID（含源活动映射）。 */
export function activityIdSet(events = [], extra = []) {
  const ids = new Set();
  const add = (value) => {
    const text = String(value ?? '').trim();
    if (text) ids.add(text);
  };
  for (const event of Array.isArray(events) ? events : []) add(event?.['活动ID']);
  for (const value of Array.isArray(extra) ? extra : []) add(value);
  return ids;
}

const inSet = (set, value) => {
  const text = String(value ?? '').trim();
  return Boolean(text) && set.has(text);
};

/**
 * 纯函数：算出每个表里该删哪些行。
 *
 * 传进来的行必须是**全表**（不是已裁剪的展示投影），否则会漏掉跨活动的
 * 源活动映射行。判定以活动 ID 为主键，签到 / 时长再补一层 `报名行ID`、
 * `签到行ID` 兜底，避免历史数据里活动 ID 缺失时留下孤儿。
 */
export function collectActivityRecords({
  activityIds = [], registrations = [], checkins = [], ledger = [],
  wishlist = [], notifications = [],
} = {}) {
  const ids = activityIds instanceof Set ? activityIds : activityIdSet([], activityIds);
  if (!ids.size) {
    return { ledger: [], checkins: [], registrations: [], wishlist: [], notifications: [], totals: emptyTotals() };
  }

  const matchedRegistrations = (Array.isArray(registrations) ? registrations : [])
    .filter((row) => inSet(ids, row?.['活动ID']));
  const registrationIds = new Set(matchedRegistrations.map((row) => String(row?._id ?? '')).filter(Boolean));

  const matchedCheckins = (Array.isArray(checkins) ? checkins : [])
    .filter((row) => inSet(ids, row?.['活动ID']) || inSet(registrationIds, row?.['报名行ID']));
  const checkinIds = new Set(matchedCheckins.map((row) => String(row?._id ?? '')).filter(Boolean));

  const matchedLedger = (Array.isArray(ledger) ? ledger : [])
    .filter((row) => inSet(ids, row?.['活动ID'])
      || inSet(registrationIds, row?.['报名行ID'])
      || inSet(checkinIds, row?.['签到行ID']));

  const matchedWishlist = (Array.isArray(wishlist) ? wishlist : [])
    .filter((row) => inSet(ids, row?.['活动ID']));

  const matchedNotifications = (Array.isArray(notifications) ? notifications : [])
    .filter((row) => inSet(ids, row?.['活动ID']));

  const plan = {
    ledger: matchedLedger,
    checkins: matchedCheckins,
    registrations: matchedRegistrations,
    wishlist: matchedWishlist,
    notifications: matchedNotifications,
  };
  return { ...plan, totals: totalsOf(plan) };
}

function emptyTotals() {
  return { ledger: 0, checkins: 0, registrations: 0, wishlist: 0, notifications: 0, hours: 0 };
}

function totalsOf(plan = {}) {
  const count = (key) => (Array.isArray(plan[key]) ? plan[key].length : 0);
  // 只有已入账 / 已批准的时长会进汇总；把「将被扣回的时长」算出来给确认弹窗看。
  const hours = (Array.isArray(plan.ledger) ? plan.ledger : [])
    .filter((row) => ['已入账', '已批准'].includes(String(row?.['状态'] ?? '')))
    .reduce((sum, row) => sum
      + (Number(row?.['服务时长']) || 0)
      + (Number(row?.['培训时长']) || 0)
      + (Number(row?.['交通时长']) || 0), 0);
  return { ledger: count('ledger'), checkins: count('checkins'), registrations: count('registrations'), wishlist: count('wishlist'), notifications: count('notifications'), hours: Math.round(hours * 100) / 100 };
}

/**
 * 执行删除。按 `PURGE_TABLES` 的声明顺序（叶子 → 根）逐表批量删，
 * 单表失败直接抛出，交由调用方决定是否重试；已删掉的表再跑一次是空操作。
 */
export async function purgeActivityRecords({ client, plan, deleteRows = defaultDeleteRows } = {}) {
  if (!client) throw Object.assign(new Error('清理报名记录缺少数据源。'), { statusCode: 503, code: 'activity_purge_unavailable' });
  if (!plan || typeof plan !== 'object') throw new TypeError('清理计划无效。');

  // 明细删掉后汇总表 / 个人主页表会停在旧值：把受影响的账号带回给调用方，
  // 由它排队重算，否则学生主页的志愿时长会比实际多一截。
  const accounts = new Set();
  for (const row of Array.isArray(plan.ledger) ? plan.ledger : []) {
    const id = String(row?.['账号ID'] ?? '').trim();
    if (id) accounts.add(id);
  }

  const result = emptyTotals();
  result.hours = plan.totals?.hours || 0;

  for (const [key, table] of Object.entries(PURGE_TABLES)) {
    const rowIds = (Array.isArray(plan[key]) ? plan[key] : [])
      .map((row) => String(row?._id ?? ''))
      .filter(Boolean);
    result[key] = 0;
    if (!rowIds.length) continue;
    await deleteRows(client, table, rowIds);
    result[key] = rowIds.length;
  }
  return { ...result, accounts: [...accounts] };
}
