import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Base } from 'seatable-api';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const serverUrl = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const apiToken = process.env.SEATABLE_API_TOKEN;
const configuredTable = process.env.SEATABLE_TABLE?.trim();
const volunteerApiToken = process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
const volunteerBaseUuid = process.env.SEATABLE_VOLUNTEER_BASE_UUID?.trim() || null;
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME?.trim();
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
const accountsFile = join(root, process.env.PLATFORM_ADMIN_ACCOUNTS_FILE || '.admin-accounts.json');
const auditFile = join(root, 'logs', 'audit.jsonl');
const outreachReviewFile = join(root, 'logs', 'outreach-reviews.json');
const communityConsentFile = join(root, 'logs', 'community-consent.json');
const outreachPublicationFile = join(root, 'logs', 'outreach-publications.json');
const communitySubmissionFile = join(root, 'logs', 'community-submissions.json');
const publicSubmissionFile = join(root, 'logs', 'public-submissions.json');
const warmthInterestFile = join(root, 'logs', 'warmth-interest.json');
const publicEmailDomains = String(process.env.PUBLIC_EMAIL_DOMAINS || 'nju.edu.cn,smail.nju.edu.cn')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const publicWriteLimit = Math.max(1, Number(process.env.PUBLIC_WRITE_LIMIT_PER_HOUR || 12));
const publicRequests = new Map();
const sessionSecret = process.env.PLATFORM_SESSION_SECRET;
const sessionTtlHours = Math.min(Math.max(Number(process.env.PLATFORM_SESSION_TTL_HOURS || 8), 1), 24 * 7);
const sessionTtlSeconds = Math.round(sessionTtlHours * 60 * 60);
const secureCookie = process.env.NODE_ENV === 'production';
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPassword = process.env.SMTP_PASSWORD;
const reminderFrom = process.env.MATERIALS_REMINDER_FROM?.trim() || smtpUser;
const reminderIntervalMinutes = Math.max(5, Number(process.env.MATERIALS_REMINDER_INTERVAL_MINUTES || 15));
const loginAttempts = new Map();

if (!apiToken || apiToken === 'replace-with-your-api-token') {
  console.error('Missing SEATABLE_API_TOKEN. Copy .env.example to .env and configure it.');
  process.exit(1);
}
if (!sessionSecret || sessionSecret.startsWith('replace-with-') || sessionSecret.length < 32) {
  console.error('Missing secure platform login configuration. Set a 32+ character PLATFORM_SESSION_SECRET in .env.');
  process.exit(1);
}

async function loadAccounts() {
  if (process.env.PLATFORM_ADMIN_ACCOUNTS_FILE) {
    try {
      const configured = JSON.parse(await readFile(accountsFile, 'utf8'));
      if (!Array.isArray(configured) || configured.length === 0) throw new Error('must be a non-empty JSON array');
      return configured;
    } catch (error) {
      console.error(`Unable to load administrator accounts from ${accountsFile}: ${error.message}`);
      process.exit(1);
    }
  }
  if (!adminUsername || !adminPassword || adminPassword.startsWith('replace-with-')) {
    console.error('Missing platform administrator configuration. Set PLATFORM_ADMIN_ACCOUNTS_FILE or PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD in .env.');
    process.exit(1);
  }
  return [{ username: adminUsername, password: adminPassword, role: 'platform_admin', label: '本地管理员' }];
}

const accounts = await loadAccounts();
const accountsByUsername = new Map();
for (const account of accounts) {
  if (!account || typeof account.username !== 'string' || !account.username.trim() || typeof account.password !== 'string' || account.password.length < 16 || account.role !== 'platform_admin' || accountsByUsername.has(account.username)) {
    console.error('Administrator account configuration is invalid. Each account needs a unique username, 16+ character password, and platform_admin role.');
    process.exit(1);
  }
  accountsByUsername.set(account.username, { ...account, username: account.username.trim() });
}

const base = new Base({ server: serverUrl, APIToken: apiToken });
const volunteerBase = volunteerApiToken ? new Base({ server: serverUrl, APIToken: volunteerApiToken }) : null;
let authPromise;
let volunteerAuthPromise;

async function getBase() {
  if (!authPromise) {
    authPromise = base.auth().catch((error) => {
      authPromise = undefined;
      throw error;
    });
  }
  await authPromise;
  return base;
}
async function getVolunteerBase() {
  if (!volunteerBase) throw Object.assign(new Error('Volunteer SeaTable source is not configured'), { statusCode: 503 });
  if (!volunteerAuthPromise) {
    volunteerAuthPromise = volunteerBase.auth().catch((error) => {
      volunteerAuthPromise = undefined;
      throw error;
    });
  }
  await volunteerAuthPromise;
  return volunteerBase;
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  };
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

async function recordAudit(req, session, action, target, result = 'success', metadata = {}) {
  const entry = {
    at: new Date().toISOString(),
    actor: session?.username || 'anonymous',
    role: session?.role || 'unknown',
    action,
    target,
    result,
    ip: clientIp(req),
    metadata,
  };
  try {
    await mkdir(join(root, 'logs'), { recursive: true });
    await appendFile(auditFile, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error(`Audit write failed: ${error.message}`);
  }
}

async function readRecentAudit(limit = 50) {
  try {
    const content = await readFile(auditFile, 'utf8');
    return content.split('\n').filter(Boolean).slice(-Math.min(Math.max(limit, 1), 200)).reverse().map((line) => JSON.parse(line));
  } catch { return []; }
}
async function readOutreachReviews() {
  try { return JSON.parse(await readFile(outreachReviewFile, 'utf8')); } catch { return {}; }
}
async function saveOutreachReviews(reviews) {
  await mkdir(join(root, 'logs'), { recursive: true });
  await writeFile(outreachReviewFile, `${JSON.stringify(reviews, null, 2)}\n`, 'utf8');
}
async function readCommunityConsents() {
  try { return JSON.parse(await readFile(communityConsentFile, 'utf8')); } catch { return {}; }
}
async function saveCommunityConsents(consents) {
  await mkdir(join(root, 'logs'), { recursive: true });
  await writeFile(communityConsentFile, `${JSON.stringify(consents, null, 2)}\n`, 'utf8');
}
async function readOutreachPublications() {
  try { return JSON.parse(await readFile(outreachPublicationFile, 'utf8')); } catch { return {}; }
}
async function saveOutreachPublications(publications) {
  await mkdir(join(root, 'logs'), { recursive: true });
  await writeFile(outreachPublicationFile, `${JSON.stringify(publications, null, 2)}\n`, 'utf8');
}
async function readCommunitySubmissions() {
  try { return JSON.parse(await readFile(communitySubmissionFile, 'utf8')); } catch { return []; }
}
async function saveCommunitySubmissions(submissions) {
  await mkdir(join(root, 'logs'), { recursive: true });
  await writeFile(communitySubmissionFile, `${JSON.stringify(submissions, null, 2)}\n`, 'utf8');
}
async function readPublicSubmissions() {
  try { return JSON.parse(await readFile(publicSubmissionFile, 'utf8')); } catch { return []; }
}
async function savePublicSubmissions(submissions) {
  await mkdir(join(root, 'logs'), { recursive: true });
  await writeFile(publicSubmissionFile, `${JSON.stringify(submissions, null, 2)}\n`, 'utf8');
}
async function readWarmthInterests() {
  try { return JSON.parse(await readFile(warmthInterestFile, 'utf8')); } catch { return []; }
}
async function saveWarmthInterests(interests) {
  await mkdir(join(root, 'logs'), { recursive: true });
  await writeFile(warmthInterestFile, `${JSON.stringify(interests, null, 2)}\n`, 'utf8');
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Public endpoints have no session to rate-limit against, so writes are capped
// per client address and per action bucket.
function enforcePublicLimit(req, bucket, limit = publicWriteLimit) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const entry = publicRequests.get(key);
  if (!entry || entry.resetAt <= now) {
    publicRequests.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw httpError(429, `提交过于频繁，请在 ${Math.ceil((entry.resetAt - now) / 60000)} 分钟后重试。`);
  }
}

function assertPublicEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, '邮箱格式不正确');
  if (!publicEmailDomains.length) return email;
  const domain = email.split('@')[1].toLowerCase();
  const allowed = publicEmailDomains.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
  if (!allowed) throw httpError(400, `请使用 ${publicEmailDomains.join(' 或 ')} 邮箱提交，便于核验校内身份。`);
  return email;
}

function errorMessage(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const detail = typeof data === 'string' ? data : data?.detail || data?.error_msg || data?.error || data?.message;
  return { status, message: detail || error?.message || 'SeaTable request failed' };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

async function readMaterialAction(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) return { body: await readJson(req), photo: null };
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 8 * 1024 * 1024) { const error = new Error('Photo upload is limited to 8 MB'); error.statusCode = 413; throw error; }
  const form = await new Request('http://localhost/material-action', { method: 'POST', headers: req.headers, body: req, duplex: 'half' }).formData();
  const body = {};
  for (const [key, value] of form.entries()) if (!(value instanceof File)) body[key] = String(value);
  const photo = form.get('photo');
  return { body, photo: photo instanceof File && photo.size > 0 ? photo : null };
}

function safeUploadName(name = 'photo.jpg') {
  const extension = String(name).toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)?.[1] || 'jpg';
  return `nju-redcross-${Date.now()}-${randomBytes(5).toString('hex')}.${extension}`;
}

async function uploadSeaTableImage(file) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { const error = new Error('Only JPG, PNG or WebP photos are supported'); error.statusCode = 400; throw error; }
  const linkResponse = await fetch(`${serverUrl}/api/v2.1/dtable/app-upload-link/`, { headers: { Authorization: `Bearer ${apiToken}` } });
  const link = await linkResponse.json().catch(() => ({}));
  if (!linkResponse.ok || !link.upload_link) { const error = new Error('Unable to obtain SeaTable photo upload link'); error.statusCode = 502; throw error; }
  const upload = new FormData();
  upload.append('file', new Blob([await file.arrayBuffer()], { type: file.type }), safeUploadName(file.name));
  upload.append('parent_dir', link.parent_path);
  upload.append('relative_path', link.img_relative_path);
  upload.append('replace', '0');
  const uploadUrl = String(link.upload_link).startsWith('http') ? link.upload_link : `${serverUrl}${link.upload_link}`;
  const uploadResponse = await fetch(`${uploadUrl}?ret-json=1`, { method: 'POST', headers: { Authorization: `Bearer ${apiToken}` }, body: upload });
  const result = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !result.name) { const error = new Error('SeaTable photo upload failed'); error.statusCode = 502; throw error; }
  return `/workspace/${link.workspace_id}${String(link.parent_path).replace(/\/$/, '')}/${String(link.img_relative_path).replace(/^\//, '')}/${result.name}`;
}

function tableFrom(url, body = {}) {
  const table = String(url.searchParams.get('table') || body.table || configuredTable || '').trim();
  if (!table) {
    const error = new Error('Please select a table first');
    error.statusCode = 400;
    throw error;
  }
  return table;
}

