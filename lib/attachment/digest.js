/**
 * 宣传审核「待办汇总」邮件（2026-11-11 用户定案）。
 *
 * 背景：旧实现每推进一级就即时发信——退回一次最多 4 封（投稿人 + 对接人 +
 * 美编 + 下一级审核人），一条投稿走完审核链能发出十几封。用户要求改为
 * **集中发送**：早上 8 点、晚上 8 点各汇总一次，不再一个任务一封邮件。
 *
 * 口径（与用户确认）：
 *   · 收件人 = 按审核链「当前环节」定责任人：初审归对接人、复核归审核人、
 *     终审通过后归对接人排期。谁该动手，谁出现在当天那一封里。
 *   · 被退回的投稿**不进**对接人汇总（球在作者脚下）；作者的退回意见仍即时发，
 *     由 lib/attachment/review.js 的 deliverOpinion 负责。
 *   · 该人当天没有待办就不发信——不发「今日无待办」的空邮件。
 *
 * 这里只做纯计算与投递编排，不碰 SeaTable 与 HTTP，便于单测。
 */
import {
  REVIEW_STATUS,
  canSchedule,
  parseReviewTrail,
  submissionKindFor,
} from './store.js';
import { assigneesForCategory, chainStateFor, liaisonCategoryOf } from './review.js';

