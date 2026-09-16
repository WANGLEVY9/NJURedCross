/* ==========================================================================
   format.js — display formatting. All calendar output uses Asia/Shanghai so
   the console and the portal never disagree about "today".
   ========================================================================== */

const TZ = 'Asia/Shanghai';

const fmtDate = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtDateShort = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric' });
const fmtDateTime = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtTime = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtFull = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const fmtMonth = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'short' });
const fmtWeekday = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, weekday: 'short' });

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  // SeaTable frequently stores "2026-09-15" or "2026-09-15 14:30"
  const normalised = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function date(value, fallback = '—') {
  const parsed = toDate(value);
  return parsed ? fmtDate.format(parsed) : fallback;
}
export function dateShort(value, fallback = '—') {
  const parsed = toDate(value);
  return parsed ? fmtDateShort.format(parsed) : fallback;
}
export function dateTime(value, fallback = '—') {
  const parsed = toDate(value);
  return parsed ? fmtDateTime.format(parsed) : fallback;
}
export function time(value, fallback = '—') {
  const parsed = toDate(value);
  return parsed ? fmtTime.format(parsed) : fallback;
}
export function fullDateTime(value, fallback = '—') {
  const parsed = toDate(value);
  return parsed ? fmtFull.format(parsed) : fallback;
}
export function dayOfMonth(value) {
  const parsed = toDate(value);
  return parsed ? String(Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: 'numeric' }).format(parsed))) : '--';
}
export function monthLabel(value) {
  const parsed = toDate(value);
  return parsed ? fmtMonth.format(parsed) : '';
}
export function weekday(value) {
  const parsed = toDate(value);
  return parsed ? fmtWeekday.format(parsed) : '';
}

export function relative(value) {
  const parsed = toDate(value);
  if (!parsed) return '—';
  const diff = Date.now() - parsed.getTime();
  const abs = Math.abs(diff);
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;
  if (abs < minute) return '刚刚';
  const suffix = diff >= 0 ? '前' : '后';
  if (abs < hour) return `${Math.round(abs / minute)} 分钟${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)} 小时${suffix}`;
  if (abs < day * 30) return `${Math.round(abs / day)} 天${suffix}`;
  return fmtDate.format(parsed);
}

/** Days from now; negative means already past. */
export function daysUntil(value) {
  const parsed = toDate(value);
  if (!parsed) return null;
  const target = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(parsed));
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()));
  return Math.round((target - today) / 86400000);
}

export function dateRange(start, end) {
  const a = toDate(start);
  const b = toDate(end);
  if (!a && !b) return '时间待定';
  if (a && !b) return fmtDateTime.format(a);
  if (!a && b) return `截至 ${fmtDateTime.format(b)}`;
  const sameDay = fmtDate.format(a) === fmtDate.format(b);
  return sameDay ? `${fmtDateTime.format(a)} – ${fmtTime.format(b)}` : `${fmtDateTime.format(a)} – ${fmtDateTime.format(b)}`;
}

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/* ---- Numbers ----------------------------------------------------------- */
const fmtInt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

export function int(value, fallback = '0') {
  const number = Number(value);
  return Number.isFinite(number) ? fmtInt.format(Math.round(number)) : fallback;
}
export function dec(value, fallback = '0') {
  const number = Number(value);
  return Number.isFinite(number) ? fmtDec.format(number) : fallback;
}
export function percent(part, total, fallback = '—') {
  const a = Number(part);
  const b = Number(total);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return fallback;
  return `${Math.round((a / b) * 100)}%`;
}
export function ratio(part, total) {
  const a = Number(part) || 0;
  const b = Number(total) || 0;
  if (b <= 0) return 0;
  return Math.max(0, Math.min(1, a / b));
}
export function signed(value) {
  const number = Number(value) || 0;
  if (number === 0) return '0';
  return `${number > 0 ? '+' : '−'}${fmtInt.format(Math.abs(number))}`;
}

/* ---- Text -------------------------------------------------------------- */
export function text(value, fallback = '—') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

export function truncate(value, max = 80) {
  const result = String(value ?? '').trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

/** Client-side courtesy masking. Server-side masking remains authoritative. */
export function maskName(value) {
  const name = String(value ?? '').trim();
  if (!name) return '未填写';
  if (name.length === 1) return name;
  return `${name.slice(0, 1)}${'＊'.repeat(Math.min(name.length - 1, 3))}`;
}

export function maskEmail(value) {
  const email = String(value ?? '').trim();
  const at = email.indexOf('@');
  if (at < 1) return email ? '已隐藏' : '未填写';
  const head = email.slice(0, at);
  return `${head.slice(0, 2)}${'＊'.repeat(Math.max(1, Math.min(head.length - 2, 4)))}@${email.slice(at + 1)}`;
}

export function initials(value) {
  const name = String(value ?? '').trim();
  if (!name) return '·';
  const ascii = name.match(/[A-Za-z]/g);
  if (ascii && ascii.length >= 2 && /^[\x00-\x7F]+$/.test(name)) {
    return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  }
  return name.slice(0, 1);
}

/**
 * Shortens an opaque identifier for display. The full value stays available
 * (and copyable) in detail views, so lists stay scannable.
 */
export function shortCode(value, keep = 6) {
  const code = String(value ?? '').trim();
  if (!code) return '—';
  const [prefix, ...rest] = code.split('-');
  const body = rest.join('-');
  if (!body) return code.length > keep + 2 ? `${code.slice(0, keep)}…` : code;
  return body.length > keep ? `${prefix}-…${body.slice(-keep)}` : code;
}

export function pluralise(count, unit = '项') {
  return `${int(count)} ${unit}`;
}

/* ---- Domain vocabulary ------------------------------------------------- */
const STATUS_TONE = [
  [/已归还|审批通过|已通过|已确认|已签到|已发布|成功|正常|已完成|已核对/, 'success'],
  [/逾期|失败|不通过|缺失|异常|拒绝|错误|已取消/, 'error'],
  [/待审批|待审核|待人工|候补|待发送|待补充|待确认|待处理|待核对|待归还|草稿|待发布/, 'warning'],
  [/借出|进行中|报名中|已收集|排期|运行/, 'info'],
];

export function statusTone(value) {
  const label = String(value ?? '');
  for (const [pattern, tone] of STATUS_TONE) if (pattern.test(label)) return tone;
  return 'neutral';
}

export function priorityLabel(priority) {
  return { high: '高优先级', medium: '需处理', low: '可稍后' }[priority] || '待分类';
}