const materialsTable = '物资管理';
const inventoryTable = '工位物资表';
const eventProjectTable = '活动项目表';
const eventSessionTable = '活动场次表';
const eventRegistrationTable = '活动报名表';
const activitySchema = [
  { name: '活动项目表', purpose: '活动基本信息、报名窗口与运营负责人', columns: ['活动ID', '活动名称', '活动类型', '活动简介', '校区', '地点', '报名开始', '报名截止', '活动开始', '活动结束', '容量', '负责人', '状态', '公开范围'] },
  { name: '活动场次表', purpose: '同一活动的具体场次与签到配置', columns: ['场次ID', '活动ID', '开始时间', '结束时间', '地点', '容量', '签到开放', '签到方式', '状态'] },
  { name: '活动报名表', purpose: '参与者报名、候补、签到与授权记录', columns: ['报名ID', '活动ID', '场次ID', '参与者引用', '显示姓名', '南大邮箱', '校区', '报名答案', '同意版本', '报名状态', '候补序号', '签到码摘要', '提交时间', '取消时间', '签到时间'] },
];
const outreachSchema = [
  { name: '宣传项目表', purpose: '宣传主题、征集窗口、受众与发布渠道', columns: ['项目ID', '项目名称', '项目类型', '征集开始', '征集截止', '目标受众', '发布渠道', '状态', '负责人', '授权版本'] },
  { name: '宣传投稿表', purpose: '稿件正文、附件引用、署名方式、授权与审核状态', columns: ['投稿ID', '项目ID', '标题', '正文', '附件引用', '投稿人引用', '对外署名', '公开范围', '原创确认', '肖像授权', '审核状态', '审核意见', '提交时间', '审核时间'] },
  { name: '宣传发布任务表', purpose: '渠道排期、发布确认、链接与失败重试记录', columns: ['任务ID', '投稿ID', '发布渠道', '计划发布时间', '发布状态', '发布链接', '失败原因', '重试次数', '确认人', '完成时间'] },
];
function toFiniteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function shanghaiDay(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}
/** Ordered list of the last `days` calendar days in Asia/Shanghai. */
function recentDays(days = 14) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    out.push(formatter.format(new Date(Date.now() - offset * 86400000)));
  }
  return out;
}
/** Counts rows per day for a set of named date accessors. */
function dailySeries(rows, accessors, days = 14) {
  const labels = recentDays(days);
  const index = new Map(labels.map((label, position) => [label, position]));
  const series = {};
  for (const [name, accessor] of Object.entries(accessors)) {
    const values = new Array(labels.length).fill(0);
    for (const row of rows) {
      const result = accessor(row);
      if (!result) continue;
      const [dateValue, amount = 1] = Array.isArray(result) ? result : [result, 1];
      const position = index.get(shanghaiDay(dateValue));
      if (position === undefined) continue;
      values[position] += amount;
    }
    series[name] = values;
  }
  return { labels, ...series };
}
function materialCode(row) { return `NJU-RC-${row._id}`; }
function parsedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function daysLate(value) {
  const due = parsedDate(value);
  if (!due) return 0;
  due.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today - due) / 86400000));
}
function maskedApplicant(value) {
  const name = String(value || '').trim();
  return name ? `${name.slice(0, 1)}${name.length > 1 ? '＊'.repeat(Math.min(name.length - 1, 3)) : ''}` : '未填写';
}
function maskedEmail(value) {
  const email = String(value || '').trim();
  const at = email.indexOf('@');
  if (at < 1) return email ? '已隐藏' : '未填写';
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}${'＊'.repeat(Math.max(1, Math.min(local.length - 2, 4)))}@${email.slice(at + 1)}`;
}
function inventorySummary(row, config = {}) {
  const initial = toFiniteNumber(row['初始数量']);
  const baselineQuantity = toFiniteNumber(row['现有数量']);
  const quantity = baselineQuantity + toFiniteNumber(config.__ledgerDelta);
  const configuredThreshold = toFiniteNumber(config['预警阈值']);
  const threshold = config['阈值启用'] === false ? null : (configuredThreshold || Math.max(3, Math.ceil(initial * 0.2)));
  const flow = config.__flowStats || {};
  const difference = initial - quantity;
  const baselineBorrowed = toFiniteNumber(row['借出数量']);
  const baselineReturned = toFiniteNumber(row['归还数量']);
  const baselineOutstanding = Math.max(0, baselineBorrowed - baselineReturned);
  const untrackedDifference = Math.max(0, Math.abs(initial - baselineQuantity) - baselineOutstanding - Math.max(0, toFiniteNumber(flow.outbound) - toFiniteNumber(flow.returned)));
  return {
    id: row._id, code: materialCode(row), name: String(row['物资名称'] || '未命名物资'), center: String(row['中心'] || '未分类'), unit: String(row['单位'] || '件'), cabinet: String(row['柜号'] || '未标注'), level: String(row['层数'] || '未标注'), initial, baselineQuantity, quantity, difference, baselineDifference: initial - baselineQuantity, baselineBorrowed, baselineReturned, baselineOutstanding, untrackedDifference, threshold,
    outbound: toFiniteNumber(flow.outbound), returned: toFiniteNumber(flow.returned), inbound: toFiniteNumber(flow.inbound), loss: toFiniteNumber(flow.loss), adjustment: toFiniteNumber(flow.adjustment), destinations: flow.destinations || [], sourceStatuses: Array.isArray(row['物资管理']) ? row['物资管理'].map(String) : [],
    lowStock: threshold !== null && quantity <= threshold,
  };
}
function applicationSummary(row) {
  const returned = Boolean(row['实际归还日期']) || String(row['归还状态'] || '').includes('已全部归还') || String(row['状态'] || '').includes('已归还');
  const overdueDays = returned ? 0 : daysLate(row['拟归还日期']);
  const status = String(row['状态'] || '未填写');
  const approval = String(row['借出审批'] || '待审核');
  return {
    id: row._id, code: `REQ-${row._id}`, applicant: maskedApplicant(row['姓名']), purpose: String(row['借用用途'] || '未填写'), items: String(row['借用物资名及数量'] || row['借用物资类型'] || '未填写'), quantity: toFiniteNumber(row['借用件数']), status, approval, returnStatus: String(row['归还状态'] || ''),
    plannedBorrowDate: row['拟借用日期'] || null, plannedReturnDate: row['拟归还日期'] || null, actualBorrowDate: row['实际借用日期'] || null, actualReturnDate: row['实际归还日期'] || null, returned, overdueDays,
  };
}
function eventIdentifier(prefix = 'EVT') { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`; }
function requiredText(value, label, max = 200) {
  const text = String(value || '').trim();
  if (!text) { const error = new Error(`${label}不能为空`); error.statusCode = 400; throw error; }
  if (text.length > max) { const error = new Error(`${label}长度不能超过${max}个字符`); error.statusCode = 400; throw error; }
  return text;
}
function eventPayload(body, session) {
  const title = requiredText(body.title || body.name, '活动名称', 120);
  const capacity = Math.max(1, Math.floor(Number(body.capacity || 0)));
  if (!Number.isInteger(capacity) || capacity <= 0) { const error = new Error('活动容量必须是正整数'); error.statusCode = 400; throw error; }
  return {
    活动ID: eventIdentifier(), 活动名称: title, 活动类型: String(body.type || '公益活动').trim(), 活动简介: String(body.description || '').trim(),
    校区: String(body.campus || '').trim(), 地点: String(body.location || '').trim(), 报名开始: String(body.registrationStart || '').trim(), 报名截止: String(body.registrationEnd || '').trim(),
    活动开始: String(body.startAt || '').trim(), 活动结束: String(body.endAt || '').trim(), 容量: String(capacity), 负责人: session.username, 状态: '草稿', 公开范围: String(body.visibility || '内部成员').trim(),
  };
}
function eventSummary(row, sessions = [], registrations = []) {
  const eventId = String(row['活动ID'] || '');
  const relatedSessions = sessions.filter((item) => String(item['活动ID'] || '') === eventId);
  const relatedRegistrations = registrations.filter((item) => String(item['活动ID'] || '') === eventId && !String(item['报名状态'] || '').includes('已取消'));
  return {
    id: row._id, eventId, name: String(row['活动名称'] || '未命名活动'), type: String(row['活动类型'] || ''), description: String(row['活动简介'] || ''), campus: String(row['校区'] || ''), location: String(row['地点'] || ''),
    registrationStart: row['报名开始'] || null, registrationEnd: row['报名截止'] || null, startAt: row['活动开始'] || null, endAt: row['活动结束'] || null, capacity: toFiniteNumber(row['容量']), owner: maskedApplicant(row['负责人']), status: String(row['状态'] || '草稿'), visibility: String(row['公开范围'] || ''),
    sessions: relatedSessions.map((item) => ({ id: item._id, sessionId: item['场次ID'] || '', startAt: item['开始时间'] || null, endAt: item['结束时间'] || null, location: item['地点'] || '', capacity: toFiniteNumber(item['容量']), checkinOpen: item['签到开放'] || null, checkinMethod: item['签到方式'] || '', status: item['状态'] || '' })),
    registrations: relatedRegistrations.length, confirmed: relatedRegistrations.filter((item) => String(item['报名状态'] || '') === '已确认').length, waitlisted: relatedRegistrations.filter((item) => String(item['报名状态'] || '') === '候补').length, checkedIn: relatedRegistrations.filter((item) => String(item['签到时间'] || '').trim()).length,
  };
}
function eventCheckinToken(registrationId, code) {
  return `${registrationId}.${code}`;
}
function eventCheckinHash(token) { return hash(token).toString('hex'); }
function randomCheckinCode() { return randomBytes(5).toString('hex').toUpperCase(); }
async function volunteerRows(client, tableName, limit = 500) {
  return client.listRows(tableName, '', '', false, '', limit);
}
function volunteerStatus(value) {
  const text = String(value || '').trim();
  if (/通过|成功|已完成|已核对|已解决/.test(text)) return 'success';
  if (/拒绝|失败|未通过|问题/.test(text)) return 'danger';
  return 'warning';
}
async function getVolunteerOverview(client) {
  const [registrations, checkins, approvals, profiles, hours] = await Promise.all([
    volunteerRows(client, '活动报名总表'),
    volunteerRows(client, '活动签到'),
    volunteerRows(client, '登记审批'),
    volunteerRows(client, '个人主页（编辑版）', 1000),
    volunteerRows(client, '活动及时长汇总表'),
  ]);
  const events = new Map();
  for (const row of registrations) {
    const name = String(row['活动名称'] || '未命名活动').trim();
    if (!events.has(name)) events.set(name, { name, registrations: 0, confirmed: 0, checkedIn: 0 });
    const event = events.get(name);
    event.registrations += 1;
    if (/成功|通过|已报名/.test(String(row['是否报名成功'] || row['报名结果'] || ''))) event.confirmed += 1;
  }
  for (const row of checkins) {
    const event = events.get(String(row['活动名称'] || '未命名活动').trim());
    if (event) event.checkedIn += 1;
  }
  const approvalQueue = approvals.slice(-8).reverse().map((row) => ({
    activity: String(row['活动名称'] || '未命名活动'), type: String(row['活动类别'] || '活动'), date: row['活动日期'] || null,
    owner: maskedApplicant(row['负责人']), status: String(row['审批通过'] || row['进程'] || '待处理'), progress: String(row['进程'] || ''),
  }));
  const recentCheckins = checkins.slice(-8).reverse().map((row) => ({
    activity: String(row['活动名称'] || '未命名活动'), name: maskedApplicant(row['姓名']), time: row['活动时间'] || row['创建时间'] || null, verified: String(row['已核对并录入'] || ''),
  }));
  const hoursQueue = hours.slice().reverse().filter((row) => !/通过|已完成|已核对|已发放/.test(String(row['审核状态'] || row['状态'] || row['时长状态'] || ''))).slice(0, 12).map((row) => ({
    activity: String(row['活动名称'] || row['活动'] || '未命名活动'),
    name: maskedApplicant(row['姓名'] || row['姓名+学号'] || row['参与者']),
    hours: String(row['服务时长'] || row['时长'] || row['核算时长'] || '待核对'),
    status: String(row['审核状态'] || row['状态'] || row['时长状态'] || '待核对'),
  }));
  return {
    ok: true, source: { baseUuid: volunteerBaseUuid, readOnly: true, tables: ['活动报名总表', '活动签到', '登记审批', '个人主页（编辑版）', '活动及时长汇总表'] },
    stats: { memberProfiles: profiles.length, registrations: registrations.length, checkins: checkins.length, approvals: approvals.length, eventCount: events.size, hoursQueue: hoursQueue.length },
    events: [...events.values()].sort((a, b) => b.registrations - a.registrations).slice(0, 12), approvalQueue, recentCheckins, hoursQueue,
  };
}
async function safeRows(client, tableName, limit = 100) {
  try { return await client.listRows(tableName, '', '', false, '', limit); }
  catch { return []; }
}
async function getOutreachOverview(client) {
  const [planning, submissions, feedback] = await Promise.all([
    safeRows(client, '博爱青春策划案 线下答辩'),
    safeRows(client, '博爱青春纪念品大赛'),
    safeRows(client, '“红十字生命教育＋”第一轮试课'),
  ]);
  let notices = [];
  if (volunteerBase) notices = await safeRows(await getVolunteerBase(), '报名通知');
  const campaignRows = [
    ...planning.map((row) => ({ id: `planning:${row._id}`, type: '策划案', title: String(row['策划案名称'] || row['团队名称'] || '未命名策划'), status: '已收集', source: '博爱青春策划案 线下答辩', author: maskedApplicant(row['负责人'] || row['团队负责人'] || row['姓名']), submittedAt: row['提交时间'] || row['创建时间'] || row._mtime || null, summary: String(row['策划案简介'] || row['项目简介'] || row['策划案内容'] || '暂无摘要'), authorization: String(row['授权'] || row['是否同意公开'] || '待核对') })),
    ...submissions.map((row) => ({ id: `creative:${row._id}`, type: '文创征集', title: String(row['文创名称'] || row['参赛类别'] || '未命名作品'), status: '已收集', source: '博爱青春纪念品大赛', author: maskedApplicant(row['作者'] || row['姓名'] || row['负责人']), submittedAt: row['提交时间'] || row['创建时间'] || row._mtime || null, summary: String(row['作品简介'] || row['设计理念'] || row['参赛说明'] || '暂无摘要'), authorization: String(row['授权'] || row['是否同意公开'] || '待核对') })),
    ...feedback.map((row) => ({ id: `feedback:${row._id}`, type: '课程反馈', title: String(row['课程名称'] || '未命名课程'), status: row['改进建议'] ? '有反馈' : '待补充', source: '“红十字生命教育＋”第一轮试课', author: maskedApplicant(row['反馈人'] || row['姓名']), submittedAt: row['提交时间'] || row['创建时间'] || row._mtime || null, summary: String(row['改进建议'] || row['课程反馈'] || '暂无摘要'), authorization: '内部反馈' })),
  ];
  const reviews = await readOutreachReviews();
  const publications = await readOutreachPublications();
  const reviewedCampaigns = campaignRows.map((item) => ({ ...item, review: reviews[item.id] || null, publication: publications[item.id] || null, status: reviews[item.id]?.decision === 'approve' ? '已通过' : reviews[item.id]?.decision === 'return' ? '待修改' : item.status }));
  return {
    ok: true,
    stats: { contentCount: reviewedCampaigns.length, planningCount: planning.length, creativeCount: submissions.length, feedbackCount: feedback.length, noticeCount: notices.length, reviewPending: reviewedCampaigns.filter((item) => !item.review).length, reviewApproved: reviewedCampaigns.filter((item) => item.review?.decision === 'approve').length, reviewReturned: reviewedCampaigns.filter((item) => item.review?.decision === 'return').length, publicationPending: reviewedCampaigns.filter((item) => item.publication?.status === '待人工发布').length },
    campaigns: reviewedCampaigns.slice(0, 24),
    notices: notices.slice(-12).reverse().map((row) => ({ type: String(row['活动类别'] || '活动'), title: String(row['活动名称'] || '未命名活动'), status: String(row['审批进程'] || row['隐藏'] || '待发布'), group: String(row['QQ群号'] || '') })),
    sources: ['博爱青春策划案 线下答辩', '博爱青春纪念品大赛', '“红十字生命教育＋”第一轮试课', ...(volunteerBase ? ['报名通知（志愿服务 Base）'] : [])],
  };
}
async function getNotificationsOverview(client) {
  const [materialsResult, eventsResult, outreachResult, volunteerResult, communityResult, publicSubmissionResult, warmthResult] = await Promise.allSettled([
    getMaterialsOverview(client),
    getEventsOverview(client),
    getOutreachOverview(client),
    volunteerBase ? getVolunteerOverview(await getVolunteerBase()) : Promise.resolve(null),
    readCommunitySubmissions(),
    readPublicSubmissions(),
    readWarmthInterests(),
  ]);
  const items = [];
  const materials = materialsResult.status === 'fulfilled' ? materialsResult.value : null;
  const events = eventsResult.status === 'fulfilled' ? eventsResult.value : null;
  const outreach = outreachResult.status === 'fulfilled' ? outreachResult.value : null;
  const volunteer = volunteerResult.status === 'fulfilled' ? volunteerResult.value : null;
  const communitySubmissions = communityResult.status === 'fulfilled' ? communityResult.value : [];
  const publicSubmissions = publicSubmissionResult.status === 'fulfilled' ? publicSubmissionResult.value : [];
  const warmthInterests = warmthResult.status === 'fulfilled' ? warmthResult.value : [];
  (materials?.overdue || []).slice(0, 8).forEach((item) => items.push({ type: '物资逾期', priority: 'high', title: `${item.purpose} · ${item.overdueDays} 天`, detail: item.items, view: 'materials' }));
  (materials?.lowStock || []).slice(0, 8).forEach((item) => items.push({ type: '库存预警', priority: 'high', title: item.name, detail: `当前 ${item.quantity}，阈值 ${item.threshold}`, view: 'materials' }));
  (materials?.pending || []).slice(0, 8).forEach((item) => items.push({ type: '物资审批', priority: 'medium', title: item.purpose, detail: `${item.applicant} · ${item.items}`, view: 'materials' }));
  (events?.events || []).filter((event) => event.status === '草稿').slice(0, 6).forEach((event) => items.push({ type: '活动待发布', priority: 'medium', title: event.name, detail: '草稿状态，发布前请确认场次和容量', view: 'activities' }));
  (volunteer?.hoursQueue || []).slice(0, 8).forEach((item) => items.push({ type: '时长待核对', priority: 'medium', title: item.activity, detail: `${item.name} · ${item.hours}`, view: 'services' }));
  (outreach?.campaigns || []).filter((item) => item.status === '已收集' || item.status === '待补充').slice(0, 8).forEach((item) => items.push({ type: '内容待审核', priority: 'low', title: item.title, detail: `${item.type} · ${item.authorization}`, view: 'outreach' }));
  (outreach?.campaigns || []).filter((item) => item.publication?.status === '待人工发布').slice(0, 8).forEach((item) => items.push({ type: '内容待发布', priority: 'medium', title: item.title, detail: `${item.publication.channel} · ${item.publication.plannedAt}`, view: 'outreach' }));
  communitySubmissions.filter((item) => item.status === '待审核').slice(0, 8).forEach((item) => items.push({ type: '温暖连接待审核', priority: 'medium', title: item.program === 'birthday' ? '生日祝福投稿' : '早安晚安投稿', detail: `${item.tone} · ${item.submittedAt}`, view: 'community' }));
  publicSubmissions.filter((item) => item.status === '待审核').slice(0, 10).forEach((item) => items.push({ type: '公众投稿待审核', priority: 'high', title: item.title, detail: `${item.category} · 来自公众端`, view: 'outreach' }));
  warmthInterests.filter((item) => item.status === '待人工确认').slice(0, 10).forEach((item) => items.push({ type: '温暖连接待确认', priority: 'medium', title: item.program === 'birthday' ? `生日祝福 · ${item.nickname}` : `早安晚安 · ${item.nickname}`, detail: '公众端自愿登记，需人工确认后才进入队列', view: 'community' }));
  const priority = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => priority[a.priority] - priority[b.priority]);
  return { ok: true, stats: { total: items.length, high: items.filter((item) => item.priority === 'high').length, medium: items.filter((item) => item.priority === 'medium').length, low: items.filter((item) => item.priority === 'low').length }, items: items.slice(0, 24), sources: { materials: Boolean(materials), events: Boolean(events), outreach: Boolean(outreach), volunteer: Boolean(volunteer), community: true, portal: true } };
}
async function getEventsOverview(client) {
  const [projects, sessions, registrations] = await Promise.all([
    client.listRows(eventProjectTable, '', '', false, '', 200),
    client.listRows(eventSessionTable, '', '', false, '', 500),
    client.listRows(eventRegistrationTable, '', '', false, '', 1000),
  ]);
  return {
    ok: true, source: { table: eventProjectTable, mode: 'managed-events' },
    stats: { projects: projects.length, sessions: sessions.length, registrations: registrations.length, confirmed: registrations.filter((row) => row['报名状态'] === '已确认').length, waitlisted: registrations.filter((row) => row['报名状态'] === '候补').length, checkedIn: registrations.filter((row) => String(row['签到时间'] || '').trim()).length },
    series: dailySeries(registrations, {
      registrations: (row) => row['提交时间'] || null,
      checkins: (row) => row['签到时间'] || null,
      cancellations: (row) => row['取消时间'] || null,
    }),
    events: projects.map((row) => eventSummary(row, sessions, registrations)),
  };
}