/** 汇总时点（北京时间，24 小时制）。 */
export const DIGEST_HOURS = Object.freeze([8, 20]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 单封邮件最多列多少条，超出折叠成「另有 N 条」。 */
export const DIGEST_MAX_ITEMS = 30;

const pad2 = (value) => String(value).padStart(2, '0');

/**
 * 判定当前时刻属于哪个汇总时段。
 *
 * 时区固定按 **UTC+8** 换算，不依赖服务器 TZ（生产机是 UTC，直接读
 * `new Date().getHours()` 会整体错 8 小时）。中国无夏令时，纯偏移即可。
 *
 * @returns {{key:string,date:string,hour:number,slot:string,label:string,at:string}|null}
 *   不在 08 点 / 20 点这一小时内返回 null。
 */
export function digestSlot(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const shifted = new Date(now.getTime() + 8 * HOUR_MS);
  const hour = shifted.getUTCHours();
  if (!DIGEST_HOURS.includes(hour)) return null;
  const date = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
  const slot = pad2(hour);
  return {
    key: `${date}-${slot}`,
    date,
    hour,
    slot,
    label: hour < 12 ? '早间汇总' : '晚间汇总',
    at: `${date} ${slot}:00`,
  };
}

/** 投稿行 → 审核状态机形状（与 server.js reviewShapeOf 同口径）。 */
export function digestShapeOf(source = {}) {
  return {
    id: String(source['投稿ID'] || source.id || ''),
    title: String(source['标题'] || source.title || ''),
    category: String(source['类别'] || source.category || ''),
    publishForm: String(source['发布形式'] || source.publishForm || ''),
    reviewLevel: String(source['审核层级'] ?? source.reviewLevel ?? ''),
    reviewTrail: String(source['审核轨迹'] ?? source.reviewTrail ?? ''),
    status: String(source['审核状态'] || source.status || REVIEW_STATUS.pending),
    articleCategory: String(source['推文类别'] || source.articleCategory || ''),
    submitterEmail: String(source['联系邮箱'] || source.contactEmail || ''),
    submittedAt: String(source['提交时间'] || source.submittedAt || ''),
  };
}

/** 最近一次轨迹时间（用于「已等待多久」），没有轨迹就回落到提交时间。 */
function waitingSinceOf(shape, trail = []) {
  const last = trail.length ? trail[trail.length - 1] : null;
  return String(last?.at || shape.submittedAt || '');
}

/** 人话时长：小于 1 小时说「刚刚」，当天说小时，跨天说天数。 */
export function waitingLabel(sinceIso = '', now = new Date()) {
  const at = Date.parse(sinceIso);
  if (!Number.isFinite(at)) return '';
  const gap = Math.max(0, now.getTime() - at);
  if (gap < HOUR_MS) return '刚刚';
  if (gap < DAY_MS) return `已等待 ${Math.floor(gap / HOUR_MS)} 小时`;
  return `已等待 ${Math.floor(gap / DAY_MS)} 天`;
}

function labelOf(shape, category) {
  if (category) return category;
  const kind = submissionKindFor({ category: shape.category, publishForm: shape.publishForm });
  if (kind === 'design') return '文创设计（不挂栏目）';
  return '未登记栏目';
}

/**
 * 按「谁该动手」把当前所有在办投稿归集成每人一封。
 *
 * @param {{rows?:Array, assignees?:Array, publications?:object, now?:Date}} input
 *   rows         宣传投稿表原始行（中文列名）
 *   assignees    宣传对接人表原始行
 *   publications 宣传发布任务表按投稿ID索引的对象；已有排期记录的稿件不再提醒排期
 *   sources      只统计这些「来源」的行，默认公众投稿（既有内容审核结论不产生 v3 待办）
 * @returns {Array<{email:string,name:string,roles:string[],items:Array}>}
 */
export function buildDigest({
  rows = [], assignees = [], publications = {}, now = new Date(),
  sources = ['公众投稿'],
} = {}) {
  const buckets = new Map();

  const addItem = (target, role, item) => {
    const email = String(target?.email || '').trim();
    if (!email || !email.includes('@')) return;
    const key = email.toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { email, name: String(target?.name || ''), roles: [], items: [] };
      buckets.set(key, bucket);
    }
    if (!bucket.name && target?.name) bucket.name = String(target.name);
    if (!bucket.roles.includes(role)) bucket.roles.push(role);
    // 同一条稿件的同一类提醒只保留一条（对接人表可能同人在多行）。
    if (!bucket.items.some((existing) => existing.id === item.id && existing.type === item.type)) {
      bucket.items.push(item);
    }
  };

  for (const row of rows) {
    const shape = digestShapeOf(row);
    if (!shape.id) continue;
    // 同一张表也存「既有内容」的审核结论（来源=遗留内容/策划案…），它们不走 v3 审核链，
    // 没有可执行的待办，不能混进对接人的汇总里。
    const source = String(row['来源'] || '').trim();
    if (source && !sources.includes(source)) continue;
    const status = shape.status || REVIEW_STATUS.pending;
    // 已退回：球在作者脚下，对接人/审核人此刻没有动作要做。
    if (status === REVIEW_STATUS.returned) continue;

    const kind = submissionKindFor({ category: shape.category, publishForm: shape.publishForm });
    const category = liaisonCategoryOf(shape);
    const picked = assigneesForCategory(assignees, category);
    const trail = parseReviewTrail(shape.reviewTrail);

    if (status === REVIEW_STATUS.approved) {
      if (!canSchedule({ kind, reviewLevel: shape.reviewLevel, reviewTrail: shape.reviewTrail, status })) continue;
      // 已有发布任务（含待发布）就不再催排期。
      if (publications && publications[shape.id]) continue;
      addItem(picked.liaison, 'liaison', {
        id: shape.id,
        type: 'schedule',
        title: shape.title || '未命名稿件',
        category: labelOf(shape, category),
        level: 0,
        levelName: '终审已通过，待排期',
        waitingSince: waitingSinceOf(shape, trail),
        waiting: waitingLabel(waitingSinceOf(shape, trail), now),
      });
      continue;
    }

    const state = chainStateFor(shape);
    if (!state.current) continue;
    const role = state.current.role === 'outreach_liaison' ? 'liaison' : 'reviewer';
    const since = waitingSinceOf(shape, trail);
    addItem(picked[role], role, {
      id: shape.id,
      type: 'review',
      title: shape.title || '未命名稿件',
      category: labelOf(shape, category),
      level: state.current.level,
      levelName: state.current.name,
      waitingSince: since,
      waiting: waitingLabel(since, now),
    });
  }

  const rank = (item) => (item.type === 'schedule' ? 1 : 0);
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      items: bucket.items.sort((a, b) => rank(a) - rank(b)
        || (a.level || 0) - (b.level || 0)
        || String(a.waitingSince).localeCompare(String(b.waitingSince))),
    }))
    .sort((a, b) => b.items.length - a.items.length || a.email.localeCompare(b.email));
}

