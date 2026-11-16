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
 *   · **没有可用负责人的活动转交平台超管**（2026-11-15 用户要求）：负责人未配置、
 *     账号停用、邮箱未验证或地址非法时，待办不能就这么掉在地上，改投给
 *     `role === 'super_admin'` 且邮箱可用的账号，并在正文标出「未配置可用负责人」。
 *     连超管都取不到可用邮箱时才记入 stats，由服务端告警。
 *   · 只统计**还能动手**的活动：状态为 报名中 / 进行中。已结束、已归档、草稿、
 *     待审核的活动即使残留待筛选报名也不提醒（那是历史账，不是今天的待办）。
 *   · 一条报名只算一件事：请假待审批时算「待审批请假」，不再重复计入「待确认报名」
 *     ——因为 `decideLeave` 之前业务上不允许处理这条报名的录取结果。
 *   · **签到待核验**（2026-11-15 用户要求并入）：学生已上传现场照片、负责人还没核验
 *     的报名。判据是「有 `签到照片ID` + 没有 `签到行ID`」，而不是工作台那套
 *     「有照片 + 没时长记录」——后者会把「已核验、只是还没录时长」重复算成待核验。
 *     请假已批准的不用核验，跳过。
 *   · **时长表待提交**（同上并入）：项目已全面结束报名、名单也全部处理完（只差
 *     点一下提交），负责人还没把整份时长表交给主席团。这是**项目级**状态（多个
 *     班次共用一份表），所以按 `activityProjectKey` 去重、只在代表班次上出一条。
 *     已经提交/已导出/已归档的项目不再提醒；空名单项目也不提醒——没有人就没有
 *     表可交。还有人在待处理时也不提醒，那属于「时长没录完」，不是待提交。
 *   · **同名活动合并成一条**：献血周这类活动组是按班次建行的，一个活动组会有
 *     四五个「活动ID」。按 ID 逐条列会让负责人收到五条同名待办，所以按活动名称
 *     归并，条数用「共 N 个班次」表达。
 *   · 邮箱必须「启用 + 已验证 + 格式合法」才发；这是在平台账号表里能核实的最小集合，
 *     与活动审批邮件（lib/events/approval-mail.js）同口径。
 *
 * 这里只做纯计算，不碰 SeaTable / SMTP，便于单测。
 */
import { eventResponsibleIds } from '../../public/app/shared/activity-responsibility.js';
import {
  activityProjectKey,
  projectEventGroups,
  projectEventsFrom,
} from '../../public/app/shared/activity-projects.js';
import { hoursReadiness, supportsHoursSubmission } from '../../public/app/shared/hours-submission.js';
import { isAccountActive } from '../permissions.js';
import { isValidDeliveryEmail, mailRecipient } from '../identity/mail-recipient.js';

/** 会产生待办的活动状态：报名中要处理新报名，进行中要处理请假与遗留报名。 */
export const ACTIVITY_DIGEST_STATUSES = Object.freeze(['报名中', '进行中']);

/**
 * 签到待核验的报名状态。
 *
 * 只有录取（已确认）或已到场的报名才需要负责人核对照片；`已签到` 是核验后的
 * 终态，正常情况下已带 `签到行ID`，会被下面那条判据挡掉。这里保留它是因为
 * 历史数据存在「状态改成已签到但没写签到行」的脏行，交给 `签到行ID` 兜底更准。
 */
export const EVIDENCE_STATUSES = Object.freeze(['已确认', '已签到']);

/** 正文里最多列几个名字，其余折叠成「等 N 人」。 */
export const ACTIVITY_NAME_SAMPLES = 4;
/** 请假条目最多列几条（每条带申请时间，比报名占地方）。 */
const LEAVE_SAMPLES = 3;
/** 时长表可进入提交环节的班次状态：对齐 `submitHoursSheet` 的前置校验。 */
export const HOURS_SHEET_READY_STATUSES = Object.freeze(['进行中', '停点']);
/** 平台超管角色码：账号表「角色」列的取值，缺省是 member。 */
export const SUPERVISOR_ROLE = 'super_admin';
/** 收件人角色标记：待办由超管代处理（不是活动负责人）。 */
export const SUPERVISOR_DIGEST_ROLE = 'activity-supervisor';

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
 * 兜底收件人：平台超管。
 *
 * 这是安全网，不是常规路径。正常情况每个活动都有能收信的负责人：献血车班次
 * 由 `blood-point-owners.js` 按点位归到地区负责人，长期项目在活动流程表里指定。
 * 只有以下情形会退到这里：负责人账号缺失、停用、邮箱未验证、地址非法，
 * 或者新增点位漏配（生成时退回虚拟账号 `njutable-automation`，它没有邮箱）。
 *
 * 存在理由：按「只发负责人」的口径，这些待办会静默消失，请假没人审批也没人知道。
 * 改投超管，由超管决定补负责人还是自己处理。
 *
 * 门槛与负责人一致：账号启用 + 邮箱已验证 + 地址合法。多个超管各收一封，
 * 同地址只算一个。
 */
