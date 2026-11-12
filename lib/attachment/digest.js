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
 *   · 2026-11-13：**随邮件附上投稿附件**（用户定案「有就附」）。体积按
 *     DIGEST_ATTACHMENT_LIMITS 装填（单附件 8MB / 单封 20MB / 最多 30 个），
 *     超限或读取失败的只在正文点名，不阻塞发信。
 *
 * 这里只做纯计算与投递编排，不碰 SeaTable 与 HTTP，便于单测。
 */
import {
  REVIEW_STATUS,
  canSchedule,
  parseReviewTrail,
  submissionKindFor,
} from './store.js';
import { assigneesForCategory, chainStateFor, liaisonCategoryOf, reviewScopeOf } from './review.js';

/** 汇总时点（北京时间，24 小时制）。 */
export const DIGEST_HOURS = Object.freeze([8, 20]);

/**
 * 汇总邮件的附件预算（2026-11-13 用户定案：标准档）。
 *
 * 为什么必须设上限：投稿附件单文件生产上限 210MB、每篇最多 6 个
 * （`lib/attachment/api.js` 的 MAX_UPLOAD_BYTES / MAX_FILES_PER_SUBMISSION），
 * 一封汇总理论能到 GB 级。而邮件超限会被对端**退信**——整封汇总连带正文一起丢，
 * 比不附附件更糟。20MB 原始字节编码后约 27MB，仍在常用企业邮箱 25–50MB 之内。
 *
 * 超预算的附件不下载、不附文件，只在正文列出文件名与大小，指向控制台。
 */
export const DIGEST_ATTACHMENT_LIMITS = Object.freeze({
  totalBytes: 20 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  maxFiles: 30,
});

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
 * @param {{rows?:Array, assignees?:Array, publications?:object, now?:Date, attachments?:object}} input
 *   rows         宣传投稿表原始行（中文列名）
 *   assignees    宣传对接人表原始行
 *   publications 宣传发布任务表按投稿ID索引的对象；已有排期记录的稿件不再提醒排期
 *   sources      只统计这些「来源」的行，默认公众投稿（既有内容审核结论不产生 v3 待办）
 *   attachments  按投稿ID索引的附件元数据数组（`{id, filename, size, contentType}`）。
 *                只放「已上传、可取到对象键」的记录；取内容与体积判定由调用方和
 *                planDigestAttachments 负责，这里只负责把它挂到对应待办上。
 * @returns {Array<{email:string,name:string,roles:string[],items:Array}>}
 */
