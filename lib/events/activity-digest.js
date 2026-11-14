/**
 * 活动待办汇总（每日 08:00 / 20:00）——活动侧。
 *
 * 背景：2026-11-11 起宣传审核改用「每日 08:00 / 20:00 各一封汇总」，不再逐条发信。
 * 2026-11-14 用户要求把**活动报名**与**活动请假**也并入同一封：到点只提醒一次，
 * 谁该动手谁收到，不按操作次数发信。
 *
 * 口径：
 *   · 收件人 = 该活动的负责人（`负责人账号ID` + 报名页配置里的 `coOwners`）。
 *     地区负责人/主席团按 `assertRegistrar` 也能处理，但不在这里广播——汇总邮件
 *     的目标是「这个活动归谁」，把整个地区拉进收件人只会制造噪音。
 *     与 `hoursRecipient`（负责人附件邮件）取同一份人。
 *   · 只统计**还能动手**的活动：状态为 报名中 / 进行中。已结束、已归档、草稿、
 *     待审核的活动即使残留待筛选报名也不提醒（那是历史账，不是今天的待办）。
 *   · 一条报名只算一件事：请假待审批时算「待审批请假」，不再重复计入「待确认报名」
 *     ——因为 `decideLeave` 之前业务上不允许处理这条报名的录取结果。
 *   · **同名活动合并成一条**：献血周这类活动组是按班次建行的，一个活动组会有
 *     四五个「活动ID」。按 ID 逐条列会让负责人收到五条同名待办，所以按活动名称
 *     归并，条数用「共 N 个班次」表达。
 *   · 邮箱必须「启用 + 已验证 + 格式合法」才发；这是在平台账号表里能核实的最小集合，
 *     与活动审批邮件（lib/events/approval-mail.js）同口径。
 *
 * 这里只做纯计算，不碰 SeaTable / SMTP，便于单测。
 */
import { eventResponsibleIds } from '../../public/app/shared/activity-responsibility.js';
import { isAccountActive } from '../permissions.js';
import { isValidDeliveryEmail, mailRecipient } from '../identity/mail-recipient.js';

/** 会产生待办的活动状态：报名中要处理新报名，进行中要处理请假与遗留报名。 */
export const ACTIVITY_DIGEST_STATUSES = Object.freeze(['报名中', '进行中']);

/** 正文里最多列几个名字，其余折叠成「等 N 人」。 */
export const ACTIVITY_NAME_SAMPLES = 4;
/** 请假条目最多列几条（每条带申请时间，比报名占地方）。 */
const LEAVE_SAMPLES = 3;

const HOUR_MS = 60 * 60 * 1000;
const pad2 = (value) => String(value).padStart(2, '0');
const text = (value) => String(value ?? '').trim();

/**
 * UTC ISO → 北京时间 `MM-DD HH:mm`。
 *
 * 请假申请时间由 `workflow.js` 的 `at()` 写成 `toISOString()`（UTC），直接展示会
 * 差 8 小时。服务器 TZ 是 UTC，也不能靠本地时区换算。
 */