/**
 * Shared registration pipeline used by both the console and the public portal.
 * Capacity, duplicate detection and waitlist ordering are always evaluated on
 * the server so the browser cannot bypass them.
 */
async function registerForEvent(client, { eventKey, body, participantRef, restrictEmailDomain = false }) {
  const name = requiredText(body.name, '姓名', 60);
  const email = requiredText(body.email, '邮箱', 160);
  if (restrictEmailDomain) assertPublicEmail(email);
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, '邮箱格式不正确');
  if (body.consent !== true) throw httpError(400, '必须确认报名授权');

  const [projects, sessions, registrations] = await Promise.all([
    client.listRows(eventProjectTable, '', '', false, '', 500),
    client.listRows(eventSessionTable, '', '', false, '', 500),
    client.listRows(eventRegistrationTable, '', '', false, '', 1000),
  ]);
  const project = projects.find((row) => row._id === eventKey || row['活动ID'] === eventKey);
  if (!project) throw httpError(404, '活动不存在');
  if (String(project['状态'] || '') !== '报名中') throw httpError(409, '当前活动尚未发布报名或报名已关闭');

  const sessionId = String(body.sessionId || '').trim();
  const selectedSession = sessionId ? sessions.find((row) => row._id === sessionId || row['场次ID'] === sessionId) : null;
  if (sessionId && (!selectedSession || selectedSession['活动ID'] !== project['活动ID'])) throw httpError(400, '所选活动场次不存在');

  const active = registrations.filter((row) => row['活动ID'] === project['活动ID'] && row['报名状态'] !== '已取消');
  if (active.some((row) => String(row['南大邮箱'] || '').toLowerCase() === email.toLowerCase())) throw httpError(409, '该邮箱已经报名，不能重复提交');

  const scopedActive = selectedSession ? active.filter((row) => String(row['场次ID'] || '') === String(selectedSession['场次ID'] || selectedSession._id)) : active;
  const capacity = Math.max(1, Math.floor(toFiniteNumber(selectedSession?.['容量'] || project['容量'])));
  const confirmed = scopedActive.filter((row) => row['报名状态'] === '已确认').length;
  const status = confirmed < capacity ? '已确认' : '候补';
  const waitlist = status === '候补' ? scopedActive.filter((row) => row['报名状态'] === '候补').length + 1 : 0;

  const registrationCode = eventIdentifier('REG');
  const checkinCode = randomCheckinCode();
  const row = {
    报名ID: registrationCode, 活动ID: project['活动ID'], 场次ID: String(selectedSession?.['场次ID'] || sessionId),
    参与者引用: participantRef, 显示姓名: name, 南大邮箱: email, 校区: String(body.campus || selectedSession?.['地点'] || project['校区'] || '').trim(),
    报名答案: JSON.stringify({ note: String(body.note || '').trim() }), 同意版本: 'v1', 报名状态: status, 候补序号: String(waitlist),
    签到码摘要: eventCheckinHash(eventCheckinToken(registrationCode, checkinCode)),
    提交时间: new Date().toISOString(), 取消时间: '', 签到时间: '',
  };
  const result = await client.appendRow(eventRegistrationTable, row);
  const token = eventCheckinToken(registrationCode, checkinCode);
  const qrDataUrl = await QRCode.toDataURL(`NJU-RC-CHECKIN:${token}`, { errorCorrectionLevel: 'M', margin: 1, color: { dark: '#520d2e', light: '#fffdfb' } });
  return { project, session: selectedSession, row, result, status, waitlist, token, qrDataUrl, capacity };
}

/* --------------------------------------------------------------------------
   Public projections — never include personal data
   -------------------------------------------------------------------------- */
function isPubliclyListed(project) {
  const status = String(project['状态'] || '');
  const visibility = String(project['公开范围'] || '');
  if (!['报名中', '进行中', '已结束'].includes(status)) return false;
  return !/不公开|仅管理员|内部限定/.test(visibility);
}