export function buildDigest({
  rows = [], assignees = [], publications = {}, now = new Date(),
  sources = ['公众投稿'], attachments = {},
} = {}) {
  const buckets = new Map();
  const attachmentsOf = (id) => (Array.isArray(attachments[id]) ? attachments[id] : []);

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
    // 展示用栏目（文创设计为空，显示「不挂栏目」）与选人用作用域是两件事：
    // 鉴权层自 #69 起把文创设计退化为内容类型作用域，汇总必须用同一个 reviewScopeOf，
    // 否则会出现「抽屉显示王诺、邮件发给别人」的分裂。
    const category = liaisonCategoryOf(shape);
    const scope = reviewScopeOf(shape);
    const picked = assigneesForCategory(assignees, scope);
    const trail = parseReviewTrail(shape.reviewTrail);
    const files = attachmentsOf(shape.id);

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
        attachments: files,
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
      attachments: files,
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

/** 人话体积：B / KB / MB，未知大小返回空串。 */
export function bytesLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 附件在邮件里的显示名。
 *
 * 投稿人上传的文件名完全不可信：可能带路径分隔符、控制字符、超长、或者几十条
 * 投稿全叫 `image.png`。这里统一清洗并加「邮件内序号」前缀（`3-配图.png`），
 * 让正文里的 `[3]` 与邮件客户端的附件名一一对得上。
 */
function mailSafeName(ordinal, value) {
  const raw = String(value || '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim();
  const base = raw || '附件';
  if (base.length <= 80) return `${ordinal}-${base}`;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : '';
  return `${ordinal}-${base.slice(0, 80 - ext.length)}${ext}`;
}

/**
 * 按「单附件 / 单封总量 / 文件个数」三条上限装填附件。
 *
 * 装填顺序＝正文条目顺序（等得久的在前），保证越早该处理的那条越优先带附件。
 * 超限的进 `skipped` 并在正文里点名，不静默丢弃。
 *
 * @returns {{files:Array, skipped:Array, byItem:Map, bytes:number}}
 *   files   实际要附的文件，带 `ordinal` 与 `mailName`
 *   skipped 超限未附的，`reason` 为 'file'（超单附件上限）或 'mail'（超单封总量/个数）
 */
export function planDigestAttachments(recipient = {}, limits = DIGEST_ATTACHMENT_LIMITS) {
  const files = [];
  const skipped = [];
  const byItem = new Map();
  let used = 0;
  for (const item of Array.isArray(recipient.items) ? recipient.items : []) {
    const picked = [];
    for (const file of Array.isArray(item.attachments) ? item.attachments : []) {
      const id = String(file?.id || '').trim();
      if (!id) continue;
      const size = Number(file.size) || 0;
      if (size > limits.fileBytes) {
        skipped.push({ ...file, itemId: item.id, reason: 'file' });
        continue;
      }
      if (files.length >= limits.maxFiles || used + size > limits.totalBytes) {
        skipped.push({ ...file, itemId: item.id, reason: 'mail' });
        continue;
      }
      const ordinal = files.length + 1;
      const record = { ...file, id, itemId: item.id, ordinal, mailName: mailSafeName(ordinal, file.filename) };
      files.push(record);
      picked.push(record);
      used += size;
    }
    byItem.set(item.id, picked);
  }
  return { files, skipped, byItem, bytes: used };
}

/** 邮件主题：一眼看出几件事、是早报还是晚报。 */
export function digestSubject({ slot, count = 0 } = {}) {
  const label = slot?.label || '待办汇总';
  const at = String(slot?.at || '').slice(5); // MM-DD HH:00
  return `【宣传待办·${label}】${count} 条（${at}）`;
}

/** 纯文本正文：按「初审 / 复核 / 排期」分段，每条一行。 */
export function digestMailText({
  recipient = {}, slot = null, baseUrl = '', plan = null, missing = null,
} = {}) {
  const name = String(recipient.name || '').trim();
  const items = Array.isArray(recipient.items) ? recipient.items : [];
  const review = items.filter((item) => item.type === 'review');
  const schedule = items.filter((item) => item.type === 'schedule');
  const lost = missing instanceof Set ? missing : new Set();
  const lines = [];
  lines.push(`${name ? `${name}，你好：` : '你好：'}`);
  lines.push('');
  lines.push(`这是南大红会宣传审核的${slot?.label || '待办汇总'}（${slot?.at || ''}），你有 ${items.length} 条待处理。`);
  if (plan?.files?.length) {
    lines.push(`随本邮件附上 ${plan.files.length} 个附件（合计 ${bytesLabel(plan.bytes)}），文件名前的编号与下方条目对应。`);
  }
  if (plan?.skipped?.length) {
    lines.push(`另有 ${plan.skipped.length} 个附件超过邮件体积上限未附，已在对应条目下列出，请登录控制台查看。`);
  }

  const section = (title, list) => {
    if (!list.length) return;
    lines.push('', `【${title}】`);
    list.slice(0, DIGEST_MAX_ITEMS).forEach((item, index) => {
      const tail = [item.category ? `栏目：${item.category}` : '', item.waiting].filter(Boolean).join('｜');
      lines.push(`${index + 1}. 《${item.title}》${tail ? `｜${tail}` : ''}`);
      if (item.type === 'review' && item.levelName) lines.push(`   环节：第 ${item.level} 级 · ${item.levelName}`);
      for (const file of plan?.byItem?.get(item.id) || []) {
        const note = lost.has(file.id) ? ' · 读取失败，请登录控制台查看' : '';
        lines.push(`   附件 [${file.ordinal}] ${file.filename}（${bytesLabel(file.size)}）${note}`);
      }
      for (const file of plan?.skipped || []) {
        if (file.itemId !== item.id) continue;
        const why = file.reason === 'file' ? '超出单附件上限' : '超出邮件体积上限';
        lines.push(`   附件 ${file.filename}（${bytesLabel(file.size)}）· ${why}，请登录控制台查看`);
      }
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
 *
 * 附件由调用方注入的 `loadAttachment(file)` 取内容（生产里是 NJU Box 下载），
 * 本模块不碰存储。取失败的文件降级为正文点名，不让整封邮件失败——汇总邮件的
 * 首要价值是「提醒到位」，附件是加成。
 */
export async function sendDigest({
  mail, configured = true, recipients = [], slot = null, baseUrl = '', loadAttachment = null,
}) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!configured || typeof mail !== 'function') {
    const reason = configured ? 'mail_not_injected' : 'not_configured';
    return list.map((recipient) => ({ email: recipient.email, count: recipient.items?.length || 0, ok: false, skipped: true, reason }));
  }
  const results = [];
  // 同一附件可能同时出现在多人的待办里（例如同一条稿件的多角色提醒），只下载一次。
  const cache = new Map();
  for (const recipient of list) {
    const plan = planDigestAttachments(recipient);
    const attachments = [];
    const loaded = [];
    const missing = new Set();
    for (const file of plan.files) {
      if (typeof loadAttachment !== 'function') { missing.add(file.id); continue; }
      try {
        let buffer = cache.get(file.id);
        if (!buffer) {
          buffer = await loadAttachment(file);
          if (buffer) cache.set(file.id, buffer);
        }
        if (!buffer || !buffer.length) { missing.add(file.id); continue; }
        attachments.push({
          filename: file.mailName,
          content: buffer,
          contentType: String(file.contentType || file.mimeType || 'application/octet-stream'),
          attachmentId: file.id,
        });
        loaded.push(file);
      } catch {
        missing.add(file.id);
      }
    }
    const subject = digestSubject({ slot, count: recipient.items?.length || 0 });
    try {
      const result = await mail({
        to: recipient.email,
        subject,
        text: digestMailText({ recipient, slot, baseUrl, plan, missing }),
        kind: digestKindOf(recipient),
        idempotencyKey: `outreach-digest-${slot?.key || 'x'}-${String(recipient.email).toLowerCase()}`,
        ...(attachments.length ? { attachments } : {}),
        // 补发用的轻量引用（不含内容）：只对**真的附上了**的文件留引用，
        // 否则补发时重建的附件比首次多，指纹对不上会被判成幂等键冲突。
        ...(loaded.length ? {
          attachmentRefs: loaded.map((file) => ({
            attachmentId: file.id,
            filename: file.mailName,
            contentType: String(file.contentType || file.mimeType || 'application/octet-stream'),
            objectKey: String(file.objectKey || ''),
            provider: String(file.provider || ''),
            size: Number(file.size) || 0,
          })),
        } : {}),
      });
      results.push({
        email: recipient.email,
        count: recipient.items?.length || 0,
        attached: attachments.length,
        ...result,
      });
    } catch (error) {
      results.push({ email: recipient.email, count: recipient.items?.length || 0, ok: false, reason: error?.message || String(error) });
    }
  }
  return results;
}
