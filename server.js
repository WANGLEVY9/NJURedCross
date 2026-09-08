import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME?.trim();
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
const accountsFile = join(root, process.env.PLATFORM_ADMIN_ACCOUNTS_FILE || '.admin-accounts.json');
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
let authPromise;

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
function toFiniteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
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
    const operation = String(flow['操作类型'] || '');
    const delta = ['入库', '归还', '盘点增加'].includes(operation) ? quantity : ['出库', '报损', '盘点减少'].includes(operation) ? -quantity : 0;
    if (code) flowDelta.set(code, (flowDelta.get(code) || 0) + delta);
    if (code) {
      const stats = flowStats.get(code) || { inbound: 0, outbound: 0, returned: 0, loss: 0, adjustment: 0, destinations: [] };
      if (operation === '入库') stats.inbound += quantity;
      if (operation === '出库') stats.outbound += quantity;
      if (operation === '归还') stats.returned += quantity;
      if (operation === '报损') stats.loss += quantity;
      if (operation === '盘点增加') stats.adjustment += quantity;
      if (operation === '盘点减少') stats.adjustment -= quantity;
      const application = applicationMap.get(String(flow['申请单ID'] || ''));
      if (application) {
        const destination = { applicationId: application._id, applicant: maskedApplicant(application['姓名']), purpose: String(application['借用用途'] || '未填写'), quantity, date: flow['操作时间'] || null };
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
  const recentFlows = flowRaw.slice().reverse().slice(0, 8).map((flow) => ({
    id: flow._id,
    operation: String(flow['操作类型'] || '未标注'),
    material: String(flow['物资名称'] || '未标注'),
    assetCode: String(flow['资产编码'] || ''),
    quantity: toFiniteNumber(flow['数量']),
    before: toFiniteNumber(flow['操作前数量']),
    after: toFiniteNumber(flow['操作后数量']),
    operator: String(flow['操作人'] || '未标注'),
    date: flow['操作时间'] || null,
    note: String(flow['异常说明'] || ''),
    destination: (() => { const application = applicationMap.get(String(flow['申请单ID'] || '')); return application ? `${maskedApplicant(application['姓名'])} · ${String(application['借用用途'] || '未填写')}` : ''; })(),
  }));
  return {
    ok: true, policy: { thresholdRule: '配置表阈值；未配置时回退 max(3, 初始数量 × 20%)', source: '物资配置表 + 物资流水表' },
    stats: { categoryCount: inventory.length, totalInventoryItems: inventory.length, totalInitialQuantity, totalCurrentQuantity, totalDifference, totalUntrackedDifference, lowStockCount: lowStock.length, pendingCount: pending.length, borrowedCount: applications.filter((item) => !item.returned && item.status.includes('借出')).length, overdueCount: overdue.length, abnormalReturnCount: abnormalReturns.length, flowCount: flowRaw.length },
    inventory, applications: applications.sort((a, b) => b.overdueDays - a.overdueDays), pending, overdue, abnormalReturns, lowStock, recentFlows,
  };
}

function today() { return new Date().toISOString().slice(0, 10); }
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
  const after = item.quantity + operationDelta(operation, quantity);
  if (after < 0) { const error = new Error(`Insufficient stock: available ${item.quantity} ${item.unit}`); error.statusCode = 409; throw error; }
  const idempotencyKey = String(body.idempotencyKey || '').trim() || randomBytes(16).toString('hex');
  return {
    row: { '流水编号': `TX-${randomBytes(7).toString('hex').toUpperCase()}`, '申请单ID': String(body.applicationId || ''), '资产编码': item.code, '物资名称': item.name, '操作类型': operation, '数量': quantity, '操作前数量': item.quantity, '操作后数量': after, '操作人': session.username, '操作时间': today(), '异常说明': String(body.note || '').trim(), '幂等键': idempotencyKey },
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

async function api(req, res, url) {
  try {
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
      const result = await client.appendRow(materialsTable, materialRequestPayload(body));
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
      return json(res, 200, { ok: true, result, message: approved ? 'Application approved' : 'Application rejected' });
    }
    const transactionAction = url.pathname.match(/^\/api\/materials\/applications\/([^/]+)\/(checkout|return)$/);
    if (transactionAction && req.method === 'POST') {
      const applicationId = decodeURIComponent(transactionAction[1]);
      const rows = await client.listRows(materialsTable, '', '', false, '', 1000);
      const application = rows.find((row) => row._id === applicationId);
      if (!application) return json(res, 404, { ok: false, message: 'Application not found' });
      const { body, photo } = await readMaterialAction(req);
      const bundle = await materialBundle(client);
      const assetCode = String(body.assetCode || '').trim();
      const item = bundle.summaryByCode.get(assetCode);
      if (!item) return json(res, 404, { ok: false, message: 'Inventory asset code not found' });
      const operation = transactionAction[2] === 'checkout' ? '出库' : '归还';
      if (operation === '出库' && String(application['借出审批'] || '') !== '审批通过') return json(res, 409, { ok: false, message: 'Application must be approved before checkout' });
      if (operation === '出库' && String(application['状态'] || '').includes('借出')) return json(res, 409, { ok: false, message: 'Application has already been checked out' });
      if (operation === '归还' && !String(application['状态'] || '').includes('借出')) return json(res, 409, { ok: false, message: 'Only checked-out applications can be returned' });
      if (operation === '出库' && !photo) return json(res, 400, { ok: false, message: 'Checkout photo is required' });
      const existingKey = String(body.idempotencyKey || '').trim();
      if (existingKey && bundle.flows.some((flow) => flow['幂等键'] === existingKey)) return json(res, 200, { ok: true, duplicate: true, message: 'Operation already recorded' });
      const transaction = transactionPayload({ ...body, operation, applicationId }, session, item);
      const photoPath = await uploadSeaTableImage(photo);
      const result = await client.appendRow('物资流水表', transaction.row);
      const applicationPatch = operation === '出库' ? { '状态': '借出（物资）', '实际借用日期': today() } : (() => {
        const borrowed = Math.max(1, Math.round(toFiniteNumber(application['借用件数'])));
        const returned = toFiniteNumber(application['归还件数']) + Math.round(toFiniteNumber(body.quantity));
        const full = returned >= borrowed;
        const hasDamage = Boolean(String(body.note || '').trim());
        return { '归还件数': returned, '归还状态': full && !hasDamage ? '已全部归还' : '物品缺失/数量减少', ...(full ? { '实际归还日期': today(), '状态': '已归还' } : {}) };
      })();
      if (operation === '出库') applicationPatch['物资出库照片'] = [photoPath];
      if (operation === '归还' && photoPath) applicationPatch['物资归还照片'] = [photoPath];
      try {
        await client.updateRow(materialsTable, applicationId, applicationPatch);
      } catch (error) {
        if (result?._id) await client.updateRow('物资流水表', result._id, { '异常说明': `申请状态同步失败：${error.message}` }).catch(() => {});
        const syncError = new Error('流水已记录，但申请状态同步失败，请人工核对后再继续操作');
        syncError.statusCode = 502;
        throw syncError;
      }
      return json(res, 201, { ok: true, result, message: operation === '出库' ? 'Checkout recorded' : 'Return recorded' });
    }
    if (req.method === 'POST' && url.pathname === '/api/materials/transactions') {
      const body = await readJson(req);
      const bundle = await materialBundle(client);
      const item = bundle.summaryByCode.get(String(body.assetCode || '').trim());
      if (!item) return json(res, 404, { ok: false, message: 'Inventory asset code not found' });
      const idempotencyKey = String(body.idempotencyKey || '').trim();
      if (idempotencyKey && bundle.flows.some((flow) => flow['幂等键'] === idempotencyKey)) return json(res, 200, { ok: true, duplicate: true, message: 'Operation already recorded' });
      const transaction = transactionPayload(body, session, item);
      const result = await client.appendRow('物资流水表', transaction.row);
      return json(res, 201, { ok: true, result, message: 'Inventory transaction recorded' });
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const metadata = await client.getMetadata();
      const tables = (metadata?.tables || []).map(({ _id, name, columns = [], views = [] }) => ({
        _id, name,
        columns: columns.map(({ key, name: columnName, type }) => ({ key, name: columnName, type })),
        views: views.map(({ _id: viewId, name: viewName }) => ({ _id: viewId, name: viewName })),
      }));
      return json(res, 200, { ok: true, server: serverUrl, configuredTable: configuredTable || null, tables });
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

const mimeTypes = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
async function staticFile(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(publicDir, requested));
  if (!file.startsWith(publicDir)) return json(res, 403, { ok: false, message: 'Forbidden' });
  try {
    const contents = await readFile(file);
    res.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': requested.endsWith('.html') ? 'no-store' : 'public, max-age=3600' });
    res.end(contents);
  } catch { json(res, 404, { ok: false, message: 'File not found' }); }
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