function supervisorTargets(accounts) {
  const targets = [];
  const seen = new Set();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (text(account?.role) !== SUPERVISOR_ROLE) continue;
    const target = mailTarget(account);
    if (!target) continue;
    const key = target.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
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
 * 按 `活动ID` 建索引。
 *
 * 签到与时长都要「按活动取行」，如果每个项目都重扫一遍全表，171 个活动 ×
 * 1200 条报名就是一亿次比较；先建一次索引，后面全是桶内遍历。
 */
function groupByEvent(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = text(row['活动ID']);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * 签到待核验：学生交了现场照片，负责人还没核验。
 *
 * 判据是「有 `签到照片ID` + 没有 `签到行ID`」。工作台那套「有照片 + 没时长记录」
 * 会把「已核验、只是还没录时长」的人重复算成待核验，负责人对着两个数字会对不上。
 * 请假已批准＝本人不来，没有到场可核验，跳过。
 */
function evidenceByEvent(registrations) {
  const map = new Map();
  for (const row of Array.isArray(registrations) ? registrations : []) {
    const eventId = text(row['活动ID']);
    if (!eventId) continue;
    if (!EVIDENCE_STATUSES.includes(text(row['报名状态']))) continue;
    if (text(row['请假状态']) === '已批准') continue;
    if (!text(row['签到照片ID'])) continue;
    if (text(row['签到行ID'])) continue;
    const list = map.get(eventId);
    if (list) list.push(row);
    else map.set(eventId, [row]);
  }
  return map;
}

/** 活动行里的 `报名页配置`：解析失败按空配置处理，不因为一条脏行丢掉整封提醒。 */
function configOf(row) {
  try {
    const parsed = JSON.parse(row?.['报名页配置'] || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/**
 * 单个活动项目是否「时长表待提交」。
 *
 * 整份时长表是**项目级**的（多个班次共用一份 `hoursSubmission`），所以这里按
 * `activityProjectKey` 的成员行整体判断，并挑一个已进入提交环节的班次作为代表
 * （`anchorId`）——主循环只在代表班次上出条目，避免一个项目提醒四五次。
 *
 * 不提醒的情形：还有班次在报名中（`submitHoursSheet` 会直接拒绝）、已提交、
 * 已归档、最终表已导出、已提交主席团终审、名单为空（没人就没有表可交），
 * 以及还有人没处理完（前端提交按钮此时是灰的）。
 */
function hoursSheetOf(event, groups, registrationsByEvent, ledgerByEvent) {
  const sessions = projectEventsFrom(groups, event)
    .filter((row) => !row.sourceSuperseded)
    // `projectEvents` 会把自动献血车与普通班次混在一个项目里，提交表只针对同类。
    .filter((row) => supportsHoursSubmission(row) === supportsHoursSubmission(event));
  if (sessions.some((row) => text(row['状态']) === '报名中')) return null;
  const anchor = sessions.find((row) => HOURS_SHEET_READY_STATUSES.includes(text(row['状态'])));
  if (!anchor) return null;
  const config = configOf(anchor);
  if (config.bloodWeekArchive) return null;
  if (config.finalHours?.status === 'exported') return null;
  if (config.runningReview?.status === 'submitted') return null;
  const submission = anchor.hoursSubmission || { revision: 0, phase: 'draft', absences: {} };
  if (submission.phase === 'submitted') return null;
  const ids = sessions.map((row) => text(row['活动ID'])).filter(Boolean);
  const { required, pending, absent } = hoursReadiness(
    ids.flatMap((id) => registrationsByEvent.get(id) || []),
    ids.flatMap((id) => ledgerByEvent.get(id) || []),
    submission,
  );
  if (!required.length) return null;
  // 还有一个人没处理，前端「提交整份时长表」按钮就是灰的——那属于「时长没录完」，
  // 不是「待提交」。这封邮件只催那种「万事俱备、只差点一下提交」的项目。
  if (pending.length) return null;
  return {
    anchorId: text(anchor['活动ID']),
    people: required.length,
    absent: absent.length,
    returned: submission.phase === 'returned',
    sessions: sessions.length,
  };
}

/**
 * 全部项目的「时长表待提交」索引。
 *
 * 每个项目只算一次：`projectEventGroups` 已经分好桶，这里按 key 记忆结果，
 * 既避免 O(项目数 × 报名数)，也避免同一项目在不同班次上算出不同结论。
 */
function hoursSheetIndex(events, registrations, ledger) {
  const groups = projectEventGroups(events);
  const registrationsByEvent = groupByEvent(registrations);
  const ledgerByEvent = groupByEvent(ledger);
  const computed = new Map();
  const due = new Map();
  for (const event of events) {
    const key = activityProjectKey(event);
    if (computed.has(key)) continue;
    const info = hoursSheetOf(event, groups, registrationsByEvent, ledgerByEvent);
    computed.set(key, info);
    if (info) due.set(key, info);
  }
  return due;
}

/**
 * 同一个人多班次报名只算一个人。
 *
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
  const evidence = uniquePeople(item.evidence || []);
  const detailLines = [];
  if (review.length) detailLines.push(`待确认报名 ${review.length} 人：${namesOf(review)}`);
  if (leave.length) detailLines.push(`待审批请假 ${leave.length} 条：${leaveNamesOf(leave)}`);
  if (evidence.length) detailLines.push(`签到待核验 ${evidence.length} 人：${namesOf(evidence)}`);
  if (item.sheet) {
    const head = item.sheet.returned ? '时长表被退回，待重新提交' : '待提交时长表';
    const who = item.sheet.absent
      ? `${item.sheet.people} 人已处理完，含缺席 ${item.sheet.absent} 人`
      : `${item.sheet.people} 人已处理完`;
    detailLines.push(`${head}（${who}）`);
  }
  // 只有「无主班次」才写这句话：有负责人的班次不该看到「转交超管」。
  const ownerless = item.ownerlessSessionIds.length;
  if (ownerless) {
    detailLines.push(ownerless === item.sessions.length
      ? '该活动未配置可用负责人，本提醒由平台超管代处理。'
      : `其中 ${ownerless} 个班次未配置可用负责人，本提醒一并转交平台超管。`);
  }
  return {
    id: item.id,
    type: 'activity',
    title: item.title,
    category: item.category,
    status: item.statuses.join('／'),
    schedule: item.schedule,
    sessions: item.sessions,
    counts: {
      review: review.length,
      leave: leave.length,
      evidence: evidence.length,
      hoursSheet: item.sheet ? 1 : 0,
    },
    detailLines,
    ownerless: ownerless > 0,
    waitingSince: item.waitingSince,
  };
}

/**
 * 把在办活动的待办按负责人归集成每人一封。
 *
 * @param {{events?:Array, registrations?:Array, ledger?:Array, accounts?:Array, stats?:object}} input
 *   events        网站活动流程表原始行（中文列名），含报名页配置里的 coOwners
 *                 与 `hoursSubmission`（由 workflow 的 `projectHoursState` 投影）
 *   registrations 网站活动报名总表原始行
 *   ledger        网站志愿时长明细表原始行（签到待核验要用它排除「已核验未录」
 *                 的重复，时长表待提交要用它算「还有几人待处理」）
 *   accounts      平台账号表归一化后的账号对象（accountId / username / email / 收信邮箱 / role）
 *   stats         可选出参：回填 `{overflowEvents, overflow, unownedEvents, unowned}`
 *                 —— overflow＝无可用负责人但已转交超管的活动数/待办数；
 *                 unowned＝连超管都取不到可用邮箱、本次真正没提醒的活动数/待办数
 * @returns {Array<{email:string,name:string,roles:string[],items:Array}>}
 */
export function buildActivityDigest({
  events = [], registrations = [], ledger = [], accounts = [], stats = null,
} = {}) {
  const byAccount = indexAccounts(accounts);
  const pending = pendingByEvent(registrations);
  const evidence = evidenceByEvent(registrations);
  const sheets = hoursSheetIndex(events, registrations, ledger);
  const buckets = new Map();
  const counts = { overflowEvents: 0, overflow: 0, unownedEvents: 0, unowned: 0 };
  // 超管名单惰性求值：绝大多数活动都有负责人，不必为每场活动扫一遍账号表。
  let supervisors = null;
  const supervisorList = () => {
    if (!supervisors) supervisors = supervisorTargets(accounts);
    return supervisors;
  };

  /** 把一场活动的待办投进每个收件人的桶里；同名活动合并成一条。 */
  const deliver = ({ targets, ownerless, title, category, status, session, group, evidence: needEvidence, sheet }) => {
    const role = ownerless ? SUPERVISOR_DIGEST_ROLE : 'activity-owner';
    for (const target of targets) {
      const key = target.email.toLowerCase();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { email: target.email, name: target.name, roles: [], items: [] };
        buckets.set(key, bucket);
      }
      if (!bucket.name && target.name) bucket.name = target.name;
      if (!bucket.roles.includes(role)) bucket.roles.push(role);

      // 同名活动（活动组按班次建行时会出现四五个活动ID）合并成一条待办。
      const itemKey = `ACT-${title}`;
      let item = bucket.items.find((existing) => existing.id === itemKey);
      if (!item) {
        item = {
          id: itemKey, title, category,
          statuses: [], sessions: [], schedule: '',
          review: [], leave: [], evidence: [], sheet: null, waitingSince: '',
          ownerlessSessionIds: [],
        };
        bucket.items.push(item);
      }
      if (!item.statuses.includes(status)) item.statuses.push(status);
      if (!item.sessions.some((row) => row.id === session.id)) item.sessions.push(session);
      if (ownerless && !item.ownerlessSessionIds.includes(session.id)) {
        item.ownerlessSessionIds.push(session.id);
      }
      item.review.push(...group.review);
      item.leave.push(...group.leave);
      item.evidence.push(...needEvidence);
      // 时长表是项目级的，一个项目只会投一次；同名不同项目时才需要保留第一份。
      if (sheet && !item.sheet) item.sheet = sheet;
      item.waitingSince = earliest([
        item.waitingSince,
        ...group.review.map((row) => text(row['创建时间'])),
        ...group.leave.map((row) => text(row['请假申请时间'])),
        ...needEvidence.map((row) => text(row['签到提交时间'])),
      ]);
    }
  };

  for (const event of events) {
    const eventId = text(event['活动ID']);
    if (!eventId) continue;
    const status = text(event['状态']);
    const live = ACTIVITY_DIGEST_STATUSES.includes(status);
    // 时长表只看项目成员状态，不看这一行自己的状态：代表班次可能是「停点」。
    const sheet = sheets.get(activityProjectKey(event));
    const sheetHere = sheet && sheet.anchorId === eventId ? sheet : null;
    if (!live && !sheetHere) continue;

    const group = live ? (pending.get(eventId) || { review: [], leave: [] }) : { review: [], leave: [] };
    const needEvidence = live ? (evidence.get(eventId) || []) : [];
    if (!group.review.length && !group.leave.length && !needEvidence.length && !sheetHere) continue;

    const slice = {
      title: text(event['活动名称']) || '未命名活动',
      category: text(event['活动类别']),
      status,
      session: { id: eventId, date: text(event['报名日期']), slot: trimSeconds(event['报名时段']) },
      group,
      evidence: needEvidence,
      sheet: sheetHere,
    };
    const pendingCount = group.review.length + group.leave.length + needEvidence.length + (sheetHere ? 1 : 0);

    const targets = eventResponsibleIds(event)
      .map((id) => mailTarget(byAccount.get(id)))
      .filter(Boolean);
    if (targets.length) {
      deliver({ ...slice, targets, ownerless: false });
      continue;
    }

    // 负责人缺失或邮箱不可用：不猜、也不发到未验证地址，统一转交平台超管。
    // 献血车班次正常已按点位归到真人负责人，走到这里说明该点位漏配、账号不可用，
    // 或活动本身就没指定负责人——都属于需要超管补配置的情况，不能静默吞掉。
    const fallback = supervisorList();
    if (!fallback.length) {
      // 超管也取不到可用邮箱：这次是真没提醒，交给服务端告警。
      counts.unownedEvents += 1;
      counts.unowned += pendingCount;
      continue;
    }
    counts.overflowEvents += 1;
    counts.overflow += pendingCount;
    deliver({ ...slice, targets: fallback, ownerless: true });
  }

  if (stats) Object.assign(stats, counts);

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