export function beijingTimeLabel(value) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const shifted = new Date(at + 8 * HOUR_MS);
  return `${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())} `
    + `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}

/** `06:30:00-09:30:00` → `06:30-09:30`：班次时段里的秒是噪音。 */
function trimSeconds(value) {
  return text(value).replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1');
}

/** 账号索引：账号ID 与登录名都可作为「负责人账号ID」的取值（与审批邮件一致）。 */
function indexAccounts(accounts) {
  const map = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    for (const key of [text(account?.accountId), text(account?.username)]) {
      if (key && !map.has(key)) map.set(key, account);
    }
  }
  return map;
}

/** 负责人账号 → 投递地址；停用、未验证、地址非法一律不发。 */
function mailTarget(account) {
  if (!account || !isAccountActive(account)) return null;
  if (account.emailVerified !== true) return null;
  const email = mailRecipient(account);
  if (!isValidDeliveryEmail(email)) return null;
  return {
    email,
    name: text(account.realName) || text(account.label) || '',
  };
}

/**
 * 报名行 → 按活动分组的待办。
 *
 * 请假待审批优先：`decideLeave` 之后才允许处理录取结果，所以同一条报名若同时是
 * 「待筛选 + 请假待审批」，负责人这一轮真正要做的是批请假。
 */
function pendingByEvent(registrations) {
  const map = new Map();
  for (const row of Array.isArray(registrations) ? registrations : []) {
    const eventId = text(row['活动ID']);
    if (!eventId) continue;
    const status = text(row['报名状态']);
    const leave = text(row['请假状态']);
    const group = map.get(eventId) || { review: [], leave: [] };
    if (leave === '待审批' && ['待筛选', '已确认'].includes(status)) group.leave.push(row);
    else if (status === '待筛选') group.review.push(row);
    else continue;
    map.set(eventId, group);
  }
  return map;
}

/**
 * 同一个人多班次报名只算一个人。
 * 合并班次后，一条待办里会混进「同一人报了 3 个班次」的记录；按行数写
 * 「22 人」而正文只能列出 20 个名字，会自相矛盾。这里按 学号（缺失时回退
 * 姓名/报名ID）去重，计数与列名用同一份口径。
 */
function uniquePeople(rows) {
  const seen = new Set();
  const people = [];
  for (const row of rows) {
    const key = text(row['学号']) || text(row['姓名']) || text(row['报名ID']);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    people.push(row);
  }
  return people;
}

function namesOf(rows, limit = ACTIVITY_NAME_SAMPLES) {
  const names = uniquePeople(rows).map((row) => text(row['姓名']) || '未填姓名');
  if (names.length <= limit) return names.join('、');
  return `${names.slice(0, limit).join('、')} 等 ${names.length} 人`;
}

function leaveNamesOf(rows) {
  const head = rows.slice(0, LEAVE_SAMPLES).map((row) => {
    const at = beijingTimeLabel(row['请假申请时间']);
    return `${text(row['姓名']) || '未填姓名'}${at ? `（${at} 申请）` : ''}`;
  });
  if (rows.length <= LEAVE_SAMPLES) return head.join('、');
  return `${head.join('、')} 等 ${rows.length} 条`;
}

function earliest(values) {
  let best = '';
  for (const value of values) {
    if (!value) continue;
    if (!best || Date.parse(value) < Date.parse(best)) best = value;
  }
  return best;
}

/** 班次描述：单班次给完整时段，多班次给日期区间 + 班次数。 */
function scheduleOf(sessions) {
  const slots = [...new Set(sessions.map((session) => session.slot).filter(Boolean))];
  const dates = [...new Set(sessions.map((session) => session.date).filter(Boolean))].sort();
  if (sessions.length <= 1) return [dates[0] || '', slots[0] || ''].filter(Boolean).join(' ');
  if (dates.length === 1) return `${dates[0]} 共 ${sessions.length} 个班次`;
  if (dates.length > 1) return `${dates[0]}–${dates[dates.length - 1]} 共 ${sessions.length} 个班次`;
  return `共 ${sessions.length} 个班次`;
}

/** 合并后的活动条目：明细行在最后一次性算出来，正文只负责排版。 */
function finalizeItem(item) {
  const review = uniquePeople(item.review);
  const leave = uniquePeople(item.leave);
  const detailLines = [];
  if (review.length) detailLines.push(`待确认报名 ${review.length} 人：${namesOf(review)}`);
  if (leave.length) detailLines.push(`待审批请假 ${leave.length} 条：${leaveNamesOf(leave)}`);
  return {
    id: item.id,
    type: 'activity',
    title: item.title,
    category: item.category,
    status: item.statuses.join('／'),
    schedule: item.schedule,
    sessions: item.sessions,
    counts: { review: review.length, leave: leave.length },
    detailLines,
    waitingSince: item.waitingSince,
  };
}

/**
 * 把在办活动的待办按负责人归集成每人一封。
 *
 * @param {{events?:Array, registrations?:Array, accounts?:Array, stats?:object}} input
 *   events        网站活动流程表原始行（中文列名），含报名页配置里的 coOwners
 *   registrations 网站活动报名总表原始行
 *   accounts      平台账号表归一化后的账号对象（accountId / username / email / 收信邮箱）
 *   stats         可选出参：回填 `{unownedEvents, unowned}`，表示「有待办但没有可用
 *                 负责人邮箱」的活动数与待办条数（供服务端告警，不阻塞发信）
 * @returns {Array<{email:string,name:string,roles:string[],items:Array}>}
 */
export function buildActivityDigest({
  events = [], registrations = [], accounts = [], stats = null,
} = {}) {
  const byAccount = indexAccounts(accounts);
  const pending = pendingByEvent(registrations);
  const buckets = new Map();

  for (const event of events) {
    const eventId = text(event['活动ID']);
    if (!eventId) continue;
    if (!ACTIVITY_DIGEST_STATUSES.includes(text(event['状态']))) continue;
    const group = pending.get(eventId);
    if (!group) continue;

    const targets = eventResponsibleIds(event)
      .map((id) => mailTarget(byAccount.get(id)))
      .filter(Boolean);
    if (!targets.length) {
      // 负责人缺失或邮箱不可用：不猜，也不发到未验证地址。
      // 献血车班次的「负责人」是 njutable-automation（虚拟账号），必然落进这里——
      // 那些待办归地区管理页处理，本汇总不覆盖，用 stats 让服务端把数量记进日志。
      if (stats) {
        stats.unownedEvents += 1;
        stats.unowned += group.review.length + group.leave.length;
      }
      continue;
    }

    const title = text(event['活动名称']) || '未命名活动';
    const category = text(event['活动类别']);
    const status = text(event['状态']);
    const session = { id: eventId, date: text(event['报名日期']), slot: trimSeconds(event['报名时段']) };

    for (const target of targets) {
      const key = target.email.toLowerCase();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { email: target.email, name: target.name, roles: [], items: [] };
        buckets.set(key, bucket);
      }
      if (!bucket.name && target.name) bucket.name = target.name;
      if (!bucket.roles.includes('activity-owner')) bucket.roles.push('activity-owner');

      // 同名活动（活动组按班次建行时会出现四五个活动ID）合并成一条待办。
      const itemKey = `ACT-${title}`;
      let item = bucket.items.find((existing) => existing.id === itemKey);
      if (!item) {
        item = {
          id: itemKey, title, category,
          statuses: [], sessions: [], schedule: '',
          review: [], leave: [], waitingSince: '',
        };
        bucket.items.push(item);
      }
      if (!item.statuses.includes(status)) item.statuses.push(status);
      if (!item.sessions.some((row) => row.id === session.id)) item.sessions.push(session);
      item.review.push(...group.review);
      item.leave.push(...group.leave);
      item.waitingSince = earliest([
        item.waitingSince,
        ...group.review.map((row) => text(row['创建时间'])),
        ...group.leave.map((row) => text(row['请假申请时间'])),
      ]);
    }
  }

  const recipients = [];
  for (const bucket of buckets.values()) {
    const items = bucket.items.map((item) => {
      const merged = finalizeItem(item);
      merged.schedule = scheduleOf(item.sessions);
      return merged;
    }).sort((a, b) => String(a.waitingSince).localeCompare(String(b.waitingSince)));
    recipients.push({ ...bucket, items });
  }
  return recipients.sort((a, b) => b.items.length - a.items.length || a.email.localeCompare(b.email));
}