function publicEventProjection(project, sessions, registrations) {
  const eventId = String(project['活动ID'] || '');
  const related = registrations.filter((row) => String(row['活动ID'] || '') === eventId && row['报名状态'] !== '已取消');
  const capacity = Math.max(0, Math.floor(toFiniteNumber(project['容量'])));
  const confirmed = related.filter((row) => row['报名状态'] === '已确认').length;
  const waitlisted = related.filter((row) => row['报名状态'] === '候补').length;
  return {
    eventId,
    name: String(project['活动名称'] || '未命名活动'),
    type: String(project['活动类型'] || '公益活动'),
    description: String(project['活动简介'] || ''),
    campus: String(project['校区'] || ''),
    location: String(project['地点'] || ''),
    registrationStart: project['报名开始'] || null,
    registrationEnd: project['报名截止'] || null,
    startAt: project['活动开始'] || null,
    endAt: project['活动结束'] || null,
    status: String(project['状态'] || ''),
    capacity,
    confirmed,
    waitlisted,
    remaining: Math.max(0, capacity - confirmed),
    full: capacity > 0 && confirmed >= capacity,
    sessions: sessions
      .filter((row) => String(row['活动ID'] || '') === eventId)
      .map((row) => {
        const sessionKey = String(row['场次ID'] || row._id);
        const scoped = related.filter((item) => String(item['场次ID'] || '') === sessionKey);
        const sessionCapacity = Math.max(0, Math.floor(toFiniteNumber(row['容量'] || project['容量'])));
        const sessionConfirmed = scoped.filter((item) => item['报名状态'] === '已确认').length;
        return {
          sessionId: sessionKey,
          startAt: row['开始时间'] || null,
          endAt: row['结束时间'] || null,
          location: String(row['地点'] || project['地点'] || ''),
          capacity: sessionCapacity,
          confirmed: sessionConfirmed,
          remaining: Math.max(0, sessionCapacity - sessionConfirmed),
          full: sessionCapacity > 0 && sessionConfirmed >= sessionCapacity,
          checkinMethod: String(row['签到方式'] || ''),
        };
      })
      .sort((a, b) => String(a.startAt || '').localeCompare(String(b.startAt || ''))),
  };
}

async function getPublicEvents(client) {
  const [projects, sessions, registrations] = await Promise.all([
    safeRows(client, eventProjectTable, 200),
    safeRows(client, eventSessionTable, 500),
    safeRows(client, eventRegistrationTable, 1000),
  ]);
  return projects
    .filter(isPubliclyListed)
    .map((project) => publicEventProjection(project, sessions, registrations))
    .sort((a, b) => {
      const rank = (event) => (event.status === '报名中' ? 0 : event.status === '进行中' ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return String(a.startAt || '9999').localeCompare(String(b.startAt || '9999'));
    });
}
async function getMaterialsOverview(client) {
  const [applicationsRaw, inventoryRaw, configRaw] = await Promise.all([
    client.listRows(materialsTable, '', '', false, '', 100),
    client.listRows(inventoryTable, '', '', false, '', 100),
    client.listRows('物资配置表', '', '', false, '', 100),
  ]);
  const flowRaw = await client.listRows('物资流水表', '', '', false, '', 1000);
  const applications = applicationsRaw.map(applicationSummary);
  const applicationMap = new Map(applicationsRaw.map((row) => [row._id, row]));
  const configMap = new Map(configRaw.map((row) => [String(row['资产编码'] || ''), row]));
  const flowDelta = new Map();
  const flowStats = new Map();
  for (const flow of flowRaw) {
    const code = String(flow['资产编码'] || '');
    const quantity = toFiniteNumber(flow['数量']);
    const lossQuantity = Math.max(0, toFiniteNumber(flow['损耗数量']));
    const operation = String(flow['操作类型'] || '');
    const delta = ['入库', '归还', '盘点增加'].includes(operation) ? quantity : ['出库', '报损', '盘点减少'].includes(operation) ? -quantity : 0;
    if (code) flowDelta.set(code, (flowDelta.get(code) || 0) + delta);
    if (code) {
      const stats = flowStats.get(code) || { inbound: 0, outbound: 0, returned: 0, loss: 0, adjustment: 0, destinations: [] };
      if (operation === '入库') stats.inbound += quantity;
      if (operation === '出库') stats.outbound += quantity;
      if (operation === '归还') stats.returned += quantity;
      if (operation === '报损') stats.loss += quantity;
      stats.loss += operation === '归还' ? lossQuantity : 0;
      if (operation === '盘点增加') stats.adjustment += quantity;
      if (operation === '盘点减少') stats.adjustment -= quantity;
      const application = applicationMap.get(String(flow['申请单ID'] || ''));
      const flowDestination = String(flow['流转去向'] || '').trim();
      if (application || flowDestination) {
        const destination = { applicationId: application?._id || '', applicant: application ? maskedApplicant(application['姓名']) : '', purpose: application ? String(application['借用用途'] || '未填写') : '', label: flowDestination || `${maskedApplicant(application['姓名'])} · ${String(application['借用用途'] || '未填写')}`, quantity, date: flow['操作时间'] || null };
        if (!stats.destinations.some((item) => item.applicationId === destination.applicationId && item.purpose === destination.purpose)) stats.destinations.push(destination);
      }
      flowStats.set(code, stats);
    }
  }
  const inventory = inventoryRaw.map((row) => inventorySummary(row, { ...(configMap.get(materialCode(row)) || {}), __ledgerDelta: flowDelta.get(materialCode(row)) || 0, __flowStats: flowStats.get(materialCode(row)) || {} }));
  const pending = applications.filter((item) => item.status.includes('待审批') || item.approval === '待审核');
  const overdue = applications.filter((item) => item.overdueDays > 0);
  const abnormalReturns = applications.filter((item) => item.returnStatus.includes('物品缺失'));
  const lowStock = inventory.filter((item) => item.lowStock);
  const totalInitialQuantity = inventory.reduce((sum, item) => sum + item.initial, 0);
  const totalCurrentQuantity = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const totalDifference = inventory.reduce((sum, item) => sum + item.difference, 0);
  const totalUntrackedDifference = inventory.reduce((sum, item) => sum + item.untrackedDifference, 0);
  const totalLossQuantity = inventory.reduce((sum, item) => sum + item.loss, 0);
  const recentFlows = flowRaw.slice().sort((a, b) => String(b['操作时间'] || b._mtime || '').localeCompare(String(a['操作时间'] || a._mtime || ''))).slice(0, 8).map((flow) => ({
    id: flow._id,
    operation: String(flow['操作类型'] || '未标注'),
    material: String(flow['物资名称'] || '未标注'),
    assetCode: String(flow['资产编码'] || ''),
    quantity: toFiniteNumber(flow['数量']),
    loss: toFiniteNumber(flow['损耗数量']),
    before: toFiniteNumber(flow['操作前数量']),
    after: toFiniteNumber(flow['操作后数量']),
    operator: String(flow['操作人'] || '未标注'),
    date: flow['操作时间'] || null,
    note: String(flow['异常说明'] || ''),
    destination: (() => { const direct = String(flow['流转去向'] || '').trim(); if (direct) return direct; const application = applicationMap.get(String(flow['申请单ID'] || '')); return application ? `${maskedApplicant(application['姓名'])} · ${String(application['借用用途'] || '未填写')}` : ''; })(),
  }));
  return {
    ok: true, policy: { thresholdRule: '配置表阈值；未配置时回退 max(3, 初始数量 × 20%)', source: '物资配置表 + 物资流水表' },
    stats: { categoryCount: inventory.length, totalInventoryItems: inventory.length, totalInitialQuantity, totalCurrentQuantity, totalDifference, totalUntrackedDifference, totalLossQuantity, lowStockCount: lowStock.length, pendingCount: pending.length, borrowedCount: applications.filter((item) => !item.returned && item.status.includes('借出')).length, overdueCount: overdue.length, abnormalReturnCount: abnormalReturns.length, flowCount: flowRaw.length },
    series: dailySeries(flowRaw, {
      inbound: (row) => (['入库', '归还', '盘点增加'].includes(String(row['操作类型'] || '')) ? [row['操作时间'], toFiniteNumber(row['数量'])] : null),
      outbound: (row) => (['出库', '报损', '盘点减少'].includes(String(row['操作类型'] || '')) ? [row['操作时间'], toFiniteNumber(row['数量'])] : null),
    }),
    inventory, applications: applications.sort((a, b) => b.overdueDays - a.overdueDays), pending, overdue, abnormalReturns, lowStock, recentFlows,
  };
}

function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
const materialLocks = new Map();
async function withMaterialLock(assetCode, task) {
  const previous = materialLocks.get(assetCode) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  materialLocks.set(assetCode, current);
  await previous;
  try { return await task(); } finally { release(); if (materialLocks.get(assetCode) === current) materialLocks.delete(assetCode); }
}
function operationDelta(operation, quantity) {
  if (['入库', '归还', '盘点增加'].includes(operation)) return quantity;
  if (['出库', '盘点减少', '报损'].includes(operation)) return -quantity;
  return 0;
}
async function materialBundle(client) {
  const [inventory, configs, flows] = await Promise.all([
    client.listRows(inventoryTable, '', '', false, '', 100),
    client.listRows('物资配置表', '', '', false, '', 1000),
    client.listRows('物资流水表', '', '', false, '', 1000),
  ]);
  const configMap = new Map(configs.map((row) => [String(row['资产编码'] || ''), row]));
  const deltaMap = new Map();
  for (const flow of flows) {
    const code = String(flow['资产编码'] || '');
    const qty = toFiniteNumber(flow['数量']);
    const delta = operationDelta(String(flow['操作类型'] || ''), qty);
    if (code) deltaMap.set(code, (deltaMap.get(code) || 0) + delta);
  }
  const summaries = inventory.map((row) => inventorySummary(row, { ...(configMap.get(materialCode(row)) || {}), __ledgerDelta: deltaMap.get(materialCode(row)) || 0 }));
  return { inventory, configs, flows, summaries, summaryByCode: new Map(summaries.map((item) => [item.code, item])) };
}

async function sendOverdueReminders() {
  if (!smtpHost || !smtpUser || !smtpPassword || !reminderFrom) return { skipped: true, reason: 'SMTP is not configured' };
  const client = await getBase();
  const [applications, flows] = await Promise.all([
    client.listRows(materialsTable, '', '', false, '', 1000),
    client.listRows('物资流水表', '', '', false, '', 1000),
  ]);
  const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpSecure, auth: { user: smtpUser, pass: smtpPassword } });
  let sent = 0;
  for (const application of applications) {
    const email = String(application['邮箱'] || '').trim();
    const overdueDays = daysLate(application['拟归还日期']);
    const returned = Boolean(application['实际归还日期']) || String(application['归还状态'] || '').includes('已全部归还') || String(application['状态'] || '').includes('已归还');
    if (!email || !overdueDays || returned) continue;
    const key = `OVERDUE:${application._id}:${today()}`;
    if (flows.some((flow) => flow['幂等键'] === key)) continue;
    await transporter.sendMail({
      from: reminderFrom,
      to: email,
      subject: `南京大学红十字会物资归还提醒：已逾期 ${overdueDays} 天`,
      text: `您好，您借用的物资“${String(application['借用物资名及数量'] || '未填写')}”已逾期 ${overdueDays} 天。请联系物资管理员尽快归还。借用用途：${String(application['借用用途'] || '未填写')}。`,
    });
    await client.appendRow('物资流水表', {
      '流水编号': `REM-${randomBytes(7).toString('hex').toUpperCase()}`,
      '申请单ID': application._id,
      '资产编码': '',
      '物资名称': String(application['借用物资名及数量'] || '借用申请'),
      '操作类型': '逾期提醒',
      '数量': 0,
      '操作前数量': 0,
      '操作后数量': 0,
      '操作人': 'system-reminder',
      '操作时间': today(),
      '异常说明': `邮件已发送至 ${email}`,
      '幂等键': key,
    });
    sent += 1;
  }
  return { skipped: false, sent };
}
function transactionPayload(body, session, item) {
  const operation = String(body.operation || '').trim();
  const allowed = ['入库', '出库', '归还', '盘点增加', '盘点减少', '报损'];
  if (!allowed.includes(operation)) { const error = new Error('Unsupported material operation'); error.statusCode = 400; throw error; }
  const quantity = Math.round(toFiniteNumber(body.quantity));
  if (!Number.isInteger(quantity) || quantity <= 0) { const error = new Error('Quantity must be a positive integer'); error.statusCode = 400; throw error; }
  const lossQuantity = Math.round(toFiniteNumber(body.lossQuantity));
  if (!Number.isInteger(lossQuantity) || lossQuantity < 0 || lossQuantity > quantity) { const error = new Error('Loss quantity must be between 0 and the transaction quantity'); error.statusCode = 400; throw error; }
  const after = item.quantity + operationDelta(operation, quantity);
  if (after < 0) { const error = new Error(`Insufficient stock: available ${item.quantity} ${item.unit}`); error.statusCode = 409; throw error; }
  const idempotencyKey = String(body.idempotencyKey || '').trim() || randomBytes(16).toString('hex');
  return {
    row: { '流水编号': `TX-${randomBytes(7).toString('hex').toUpperCase()}`, '申请单ID': String(body.applicationId || ''), '资产编码': item.code, '物资名称': item.name, '操作类型': operation, '数量': quantity, '操作前数量': item.quantity, '操作后数量': after, '操作人': session.username, '操作时间': today(), '异常说明': String(body.note || '').trim(), '流转去向': String(body.destination || '').trim(), '损耗数量': lossQuantity, '幂等键': idempotencyKey },
    idempotencyKey,
  };
}