/** 邮件主题：一眼看出几件事、是早报还是晚报。 */
export function digestSubject({ slot, count = 0 } = {}) {
  const label = slot?.label || '待办汇总';
  const at = String(slot?.at || '').slice(5); // MM-DD HH:00
  return `【宣传待办·${label}】${count} 条（${at}）`;
}

/** 纯文本正文：按「初审 / 复核 / 排期」分段，每条一行。 */
export function digestMailText({ recipient = {}, slot = null, baseUrl = '' } = {}) {
  const name = String(recipient.name || '').trim();
  const items = Array.isArray(recipient.items) ? recipient.items : [];
  const review = items.filter((item) => item.type === 'review');
  const schedule = items.filter((item) => item.type === 'schedule');
  const lines = [];
  lines.push(`${name ? `${name}，你好：` : '你好：'}`);
  lines.push('');
  lines.push(`这是南大红会宣传审核的${slot?.label || '待办汇总'}（${slot?.at || ''}），你有 ${items.length} 条待处理。`);

  const section = (title, list) => {
    if (!list.length) return;
    lines.push('', `【${title}】`);
    list.slice(0, DIGEST_MAX_ITEMS).forEach((item, index) => {
      const tail = [item.category ? `栏目：${item.category}` : '', item.waiting].filter(Boolean).join('｜');
      lines.push(`${index + 1}. 《${item.title}》${tail ? `｜${tail}` : ''}`);
      if (item.type === 'review' && item.levelName) lines.push(`   环节：第 ${item.level} 级 · ${item.levelName}`);
    });
    if (list.length > DIGEST_MAX_ITEMS) lines.push(`……另有 ${list.length - DIGEST_MAX_ITEMS} 条，请登录控制台查看。`);
  };

  section('待你审核', review);
  section('待你排期', schedule);

  lines.push('');
  lines.push(`请登录控制台处理：${baseUrl ? `${baseUrl.replace(/\/$/, '')}/console/outreach` : '控制台 → 宣传 → 审核中'}`);
  lines.push('');
  lines.push('说明：宣传审核的待办提醒已改为每日 08:00 与 20:00 各汇总一次，不再随每次操作单独发信。');
  lines.push('——本邮件由南大红会志愿服务平台自动发送，请勿直接回复。');
  return lines.join('\n');
}

/** 收件人角色 → 邮件类型码（供重试白名单与发件记录统计区分）。 */
export function digestKindOf(recipient = {}) {
  const roles = Array.isArray(recipient.roles) ? recipient.roles : [];
  if (roles.includes('liaison') && roles.includes('reviewer')) return 'outreach.digest.mixed';
  if (roles.includes('reviewer')) return 'outreach.digest.reviewer';
  return 'outreach.digest.liaison';
}

/**
 * 逐人投递。幂等键 = 时段 + 邮箱：同一时段重复跑（含进程重启）不会重复发信；
 * 下一时段键变化，会正常再发一封当次汇总。
 */
export async function sendDigest({
  mail, configured = true, recipients = [], slot = null, baseUrl = '',
}) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!configured || typeof mail !== 'function') {
    const reason = configured ? 'mail_not_injected' : 'not_configured';
    return list.map((recipient) => ({ email: recipient.email, count: recipient.items?.length || 0, ok: false, skipped: true, reason }));
  }
  const results = [];
  for (const recipient of list) {
    const subject = digestSubject({ slot, count: recipient.items?.length || 0 });
    try {
      const result = await mail({
        to: recipient.email,
        subject,
        text: digestMailText({ recipient, slot, baseUrl }),
        kind: digestKindOf(recipient),
        idempotencyKey: `outreach-digest-${slot?.key || 'x'}-${String(recipient.email).toLowerCase()}`,
      });
      results.push({ email: recipient.email, count: recipient.items?.length || 0, ...result });
    } catch (error) {
      results.push({ email: recipient.email, count: recipient.items?.length || 0, ok: false, reason: error?.message || String(error) });
    }
  }
  return results;
}