function materialRequestPayload(body) {
  const required = ['name', 'studentId', 'email', 'purpose', 'items', 'plannedBorrowDate', 'plannedReturnDate'];
  for (const key of required) {
    if (!String(body[key] || '').trim()) { const error = new Error(`Missing required field: ${key}`); error.statusCode = 400; throw error; }
  }
  const borrowDate = parsedDate(body.plannedBorrowDate);
  const returnDate = parsedDate(body.plannedReturnDate);
  if (!borrowDate || !returnDate || returnDate < borrowDate) { const error = new Error('Planned return date must be on or after the planned borrow date'); error.statusCode = 400; throw error; }
  return {
    '姓名': String(body.name).trim(), '学号': String(body.studentId).trim(), '邮箱': String(body.email).trim(), '借用用途': String(body.purpose).trim(), '借用物资名及数量': String(body.items).trim(), '借用件数': Math.max(1, Math.round(toFiniteNumber(body.quantity) || 1)),
    '拟借用日期': body.plannedBorrowDate, '拟归还日期': body.plannedReturnDate, '状态': '待审批',
  };
}

function hash(value) { return createHash('sha256').update(String(value)).digest(); }
function safeEqual(left, right) { return timingSafeEqual(hash(left), hash(right)); }
function sign(value) { return createHmac('sha256', sessionSecret).update(value).digest('base64url'); }

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const value = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function makeSession(account) {
  const payload = Buffer.from(JSON.stringify({ username: account.username, role: account.role, exp: Date.now() + sessionTtlSeconds * 1000, csrf: randomBytes(32).toString('base64url') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function getSession(req) {
  const token = cookieValue(req, 'nju_redcross_session');
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const account = accountsByUsername.get(session.username);
    if (!account || session.role !== account.role || !session.csrf || !Number.isFinite(session.exp) || session.exp <= Date.now()) return null;
    return session;
  } catch { return null; }
}

function sessionCookie(value, maxAge = sessionTtlSeconds) {
  return `nju_redcross_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
}

function clientIp(req) { return req.socket.remoteAddress || 'unknown'; }
function loginStatus(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return { allowed: true };
  const now = Date.now();
  if (entry.blockedUntil > now) return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  if (entry.resetAt <= now) loginAttempts.delete(ip);
  return { allowed: true };
}
function recordFailedLogin(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  const entry = !current || current.resetAt <= now ? { attempts: 0, resetAt: now + 15 * 60 * 1000, blockedUntil: 0 } : current;
  entry.attempts += 1;
  if (entry.attempts >= 5) entry.blockedUntil = now + 15 * 60 * 1000;
  loginAttempts.set(ip, entry);
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { ok: false, message: '请先登录平台。' });
    return null;
  }
  return session;
}

function requireWriteAccess(req, res, session) {
  if (session.role !== 'platform_admin') {
    json(res, 403, { ok: false, message: '当前账号没有写入权限。' });
    return false;
  }
  const csrf = req.headers['x-csrf-token'];
  if (typeof csrf !== 'string' || !safeEqual(csrf, session.csrf)) {
    json(res, 403, { ok: false, message: 'CSRF 校验失败，请刷新页面后重试。' });
    return false;
  }
  return true;
}

function sessionPayload(session) {
  return { ok: true, authenticated: true, user: { username: session.username, role: session.role }, csrfToken: session.csrf, expiresAt: session.exp };
}

async function authApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const session = getSession(req);
    return json(res, 200, session ? sessionPayload(session) : { ok: true, authenticated: false });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const ip = clientIp(req);
    const status = loginStatus(ip);
    if (!status.allowed) return json(res, 429, { ok: false, message: `登录尝试过多，请 ${status.retryAfter} 秒后重试。` }, { 'Retry-After': String(status.retryAfter) });
    const body = await readJson(req);
    const account = accountsByUsername.get(String(body.username || '').trim());
    if (!account || !safeEqual(body.password || '', account.password)) {
      recordFailedLogin(ip);
      return json(res, 401, { ok: false, message: '用户名或密码错误。' });
    }
    loginAttempts.delete(ip);
    const token = makeSession(account);
    const session = getSession({ headers: { cookie: `nju_redcross_session=${token}` } });
    return json(res, 200, sessionPayload(session), { 'Set-Cookie': sessionCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const session = requireSession(req, res);
    if (!session || !requireWriteAccess(req, res, session)) return;
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  return false;
}

const publicPrograms = [
  { id: 'events', name: '活动报名与现场签到', summary: '急救培训、无偿献血宣传、生命教育课程与校园公益活动的统一报名入口，报名后生成个人签到凭证。', action: '/events', iconName: 'calendar' },
  { id: 'materials', name: '物资借用申请', summary: '面向班级、社团与校园活动的急救箱、宣传物料与器材借用；申请提交后由物资管理员审批并登记出入库。', action: '/materials', iconName: 'box' },
  { id: 'outreach', name: '宣传内容征集', summary: '投递稿件、摄影、设计与活动记录。所有内容均经过人工审核，并在你授权的范围内使用。', action: '/submit', iconName: 'megaphone' },
  { id: 'warmth', name: '温暖连接', summary: '生日祝福与早安晚安同行计划。完全自愿加入、随时退出，内容先经人工审核后再转达。', action: '/warmth', iconName: 'heart' },
];

async function getPublicOverview(client) {
  const events = await getPublicEvents(client);
  const [inventory, volunteerSummary] = await Promise.all([
    safeRows(client, inventoryTable, 100),
    volunteerBase ? getVolunteerOverview(await getVolunteerBase()).catch(() => null) : Promise.resolve(null),
  ]);
  const open = events.filter((event) => event.status === '报名中');
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    stats: {
      openEvents: open.length,
      openSeats: open.reduce((sum, event) => sum + event.remaining, 0),
      totalRegistrations: events.reduce((sum, event) => sum + event.confirmed + event.waitlisted, 0),
      inventoryCategories: inventory.length,
      volunteerRecords: volunteerSummary?.stats?.registrations ?? null,
    },
    featured: open.slice(0, 6),
    recent: events.filter((event) => event.status !== '报名中').slice(0, 4),
    programs: publicPrograms,
    emailDomains: publicEmailDomains,
  };
}

/**
 * Unauthenticated surface. Read paths expose aggregate and event data only;
 * write paths are rate limited, consent gated and never echo personal data.
 */
async function publicRoutes(req, res, url) {
  if (!url.pathname.startsWith('/api/public/')) return false;
  const client = await getBase();

  if (req.method === 'GET' && url.pathname === '/api/public/overview') {
    return json(res, 200, await getPublicOverview(client));
  }

  if (req.method === 'GET' && url.pathname === '/api/public/events') {
    const all = await getPublicEvents(client);
    const status = String(url.searchParams.get('status') || '').trim();
    const campus = String(url.searchParams.get('campus') || '').trim();
    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const filtered = all.filter((event) => {
      if (status && event.status !== status) return false;
      if (campus && event.campus !== campus) return false;
      if (query && !`${event.name} ${event.type} ${event.description} ${event.location}`.toLowerCase().includes(query)) return false;
      return true;
    });
    return json(res, 200, {
      ok: true,
      stats: { total: all.length, open: all.filter((event) => event.status === '报名中').length, closed: all.filter((event) => event.status === '已结束').length },
      facets: {
        campuses: [...new Set(all.map((event) => event.campus).filter(Boolean))],
        types: [...new Set(all.map((event) => event.type).filter(Boolean))],
        statuses: [...new Set(all.map((event) => event.status).filter(Boolean))],
      },
      events: filtered,
    });
  }

  const eventDetail = url.pathname.match(/^\/api\/public\/events\/([^/]+)$/);
  if (eventDetail && req.method === 'GET') {
    const key = decodeURIComponent(eventDetail[1]);
    const events = await getPublicEvents(client);
    const event = events.find((item) => item.eventId === key);
    if (!event) return json(res, 404, { ok: false, message: '活动不存在或尚未公开。' });
    return json(res, 200, { ok: true, event, related: events.filter((item) => item.eventId !== key && item.status === '报名中').slice(0, 3), emailDomains: publicEmailDomains });
  }

  const publicRegistration = url.pathname.match(/^\/api\/public\/events\/([^/]+)\/registrations$/);
  if (publicRegistration && req.method === 'POST') {
    enforcePublicLimit(req, 'register', 6);
    const body = await readJson(req);
    const outcome = await registerForEvent(client, {
      eventKey: decodeURIComponent(publicRegistration[1]),
      body,
      participantRef: 'public-portal',
      restrictEmailDomain: true,
    });
    await recordAudit(req, { username: 'public-portal', role: 'public' }, 'public.event.registration', outcome.row['报名ID'], 'success', { eventId: outcome.project['活动ID'], status: outcome.status });
    return json(res, 201, {
      ok: true,
      registration: {
        code: outcome.row['报名ID'],
        status: outcome.status,
        waitlist: outcome.waitlist,
        eventName: outcome.project['活动名称'],
        sessionStartAt: outcome.session?.['开始时间'] || outcome.project['活动开始'] || null,
        location: outcome.session?.['地点'] || outcome.project['地点'] || '',
        checkinToken: outcome.token,
        qrDataUrl: outcome.qrDataUrl,
      },
      message: outcome.status === '已确认' ? '报名成功，请保存签到凭证。' : `活动名额已满，你目前是候补第 ${outcome.waitlist} 位。`,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/registrations/lookup') {
    enforcePublicLimit(req, 'lookup', 30);
    const body = await readJson(req);
    const code = requiredText(body.code, '报名编号', 60);
    const email = requiredText(body.email, '报名邮箱', 160).toLowerCase();
    const [registrations, projects, sessions] = await Promise.all([
      safeRows(client, eventRegistrationTable, 1000),
      safeRows(client, eventProjectTable, 200),
      safeRows(client, eventSessionTable, 500),
    ]);
    const record = registrations.find((row) => String(row['报名ID'] || '').toUpperCase() === code.toUpperCase() && String(row['南大邮箱'] || '').toLowerCase() === email);
    if (!record) return json(res, 404, { ok: false, message: '没有找到匹配的报名记录，请核对报名编号与邮箱。' });
    const project = projects.find((row) => row['活动ID'] === record['活动ID']);
    const eventSession = sessions.find((row) => String(row['场次ID'] || '') === String(record['场次ID'] || ''));
    return json(res, 200, {
      ok: true,
      registration: {
        code: String(record['报名ID'] || ''),
        status: String(record['报名状态'] || ''),
        waitlist: toFiniteNumber(record['候补序号']),
        submittedAt: record['提交时间'] || null,
        checkedInAt: record['签到时间'] || null,
        cancelledAt: record['取消时间'] || null,
        eventName: String(project?.['活动名称'] || '未命名活动'),
        eventStatus: String(project?.['状态'] || ''),
        startAt: eventSession?.['开始时间'] || project?.['活动开始'] || null,
        location: String(eventSession?.['地点'] || project?.['地点'] || ''),
      },
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/materials/requests') {
    enforcePublicLimit(req, 'materials', 5);
    const body = await readJson(req);
    assertPublicEmail(String(body.email || '').trim());
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认物资借用与归还责任条款。' });
    const row = materialRequestPayload(body);
    const result = await client.appendRow(materialsTable, row);
    await recordAudit(req, { username: 'public-portal', role: 'public' }, 'public.materials.application', result?._id || 'new', 'success', { purpose: row['借用用途'], quantity: row['借用件数'] });
    return json(res, 201, {
      ok: true,
      request: { code: `REQ-${result?._id || ''}`, status: '待审批', items: row['借用物资名及数量'], plannedBorrowDate: row['拟借用日期'], plannedReturnDate: row['拟归还日期'] },
      message: '借用申请已提交，等待物资管理员审批。',
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/submissions') {
    enforcePublicLimit(req, 'submissions', 8);
    const body = await readJson(req);
    const title = requiredText(body.title, '标题', 120);
    const content = requiredText(body.content, '正文', 4000);
    const category = String(body.category || '宣传稿件').trim();
    const email = assertPublicEmail(requiredText(body.email, '联系邮箱', 160));
    const name = requiredText(body.name, '联系人', 60);
    if (body.originalConfirm !== true) return json(res, 400, { ok: false, message: '请确认内容为原创或已获得授权。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认内容使用范围与审核规则。' });
    const submissions = await readPublicSubmissions();
    const submission = {
      id: eventIdentifier('SUB'),
      title, content, category,
      signature: String(body.signature || '实名署名').trim(),
      contactName: name,
      contactEmail: email,
      originalConfirm: true,
      portraitConfirm: body.portraitConfirm === true,
      status: '待审核',
      submittedAt: new Date().toISOString(),
      consentVersion: 'v1',
      review: null,
    };
    submissions.push(submission);
    await savePublicSubmissions(submissions);
    await recordAudit(req, { username: 'public-portal', role: 'public' }, 'public.submission.create', submission.id, 'success', { category, length: content.length });
    return json(res, 201, { ok: true, submission: { id: submission.id, status: submission.status, submittedAt: submission.submittedAt, title }, message: '投稿已提交，进入人工审核队列。' });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/warmth/interest') {
    enforcePublicLimit(req, 'warmth', 5);
    const body = await readJson(req);
    const program = String(body.program || '').trim();
    if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目。' });
    const frequency = String(body.frequency || '').trim();
    if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率。' });
    const nickname = requiredText(body.nickname, '显示昵称', 40);
    const email = assertPublicEmail(requiredText(body.email, '联系邮箱', 160));
    if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出与人工审核规则。' });
    const interests = await readWarmthInterests();
    if (interests.some((item) => item.email === email && item.program === program && item.status !== '已退出')) {
      return json(res, 409, { ok: false, message: '该邮箱已经登记过这个项目，无需重复提交。' });
    }
    const interest = {
      id: eventIdentifier('WARM'),
      program, frequency, nickname, email,
      campus: String(body.campus || '').trim(),
      birthdayMonthDay: program === 'birthday' ? String(body.birthdayMonthDay || '').trim().slice(0, 5) : '',
      note: String(body.note || '').trim().slice(0, 300),
      status: '待人工确认',
      consentVersion: 'v1',
      submittedAt: new Date().toISOString(),
    };
    interests.push(interest);
    await saveWarmthInterests(interests);
    await recordAudit(req, { username: 'public-portal', role: 'public' }, 'public.warmth.interest', interest.id, 'success', { program, frequency });
    return json(res, 201, {
      ok: true,
      interest: { id: interest.id, program, frequency, status: interest.status },
      message: '已记录你的参加意愿。平台不会自动发送内容，所有内容都会先经人工审核。',
    });
  }

  return json(res, 404, { ok: false, message: 'Not found' });
}

async function api(req, res, url) {
  try {
    if (url.pathname.startsWith('/api/public/')) {
      return await publicRoutes(req, res, url);
    }
    if (url.pathname.startsWith('/api/auth/')) {
      const handled = await authApi(req, res, url);
      if (handled !== false) return handled;
    }
    const session = requireSession(req, res);
    if (!session) return;
    const isWrite = ['POST', 'PUT', 'DELETE'].includes(req.method);
    if (isWrite && !requireWriteAccess(req, res, session)) return;
    const client = await getBase();

    if (req.method === 'GET' && url.pathname === '/api/materials/overview') {
      return json(res, 200, await getMaterialsOverview(client));
    }
    const qrMatch = url.pathname.match(/^\/api\/materials\/inventory\/([^/]+)\/qr$/);
    if (qrMatch && req.method === 'GET') {
      const [inventory, configs] = await Promise.all([client.listRows(inventoryTable, '', '', false, '', 100), client.listRows('物资配置表', '', '', false, '', 100)]);
      const row = inventory.find((item) => item._id === decodeURIComponent(qrMatch[1]));
      if (!row) return json(res, 404, { ok: false, message: 'Inventory item not found' });
      const svg = await QRCode.toString(materialCode(row), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#520d2e', light: '#fffdfb' } });
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
    if (req.method === 'GET' && url.pathname === '/api/materials/scan') {
      const code = String(url.searchParams.get('code') || '').trim();
      if (!/^NJU-RC-[A-Za-z0-9_-]+$/.test(code)) return json(res, 400, { ok: false, message: 'Unsupported inventory QR code' });
      const [inventory, configs] = await Promise.all([client.listRows(inventoryTable, '', '', false, '', 100), client.listRows('物资配置表', '', '', false, '', 100)]);
      const row = inventory.find((item) => materialCode(item) === code);
      if (!row) return json(res, 404, { ok: false, message: 'Inventory QR code is not registered in this Base' });
      const config = configs.find((item) => item['资产编码'] === code) || {};
      return json(res, 200, { ok: true, item: inventorySummary(row, config) });
    }
    if (req.method === 'POST' && url.pathname === '/api/materials/applications') {
      const body = await readJson(req);
      const row = materialRequestPayload(body);
      const result = await client.appendRow(materialsTable, row);
      await recordAudit(req, session, 'materials.application.create', result?._id || 'new', 'success', { quantity: row['借用件数'], purpose: row['借用用途'] });
      return json(res, 201, { ok: true, result, message: 'Application submitted for approval' });
    }
    const applicationAction = url.pathname.match(/^\/api\/materials\/applications\/([^/]+)\/(approve|reject)$/);
    if (applicationAction && req.method === 'POST') {
      const applicationId = decodeURIComponent(applicationAction[1]);
      const rows = await client.listRows(materialsTable, '', '', false, '', 1000);
      const application = rows.find((row) => row._id === applicationId);
      if (!application) return json(res, 404, { ok: false, message: 'Application not found' });
      if (!String(application['状态'] || '').includes('待审批')) return json(res, 409, { ok: false, message: 'Only pending applications can be reviewed' });
      const body = await readJson(req);
      const approved = applicationAction[2] === 'approve';
      if (!approved && !String(body.reason || '').trim()) return json(res, 400, { ok: false, message: 'Rejection reason is required' });
      const patch = approved ? { '借出审批': '审批通过', '状态': '开始' } : { '借出审批': '审批不通过', '状态': '审批不通过', '不通过理由': String(body.reason).trim() };
      const result = await client.updateRow(materialsTable, applicationId, patch);
      await recordAudit(req, session, approved ? 'materials.application.approve' : 'materials.application.reject', applicationId, 'success', { reason: approved ? '' : String(body.reason).trim() });
      return json(res, 200, { ok: true, result, message: approved ? 'Application approved' : 'Application rejected' });
    }
    const transactionAction = url.pathname.match(/^\/api\/materials\/applications\/([^/]+)\/(checkout|return)$/);
    if (transactionAction && req.method === 'POST') {
      const applicationId = decodeURIComponent(transactionAction[1]);
      const { body, photo } = await readMaterialAction(req);
      const assetCode = String(body.assetCode || '').trim();
      const operation = transactionAction[2] === 'checkout' ? '出库' : '归还';
      return await withMaterialLock(assetCode, async () => {
        const [rows, bundle] = await Promise.all([
          client.listRows(materialsTable, '', '', false, '', 1000),
          materialBundle(client),
        ]);
        const application = rows.find((row) => row._id === applicationId);
        if (!application) return json(res, 404, { ok: false, message: 'Application not found' });
        const item = bundle.summaryByCode.get(assetCode);
        if (!item) return json(res, 404, { ok: false, message: 'Inventory asset code not found' });
        if (operation === '出库' && String(application['借出审批'] || '') !== '审批通过') return json(res, 409, { ok: false, message: 'Application must be approved before checkout' });
        if (operation === '出库' && String(application['状态'] || '').includes('借出')) return json(res, 409, { ok: false, message: 'Application has already been checked out' });
        if (operation === '归还' && !String(application['状态'] || '').includes('借出')) return json(res, 409, { ok: false, message: 'Only checked-out applications can be returned' });
        if (operation === '出库' && !photo) return json(res, 400, { ok: false, message: 'Checkout photo is required' });
        const existingKey = String(body.idempotencyKey || '').trim();
        if (existingKey && bundle.flows.some((flow) => flow['幂等键'] === existingKey)) return json(res, 200, { ok: true, duplicate: true, message: 'Operation already recorded' });
        const destination = String(body.destination || '').trim() || `${maskedApplicant(application['姓名'])} · ${String(application['借用用途'] || '未填写')}`;
        const transaction = transactionPayload({ ...body, operation, applicationId, destination }, session, item);
        const photoPath = await uploadSeaTableImage(photo);
        const result = await client.appendRow('物资流水表', transaction.row);
        const applicationPatch = operation === '出库' ? { '状态': '借出（物资）', '实际借用日期': today() } : (() => {
          const borrowed = Math.max(1, Math.round(toFiniteNumber(application['借用件数'])));
          const physicalReturned = Math.round(toFiniteNumber(application['归还件数'])) + Math.round(toFiniteNumber(body.quantity));
          const lossQuantity = Math.round(toFiniteNumber(body.lossQuantity));
          const accounted = physicalReturned + lossQuantity;
          const full = accounted >= borrowed;
          const hasDamage = lossQuantity > 0 || Boolean(String(body.note || '').trim());
          return { '归还件数': physicalReturned, '归还状态': full && !hasDamage ? '已全部归还' : '物品缺失/数量减少', ...(full ? { '实际归还日期': today(), '状态': '已归还' } : {}) };
        })();
        if (operation === '出库' && photoPath) {
          const existingPhotos = Array.isArray(application['物资出库照片']) ? application['物资出库照片'] : [];
          applicationPatch['物资出库照片'] = [...existingPhotos, photoPath];
        }
        if (operation === '归还' && photoPath) {
          const existingPhotos = Array.isArray(application['物资归还照片']) ? application['物资归还照片'] : [];
          applicationPatch['物资归还照片'] = [...existingPhotos, photoPath];
        }
        try {
          await client.updateRow(materialsTable, applicationId, applicationPatch);
        } catch (error) {
          if (result?._id) await client.updateRow('物资流水表', result._id, { '异常说明': `申请状态同步失败：${error.message}` }).catch(() => {});
          const syncError = new Error('流水已记录，但申请状态同步失败，请人工核对后再继续操作');
          syncError.statusCode = 502;
          throw syncError;
        }
        await recordAudit(req, session, operation === '出库' ? 'materials.checkout' : 'materials.return', applicationId, 'success', { assetCode, quantity: transaction.row['数量'], lossQuantity: transaction.row['损耗数量'] });
        return json(res, 201, { ok: true, result, message: operation === '出库' ? 'Checkout recorded' : 'Return recorded' });
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/materials/transactions') {
      const body = await readJson(req);
      const assetCode = String(body.assetCode || '').trim();
      return await withMaterialLock(assetCode, async () => {
        const bundle = await materialBundle(client);
        const item = bundle.summaryByCode.get(assetCode);
        if (!item) return json(res, 404, { ok: false, message: 'Inventory asset code not found' });
        const idempotencyKey = String(body.idempotencyKey || '').trim();
        if (idempotencyKey && bundle.flows.some((flow) => flow['幂等键'] === idempotencyKey)) return json(res, 200, { ok: true, duplicate: true, message: 'Operation already recorded' });
        const transaction = transactionPayload(body, session, item);
        const result = await client.appendRow('物资流水表', transaction.row);
        await recordAudit(req, session, `materials.${transaction.row['操作类型']}`, result?._id || 'new', 'success', { assetCode, quantity: transaction.row['数量'] });
        return json(res, 201, { ok: true, result, message: 'Inventory transaction recorded' });
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/events/schema-preview') {
      const metadata = await client.getMetadata();
      const currentTables = new Map((metadata?.tables || []).map((table) => [table.name, table]));
      const preview = activitySchema.map((definition) => {
        const table = currentTables.get(definition.name);
        const existingColumns = new Set((table?.columns || []).map((column) => column.name));
        return {
          ...definition,
          exists: Boolean(table),
          tableId: table?._id || null,
          matchedColumns: definition.columns.filter((column) => existingColumns.has(column)),
          missingColumns: definition.columns.filter((column) => !existingColumns.has(column)),
          extraColumns: table ? (table.columns || []).map((column) => column.name).filter((column) => !definition.columns.includes(column)) : [],
        };
      });
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, tables: preview });
    }
    if (req.method === 'GET' && url.pathname === '/api/outreach/schema-preview') {
      const metadata = await client.getMetadata();
      const currentTables = new Map((metadata?.tables || []).map((table) => [table.name, table]));
      const preview = outreachSchema.map((definition) => {
        const table = currentTables.get(definition.name);
        const existingColumns = new Set((table?.columns || []).map((column) => column.name));
        return { ...definition, exists: Boolean(table), tableId: table?._id || null, matchedColumns: definition.columns.filter((column) => existingColumns.has(column)), missingColumns: definition.columns.filter((column) => !existingColumns.has(column)), extraColumns: table ? (table.columns || []).map((column) => column.name).filter((column) => !definition.columns.includes(column)) : [] };
      });
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, tables: preview });
    }
    if (req.method === 'GET' && url.pathname === '/api/events/overview') {
      return json(res, 200, await getEventsOverview(client));
    }
    if (req.method === 'POST' && url.pathname === '/api/events') {
      const body = await readJson(req);
      const row = eventPayload(body, session);
      const result = await client.appendRow(eventProjectTable, row);
      await recordAudit(req, session, 'event.create', row['活动ID'], 'success', { title: row['活动名称'], status: row['状态'] });
      return json(res, 201, { ok: true, result, event: { ...row, id: result?._id || null }, message: '活动已创建，当前为草稿状态' });
    }
    const eventSession = url.pathname.match(/^\/api\/events\/([^/]+)\/sessions$/);
    if (eventSession && req.method === 'POST') {
      const eventKey = decodeURIComponent(eventSession[1]);
      const body = await readJson(req);
      const [projects, sessions] = await Promise.all([
        client.listRows(eventProjectTable, '', '', false, '', 500),
        client.listRows(eventSessionTable, '', '', false, '', 500),
      ]);
      const project = projects.find((row) => row._id === eventKey || row['活动ID'] === eventKey);
      if (!project) return json(res, 404, { ok: false, message: '活动不存在' });
      const startAt = requiredText(body.startAt, '场次开始时间', 80);
      const endAt = String(body.endAt || '').trim();
      const location = String(body.location || project['地点'] || '').trim();
      const capacity = Math.max(1, Math.floor(Number(body.capacity || project['容量'] || 0)));
      if (!Number.isInteger(capacity) || capacity <= 0) return json(res, 400, { ok: false, message: '场次容量必须是正整数' });
      const duplicate = sessions.some((row) => row['活动ID'] === project['活动ID'] && row['开始时间'] === startAt);
      if (duplicate) return json(res, 409, { ok: false, message: '相同开始时间的场次已存在' });
      const row = { 场次ID: eventIdentifier('SES'), 活动ID: project['活动ID'], 开始时间: startAt, 结束时间: endAt, 地点: location, 容量: String(capacity), 签到开放: String(body.checkinOpen || startAt).trim(), 签到方式: '二维码+人工核验', 状态: '待发布' };
      const result = await client.appendRow(eventSessionTable, row);
      await recordAudit(req, session, 'event.session.create', row['场次ID'], 'success', { eventId: project['活动ID'], startAt });
      return json(res, 201, { ok: true, result, session: { ...row, id: result?._id || null }, message: '活动场次已创建' });
    }
    const eventAction = url.pathname.match(/^\/api\/events\/([^/]+)\/(publish|close)$/);
    if (eventAction && req.method === 'POST') {
      const eventRowId = decodeURIComponent(eventAction[1]);
      const projects = await client.listRows(eventProjectTable, '', '', false, '', 500);
      const project = projects.find((row) => row._id === eventRowId || row['活动ID'] === eventRowId);
      if (!project) return json(res, 404, { ok: false, message: '活动不存在' });
      const status = eventAction[2] === 'publish' ? '报名中' : '已结束';
      const result = await client.updateRow(eventProjectTable, project._id, { 状态: status });
      await recordAudit(req, session, `event.${eventAction[2]}`, project['活动ID'], 'success', { from: project['状态'] || '草稿', to: status });
      return json(res, 200, { ok: true, result, status, message: eventAction[2] === 'publish' ? '活动已发布' : '活动已关闭' });
    }
    const eventRegistration = url.pathname.match(/^\/api\/events\/([^/]+)\/registrations$/);
    if (eventRegistration && req.method === 'POST') {
      const body = await readJson(req);
      const outcome = await registerForEvent(client, { eventKey: decodeURIComponent(eventRegistration[1]), body, participantRef: session.username });
      await recordAudit(req, session, 'event.registration.create', outcome.row['报名ID'], 'success', { eventId: outcome.project['活动ID'], status: outcome.status, channel: 'console' });
      return json(res, 201, {
        ok: true,
        result: outcome.result,
        registration: { id: outcome.result?._id || null, code: outcome.row['报名ID'], status: outcome.status, waitlist: outcome.waitlist, checkinToken: outcome.token, qrDataUrl: outcome.qrDataUrl },
        message: outcome.status === '已确认' ? '报名成功' : `活动已满，当前为候补第 ${outcome.waitlist} 位`,
      });
    }
    const registrationAction = url.pathname.match(/^\/api\/events\/registrations\/([^/]+)\/(cancel|check-in)$/);
    if (registrationAction && req.method === 'POST') {
      const registrationId = decodeURIComponent(registrationAction[1]);
      const rows = await client.listRows(eventRegistrationTable, '', '', false, '', 1000);
      const registration = rows.find((row) => row._id === registrationId || row['报名ID'] === registrationId);
      if (!registration) return json(res, 404, { ok: false, message: '报名记录不存在' });
      if (registrationAction[2] === 'cancel') {
        const result = await client.updateRow(eventRegistrationTable, registration._id, { 报名状态: '已取消', 取消时间: new Date().toISOString() });
        await recordAudit(req, session, 'event.registration.cancel', registration['报名ID'], 'success', { eventId: registration['活动ID'] });
        return json(res, 200, { ok: true, result, message: '报名已取消' });
      }
      if (registration['报名状态'] === '已取消') return json(res, 409, { ok: false, message: '已取消的报名不能签到' });
      if (String(registration['报名状态'] || '') === '已签到' || String(registration['签到时间'] || '').trim()) return json(res, 409, { ok: false, message: '该报名已经签到，不能重复签到' });
      const body = await readJson(req);
      const token = String(body.token || '').trim();
      if (registration['签到码摘要'] && (!token || eventCheckinHash(token) !== registration['签到码摘要'])) {
        await recordAudit(req, session, 'event.registration.checkin', registration['报名ID'], 'rejected', { reason: 'invalid-token', eventId: registration['活动ID'] });
        return json(res, 403, { ok: false, message: '签到码无效，请出示报名二维码' });
      }
      const result = await client.updateRow(eventRegistrationTable, registration._id, { 报名状态: '已签到', 签到时间: new Date().toISOString() });
      await recordAudit(req, session, 'event.registration.checkin', registration['报名ID'], 'success', { eventId: registration['活动ID'] });
      return json(res, 200, { ok: true, result, message: '签到成功' });
    }
    if (req.method === 'GET' && url.pathname === '/api/audit/recent') {
      return json(res, 200, { ok: true, source: 'local-jsonl', entries: await readRecentAudit(Number(url.searchParams.get('limit') || 50)) });
    }
    if (req.method === 'GET' && url.pathname === '/api/volunteer/overview') {
      const volunteerClient = await getVolunteerBase();
      return json(res, 200, await getVolunteerOverview(volunteerClient));
    }
    if (req.method === 'GET' && url.pathname === '/api/outreach/overview') {
      return json(res, 200, await getOutreachOverview(client));
    }
    const outreachReview = url.pathname.match(/^\/api\/outreach\/reviews\/([^/]+)$/);
    if (outreachReview && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachReview[1]);
      if (!/^(planning|creative|feedback):[A-Za-z0-9_-]+$/.test(contentId)) return json(res, 400, { ok: false, message: '投稿标识格式不正确' });
      const body = await readJson(req);
      const decision = String(body.decision || '').trim();
      if (!['approve', 'return'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve 或 return' });
      const note = String(body.note || '').trim();
      if (decision === 'return' && !note) return json(res, 400, { ok: false, message: '退回修改必须填写审核意见' });
      const reviews = await readOutreachReviews();
      const review = { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() };
      reviews[contentId] = review;
      await saveOutreachReviews(reviews);
      await recordAudit(req, session, `outreach.review.${decision}`, contentId, 'success', { noteLength: note.length });
      return json(res, 200, { ok: true, review, message: decision === 'approve' ? '内容审核通过' : '内容已退回修改' });
    }
    const outreachPublication = url.pathname.match(/^\/api\/outreach\/publications\/([^/]+)\/schedule$/);
    if (outreachPublication && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachPublication[1]);
      const reviews = await readOutreachReviews();
      if (reviews[contentId]?.decision !== 'approve') return json(res, 409, { ok: false, message: '只有审核通过的内容才能排期' });
      const body = await readJson(req);
      const channel = String(body.channel || '').trim();
      if (!['site', 'email', 'wechat', 'qq'].includes(channel)) return json(res, 400, { ok: false, message: '不支持该发布渠道' });
      const plannedAt = parsedDate(body.plannedAt);
      if (!plannedAt) return json(res, 400, { ok: false, message: '请输入有效的计划发布时间' });
      const publications = await readOutreachPublications();
      const task = { taskId: eventIdentifier('PUB'), contentId, channel, plannedAt: plannedAt.toISOString(), status: '待人工发布', note: String(body.note || '').trim(), createdBy: session.username, createdAt: new Date().toISOString(), retryCount: 0 };
      publications[contentId] = task;
      await saveOutreachPublications(publications);
      await recordAudit(req, session, 'outreach.publication.schedule', task.taskId, 'success', { contentId, channel, plannedAt: task.plannedAt });
      return json(res, 201, { ok: true, task, message: '发布任务已排期，等待人工确认' });
    }
    const outreachPublicationResult = url.pathname.match(/^\/api\/outreach\/publications\/([^/]+)\/result$/);
    if (outreachPublicationResult && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachPublicationResult[1]);
      const body = await readJson(req);
      const status = String(body.status || '').trim();
      if (!['published', 'failed'].includes(status)) return json(res, 400, { ok: false, message: '发布结果必须是 published 或 failed' });
      const publications = await readOutreachPublications();
      const task = publications[contentId];
      if (!task) return json(res, 404, { ok: false, message: '发布任务不存在' });
      const failureReason = String(body.failureReason || '').trim();
      if (status === 'failed' && !failureReason) return json(res, 400, { ok: false, message: '发布失败必须填写原因' });
      const updated = { ...task, status: status === 'published' ? '已发布' : '发布失败待重试', resultAt: new Date().toISOString(), publishedLink: String(body.publishedLink || '').trim(), failureReason, retryCount: status === 'failed' ? Number(task.retryCount || 0) + 1 : Number(task.retryCount || 0), resultBy: session.username };
      publications[contentId] = updated;
      await saveOutreachPublications(publications);
      await recordAudit(req, session, `outreach.publication.${status}`, task.taskId, 'success', { contentId, retryCount: updated.retryCount });
      return json(res, 200, { ok: true, task: updated, message: status === 'published' ? '已记录发布结果' : '已记录失败，可人工重试' });
    }
    if (req.method === 'GET' && url.pathname === '/api/outreach/public-submissions') {
      const submissions = await readPublicSubmissions();
      return json(res, 200, {
        ok: true,
        stats: {
          total: submissions.length,
          pending: submissions.filter((item) => item.status === '待审核').length,
          approved: submissions.filter((item) => item.status === '已通过').length,
          returned: submissions.filter((item) => item.status === '需修改').length,
        },
        submissions: submissions.slice(-60).reverse().map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          signature: item.signature,
          excerpt: String(item.content || '').slice(0, 220),
          content: item.content,
          contact: maskedApplicant(item.contactName),
          contactEmail: maskedEmail(item.contactEmail),
          portraitConfirm: item.portraitConfirm,
          status: item.status,
          submittedAt: item.submittedAt,
          review: item.review || null,
        })),
      });
    }
    const publicSubmissionReview = url.pathname.match(/^\/api\/outreach\/public-submissions\/([^/]+)\/review$/);
    if (publicSubmissionReview && req.method === 'POST') {
      const submissionId = decodeURIComponent(publicSubmissionReview[1]);
      const body = await readJson(req);
      const decision = String(body.decision || '').trim();
      if (!['approve', 'return'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve 或 return' });
      const note = String(body.note || '').trim();
      if (decision === 'return' && !note) return json(res, 400, { ok: false, message: '退回修改必须填写审核意见' });
      const submissions = await readPublicSubmissions();
      const index = submissions.findIndex((item) => item.id === submissionId);
      if (index < 0) return json(res, 404, { ok: false, message: '投稿不存在' });
      submissions[index] = {
        ...submissions[index],
        status: decision === 'approve' ? '已通过' : '需修改',
        review: { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() },
      };
      await savePublicSubmissions(submissions);
      await recordAudit(req, session, `outreach.public-submission.${decision}`, submissionId, 'success', { noteLength: note.length });
      return json(res, 200, { ok: true, submission: { id: submissionId, status: submissions[index].status, review: submissions[index].review }, message: decision === 'approve' ? '投稿审核通过' : '投稿已退回修改' });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/interests') {
      const interests = await readWarmthInterests();
      return json(res, 200, {
        ok: true,
        stats: {
          total: interests.length,
          pending: interests.filter((item) => item.status === '待人工确认').length,
          accepted: interests.filter((item) => item.status === '已确认').length,
          withdrawn: interests.filter((item) => item.status === '已退出').length,
        },
        interests: interests.slice(-60).reverse().map((item) => ({
          id: item.id,
          program: item.program,
          frequency: item.frequency,
          nickname: item.nickname,
          contactEmail: maskedEmail(item.email),
          campus: item.campus,
          birthdayMonthDay: item.birthdayMonthDay,
          note: item.note,
          status: item.status,
          submittedAt: item.submittedAt,
          handledBy: item.handledBy || null,
          handledAt: item.handledAt || null,
        })),
      });
    }
    const interestDecision = url.pathname.match(/^\/api\/community\/interests\/([^/]+)\/(confirm|withdraw)$/);
    if (interestDecision && req.method === 'POST') {
      const interestId = decodeURIComponent(interestDecision[1]);
      const action = interestDecision[2];
      const interests = await readWarmthInterests();
      const index = interests.findIndex((item) => item.id === interestId);
      if (index < 0) return json(res, 404, { ok: false, message: '参加登记不存在' });
      interests[index] = {
        ...interests[index],
        status: action === 'confirm' ? '已确认' : '已退出',
        handledBy: session.username,
        handledAt: new Date().toISOString(),
      };
      await saveWarmthInterests(interests);
      await recordAudit(req, session, `community.interest.${action}`, interestId, 'success', { program: interests[index].program });
      return json(res, 200, { ok: true, interest: { id: interestId, status: interests[index].status }, message: action === 'confirm' ? '已确认参加，仍需人工确认后才会发送内容。' : '已登记退出，不再进入任何匹配或发送队列。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/notifications/overview') {
      return json(res, 200, await getNotificationsOverview(client));
    }
    if (req.method === 'GET' && url.pathname === '/api/community/overview') {
      const consents = await readCommunityConsents();
      const current = Object.values(consents).filter((item) => item.actor === session.username && item.enabled);
      return json(res, 200, { ok: true, mode: 'admin-pilot', writesToSeaTable: false, stats: { active: Object.values(consents).filter((item) => item.enabled).length, currentUserActive: current.length }, programs: ['birthday', 'morning'], current: current.map(({ program, frequency, contentMode, updatedAt }) => ({ program, frequency, contentMode, updatedAt })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/matching-preview') {
      const consents = await readCommunityConsents();
      const eligible = Object.values(consents).filter((item) => item.enabled);
      const byProgram = ['birthday', 'morning'].map((program) => ({ program, eligible: eligible.filter((item) => item.program === program).length, weekly: eligible.filter((item) => item.program === program && item.frequency === 'weekly').length }));
      return json(res, 200, { ok: true, mode: 'preview-only', generatedAt: new Date().toISOString(), candidateCount: eligible.length, byProgram, pairs: [], requiresManualApproval: true, message: '当前仅生成候选统计，不创建匹配关系、不发送消息。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/submissions') {
      const submissions = await readCommunitySubmissions();
      return json(res, 200, { ok: true, stats: { total: submissions.length, pending: submissions.filter((item) => item.status === '待审核').length, approved: submissions.filter((item) => item.status === '已通过').length }, submissions: submissions.slice(-30).reverse().map(({ id, program, content, tone, status, submittedAt, actor, review }) => ({ id, program, content, tone, status, submittedAt, actor: maskedApplicant(actor), review: review || null })) });
    }
    if (req.method === 'POST' && url.pathname === '/api/community/submissions') {
      const body = await readJson(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该投稿项目' });
      const consents = await readCommunityConsents();
      if (!consents[`${session.username}:${program}`]?.enabled) return json(res, 403, { ok: false, message: '请先加入该项目并确认同意规则' });
      const content = requiredText(body.content, '投稿内容', 1000);
      const tone = String(body.tone || '温暖').trim();
      const submissions = await readCommunitySubmissions();
      const submission = { id: eventIdentifier('CARE'), program, content, tone, actor: session.username, status: '待审核', submittedAt: new Date().toISOString(), consentVersion: 'v1' };
      submissions.push(submission);
      await saveCommunitySubmissions(submissions);
      await recordAudit(req, session, 'community.submission.create', submission.id, 'success', { program, contentLength: content.length });
      return json(res, 201, { ok: true, submission: { id: submission.id, program, status: submission.status, submittedAt: submission.submittedAt }, message: '投稿已进入人工审核队列' });
    }
    const communitySubmissionReview = url.pathname.match(/^\/api\/community\/submissions\/([^/]+)\/review$/);
    if (communitySubmissionReview && req.method === 'POST') {
      const submissionId = decodeURIComponent(communitySubmissionReview[1]);
      const body = await readJson(req);
      const decision = String(body.decision || '').trim();
      if (!['approve', 'return'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve 或 return' });
      const note = String(body.note || '').trim();
      if (decision === 'return' && !note) return json(res, 400, { ok: false, message: '退回投稿必须填写审核意见' });
      const submissions = await readCommunitySubmissions();
      const index = submissions.findIndex((item) => item.id === submissionId);
      if (index < 0) return json(res, 404, { ok: false, message: '投稿不存在' });
      submissions[index] = { ...submissions[index], status: decision === 'approve' ? '已通过' : '需修改', review: { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() } };
      await saveCommunitySubmissions(submissions);
      await recordAudit(req, session, `community.submission.${decision}`, submissionId, 'success', { noteLength: note.length });
      return json(res, 200, { ok: true, submission: { id: submissionId, status: submissions[index].status, review: submissions[index].review }, message: decision === 'approve' ? '投稿审核通过' : '投稿已退回修改' });
    }
    if (req.method === 'POST' && url.pathname === '/api/community/consent') {
      const body = await readJson(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目' });
      const frequency = String(body.frequency || '').trim();
      if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率' });
      if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出和人工审核规则' });
      const contentMode = String(body.contentMode || 'reviewed').trim();
      const consents = await readCommunityConsents();
      const key = `${session.username}:${program}`;
      consents[key] = { actor: session.username, program, frequency, contentMode, enabled: true, consentVersion: 'v1', updatedAt: new Date().toISOString() };
      await saveCommunityConsents(consents);
      await recordAudit(req, session, 'community.consent.enable', key, 'success', { program, frequency });
      return json(res, 200, { ok: true, consent: { program, frequency, contentMode, enabled: true }, message: '已记录自愿参加意愿；真实发送仍需人工审核' });
    }
    const communityWithdraw = url.pathname.match(/^\/api\/community\/consent\/([^/]+)\/withdraw$/);
    if (communityWithdraw && req.method === 'POST') {
      const program = decodeURIComponent(communityWithdraw[1]);
      const consents = await readCommunityConsents();
      const key = `${session.username}:${program}`;
      if (consents[key]) consents[key] = { ...consents[key], enabled: false, withdrawnAt: new Date().toISOString() };
      await saveCommunityConsents(consents);
      await recordAudit(req, session, 'community.consent.withdraw', key, 'success', { program });
      return json(res, 200, { ok: true, message: '已退出该项目，后续不会进入匹配和发送队列' });
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const metadata = await client.getMetadata();
      const tables = (metadata?.tables || []).map(({ _id, name, columns = [], views = [] }) => ({
        _id, name,
        columns: columns.map(({ key, name: columnName, type }) => ({ key, name: columnName, type })),
        views: views.map(({ _id: viewId, name: viewName }) => ({ _id: viewId, name: viewName })),
      }));
      return json(res, 200, { ok: true, server: serverUrl, configuredTable: configuredTable || null, tables, volunteerSourceConfigured: Boolean(volunteerBase) });
    }
    if (req.method === 'GET' && url.pathname === '/api/rows') {
      const table = tableFrom(url);
      const rows = await client.listRows(table, '', '', false, '', 100);
      return json(res, 200, { ok: true, table, rows });
    }
    if (url.pathname === '/api/rows' && req.method === 'POST') {
      const body = await readJson(req);
      const table = tableFrom(url, body);
      if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
        const error = new Error('row must be a JSON object keyed by SeaTable column names'); error.statusCode = 400; throw error;
      }
      return json(res, 201, { ok: true, table, result: await client.appendRow(table, body.row) });
    }
    const rowMatch = url.pathname.match(/^\/api\/rows\/([^/]+)$/);
    if (rowMatch && req.method === 'PUT') {
      const body = await readJson(req); const table = tableFrom(url, body);
      return json(res, 200, { ok: true, table, result: await client.updateRow(table, decodeURIComponent(rowMatch[1]), body.row || {}) });
    }
    if (rowMatch && req.method === 'DELETE') {
      const table = tableFrom(url);
      return json(res, 200, { ok: true, table, result: await client.deleteRow(table, decodeURIComponent(rowMatch[1])) });
    }
    return json(res, 404, { ok: false, message: 'Not found' });
  } catch (error) {
    const info = errorMessage(error);
    return json(res, error.statusCode || info.status || 500, { ok: false, message: info.message, seaTableStatus: info.status || null });
  }
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

async function sendAppShell(res) {
  try {
    const contents = await readFile(join(publicDir, 'index.html'));
    res.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-store' });
    res.end(contents);
  } catch {
    json(res, 500, { ok: false, message: 'Application shell is missing' });
  }
}

async function staticFile(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = normalize(join(publicDir, requested));
  if (!file.startsWith(publicDir)) return json(res, 403, { ok: false, message: 'Forbidden' });
  const extension = extname(file);

  let info;
  try {
    info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    // Client-side routes such as /events/EVT-1 or /console/materials have no
    // file on disk: return the application shell so the router can take over.
    if (!extension) return sendAppShell(res);
    return json(res, 404, { ok: false, message: 'File not found' });
  }

  // Assets are unversioned, so they must revalidate rather than be held for a
  // fixed lifetime; otherwise a deploy leaves users on stale CSS and JS.
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...securityHeaders(), ETag: etag, 'Cache-Control': 'no-cache' });
    return res.end();
  }

  try {
    const contents = await readFile(file);
    res.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': requested.endsWith('.html') ? 'no-store' : 'no-cache',
      ETag: etag,
      'Last-Modified': info.mtime.toUTCString(),
    });
    res.end(contents);
  } catch {
    json(res, 404, { ok: false, message: 'File not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  return staticFile(req, res, url);
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Open http://localhost:${port} or set another PORT in .env.`);
  else console.error(error);
  process.exitCode = 1;
});
server.listen(port, () => {
  console.log(`NJU Red Cross platform running at http://localhost:${port}`);
  console.log(`SeaTable server: ${serverUrl}`);
  console.log(`Platform authentication: local administrator session (${sessionTtlHours}h)`);
  if (smtpHost && smtpUser && smtpPassword) {
    const reminderTimer = setInterval(() => sendOverdueReminders().catch((error) => console.error('Overdue reminder failed:', error.message)), reminderIntervalMinutes * 60 * 1000);
    reminderTimer.unref();
    sendOverdueReminders().catch((error) => console.error('Overdue reminder failed:', error.message));
  } else {
    console.log('Overdue email reminder: SMTP not configured; reminders are disabled.');
  }
});
