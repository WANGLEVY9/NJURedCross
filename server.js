import { workflowMode } from './lib/events/workflow-mode.js';
import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Base } from 'seatable-api';
import { json, securityHeaders } from './lib/http/response.js';
import { withDisplayReads, clearDisplayReads, displayRead } from './lib/http/display-reads.js';
import { createReadCache } from './lib/http/read-cache.js';
import { createStaticHandler } from './lib/http/static.js';
import { createSeaTableAccess } from './lib/seatable-auth.js';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { ACCOUNT_TABLE, loadAccountsFromTable, findAccountByLogin, resolveSignInAccount, hashPassword, verifyPassword, generateMemberCode, canAuthenticate, credentialVersion } from './lib/identity/store.js';
import { identityRoutes } from './lib/identity/api.js';
import { configureMailer, mailerStatus, sendMail } from './lib/mailer.js';
import { eventsOpsRoutes } from './lib/events/api.js';
import * as njubox from './lib/events/njubox.js';
import { summarizeVolunteerWorkflow, registrationReadiness, previewHoursEntry } from './lib/events/volunteer-workflow.js';
import { projectWorkflowEvents } from './lib/events/public-workflow.js';
import { createWorkflow } from './lib/events/workflow.js';
import { createWishlist } from './lib/events/wishlist.js';
import { workflowRoutes } from './lib/events/workflow-api.js';
import { previewHoursExport } from './lib/events/hours-export.js';
import { apiFailure } from './lib/http/errors.js';
import { createMutationQueue, assertCompleteRows } from './lib/events/safety.js';
import { CONSOLE_PERMISSION_SCOPES, normalizePermissions, hasPermission, isAccountActive, scopeForConsolePath } from './lib/permissions.js';

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
/**
 * Account file. `PLATFORM_ADMIN_ACCOUNTS_FILE` is the pre-rename name and is
 * still honoured so an existing deployment keeps booting after the upgrade.
 */
const accountsFile = join(root, process.env.PLATFORM_ACCOUNTS_FILE || process.env.PLATFORM_ADMIN_ACCOUNTS_FILE || '.platform-accounts.json');
const isProduction = process.env.NODE_ENV === 'production';
/**
 * Two surfaces, three roles:
 *   · the operations console is the internal workspace and is restricted to
 *     platform administrators;
 *   · the public service portal is the student surface, open to any member.
 * A platform administrator may use the portal as well; a member may not reach
 * the console.
 */
const roleDefinitions = {
  super_admin: { label: '超级管理员', surfaces: ['console', 'portal'] },
  platform_admin: { label: '管理平台管理员', surfaces: ['console', 'portal'] },
  member: { label: '活动平台成员', surfaces: ['portal'] },
};
const consoleRoles = new Set(['platform_admin', 'super_admin']);
/** Password complexity applies to new registrations and resets; keep legacy login compatible. */
const minimumPasswordLength = 8;
const publicEmailDomains = String(process.env.PUBLIC_EMAIL_DOMAINS || 'nju.edu.cn,smail.nju.edu.cn')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const publicWriteLimit = Math.max(1, Number(process.env.PUBLIC_WRITE_LIMIT_PER_HOUR || 12));
const publicRequests = new Map();
const sessionSecret = process.env.PLATFORM_SESSION_SECRET;
const sessionTtlHours = Math.min(Math.max(Number(process.env.PLATFORM_SESSION_TTL_HOURS || 8), 1), 24 * 7);
const sessionTtlSeconds = Math.round(sessionTtlHours * 60 * 60);
const secureCookie = isProduction || String(process.env.PLATFORM_COOKIE_SECURE || 'false') === 'true';
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPassword = process.env.SMTP_PASSWORD;
const reminderFrom = process.env.MATERIALS_REMINDER_FROM?.trim() || smtpUser;
const reminderIntervalMinutes = Math.max(5, Number(process.env.MATERIALS_REMINDER_INTERVAL_MINUTES || 15));
const loginAttempts = new Map();
const revokedSessions = new Map();

if (!apiToken || apiToken === 'replace-with-your-api-token') {
  console.error('Missing SEATABLE_API_TOKEN. Copy .env.example to .env and configure it.');
  process.exit(1);
}
if (!sessionSecret || sessionSecret.startsWith('replace-with-') || sessionSecret.length < 32) {
  console.error('Missing secure platform login configuration. Set a 32+ character PLATFORM_SESSION_SECRET in .env.');
  process.exit(1);
}

const base = new Base({ server: serverUrl, APIToken: apiToken });
const volunteerBase = volunteerApiToken ? new Base({ server: serverUrl, APIToken: volunteerApiToken }) : null;
const mainAccess = createSeaTableAccess(base);
const volunteerAccess = volunteerBase ? createSeaTableAccess(volunteerBase) : null;

async function getBase() {
  const client=await mainAccess();
  if(isProduction&&client.dtableUuid!==process.env.SEATABLE_BUSINESS_BASE_UUID)throw new Error('Business Base configuration mismatch');
  return client;
}

// Private identity Base is never exposed through business table/metadata routes.
const identityApiToken = process.env.SEATABLE_IDENTITY_API_TOKEN?.trim();
const identityBaseUuid = process.env.SEATABLE_IDENTITY_BASE_UUID?.trim();
if (isProduction && (!identityApiToken || !identityBaseUuid)) throw new Error('Production requires a separate configured identity Base');
const identityBase = identityApiToken ? new Base({server:serverUrl,APIToken:identityApiToken}) : null;
const identityAccess = identityBase ? createSeaTableAccess(identityBase) : null;
// Dedicated write connection to the explicitly configured profile Base only.
const profileBaseUuid=process.env.SEATABLE_PROFILE_BASE_UUID?.trim();
const profileBase=process.env.SEATABLE_PROFILE_API_TOKEN?new Base({server:serverUrl,APIToken:process.env.SEATABLE_PROFILE_API_TOKEN}):null;
const profileAccess=profileBase?createSeaTableAccess(profileBase):null;
async function getProfileBase(){
  const client=await profileAccess();
  if(!profileBaseUuid || client.dtableUuid!==profileBaseUuid)throw new Error('Profile Base configuration mismatch');
  return client;
}
async function getIdentityBase() {
  if (!identityAccess) return getBase(); // Local legacy/bootstrap compatibility only.
  const client = await identityAccess();
  if (!identityBaseUuid || client.dtableUuid !== identityBaseUuid) throw new Error('Identity Base configuration mismatch');
  return client;
}

async function loadAccountsFromFile() {
  if (process.env.PLATFORM_ACCOUNTS_FILE || process.env.PLATFORM_ADMIN_ACCOUNTS_FILE) {
    try {
      const configured = JSON.parse(await readFile(accountsFile, 'utf8'));
      if (!Array.isArray(configured) || configured.length === 0) throw new Error('must be a non-empty JSON array');
      return configured;
    } catch (error) {
      console.error(`Unable to load platform accounts from ${accountsFile}: ${error.message}`);
      process.exit(1);
    }
  }
  if (!adminUsername || !adminPassword || adminPassword.startsWith('replace-with-')) {
    console.error('Missing platform account configuration. Set PLATFORM_ACCOUNTS_FILE, or PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD in .env.');
    process.exit(1);
  }
  return [{ username: adminUsername, password: adminPassword, role: 'platform_admin', label: '本地管理员' }];
}

/**
 * Accounts live in SeaTable once the identity schema has been applied. The JSON
 * file stays as the bootstrap path so an existing checkout keeps starting
 * before `npm run accounts:apply` has ever been run. The active source is
 * printed at boot so it is never ambiguous which store is being served.
 */
async function loadAccounts() {
  try {
    const client = await getIdentityBase();
    const stored = await loadAccountsFromTable(client);
    if (stored?.size) return { source: `seatable:${identityApiToken ? 'identity:' : ''}${ACCOUNT_TABLE}`, accounts: [...stored.values()] };
    if (identityApiToken) throw new Error('Private identity account table is empty');
    console.warn(`Platform account table "${ACCOUNT_TABLE}" is missing or empty; falling back to ${accountsFile}. Run \`npm run accounts:apply\` to migrate.`);
  } catch (error) {
    if (identityApiToken) throw new Error('Private identity store unavailable; refusing credential fallback');
    console.warn(`Unable to read the platform account table (${error.message}); falling back to ${accountsFile}.`);
  }
  return { source: accountsFile, accounts: await loadAccountsFromFile() };
}

const accountLoad = await loadAccounts();
const accountsByUsername = new Map();
for (const account of accountLoad.accounts) {
  const username = typeof account?.username === 'string' ? account.username.trim() : '';
  const role = roleDefinitions[account?.role];
  const password = typeof account.password === 'string' ? account.password : '';
  const passwordHash = typeof account.passwordHash === 'string' ? account.passwordHash : '';
  if (
    !username
    || (!password && !passwordHash)
    || (!passwordHash && password.length < minimumPasswordLength)
    || !role
    || accountsByUsername.has(username)
  ) {
    console.error(
      `Platform account configuration is invalid. Each account needs a unique username, a password hash (or a password of at least ${minimumPasswordLength} characters, ${isProduction ? 'production' : 'development'} policy), and one of these roles: ${Object.keys(roleDefinitions).join(', ')}.`,
    );
    process.exit(1);
  }
  accountsByUsername.set(username, {
    ...account,
    username,
    password,
    passwordHash,
    label: String(account.label || role.label).trim(),
    role: account.role,
    permissions: normalizePermissions(account.permissions, account.role),
  });
}
if (!isProduction) {
  const weak = [...accountsByUsername.values()].filter((account) => !account.passwordHash && account.password.length < 16);
  if (weak.length) {
    console.warn(
      `Development password policy active: ${weak.length} of ${accountsByUsername.size} accounts use passwords shorter than 16 characters. Set NODE_ENV=production to enforce the production policy.`,
    );
  }
}
console.log(`Platform accounts: ${accountsByUsername.size} loaded from ${accountLoad.source}`);

let workflowInstance, wishlistPending;
async function getWishlist(){if(!wishlistPending)wishlistPending=Promise.all([getVolunteerBase(),getWorkflow()]).then(([base,workflow])=>createWishlist(base,workflow,{sendMail,origin:process.env.PUBLIC_BASE_URL||'https://njuredcross.cn'})).catch(error=>{wishlistPending=null;throw error;});return wishlistPending;}

async function getWorkflow() {
  const config=workflowMode(process.env);
  const base=await getVolunteerBase();
  if(base.dtableUuid!==config.expected)throw Object.assign(new Error('活动数据源身份不符'),{statusCode:503});
  if(!workflowInstance)workflowInstance=createWorkflow(base,{mode:config.mode,bloodSourceTable:config.bloodSourceTable,assertWritable:()=>{if(workflowMode(process.env).expected!==base.dtableUuid)throw new Error('Workflow Base changed');}});
  return workflowInstance;
}

async function getVolunteerBase() {
  if (!volunteerAccess) throw Object.assign(new Error('Volunteer SeaTable source is not configured'), { statusCode: 503, code: 'volunteer_not_configured' });
  return volunteerAccess();
}

/* --------------------------------------------------------------------------
   State layer — SeaTable is the single source of truth.

   These six tables replaced a set of `logs/*.json` files. Keeping state in the
   server's filesystem meant whole-file read/modify/write cycles (a second
   process, a redeploy or a restored backup could silently overwrite data) and
   put the data outside version control, backup and the SeaTable UI entirely.

   Reads here deliberately THROW instead of degrading to an empty result: now
   that SeaTable is authoritative, an unreachable table must surface as an
   error state rather than as "no records". The single exception is the audit
   trail, where a failed write must never break the business operation it was
   recording.
   -------------------------------------------------------------------------- */
const outreachProjectTable = '宣传项目表';
const outreachSubmissionTable = '宣传投稿表';
const outreachTaskTable = '宣传发布任务表';
const communityEnrollmentTable = '温暖连接参加表';
const communitySubmissionTable = '温暖连接投稿表';
const auditTable = '操作审计表';

const publicSubmissionSource = '公众投稿';
const consoleEnrollmentSource = '控制台';
const portalEnrollmentSource = '公众端';
const submissionStatusPending = '待审核';
const submissionStatusApproved = '已通过';
const submissionStatusReturned = '需修改';
const submissionStatusRejected = '已拒绝';
const submissionStatusWaiting = '等待对方加入';
const enrollmentStatusPending = '待人工确认';
const enrollmentStatusConfirmed = '已确认';
const enrollmentStatusWithdrawn = '已退出';
const activeEnrollmentStatuses = new Set([enrollmentStatusPending, enrollmentStatusConfirmed]);
function isActiveEnrollmentStatus(status) {
  return activeEnrollmentStatuses.has(String(status || '').trim());
}
function isConfirmedEnrollmentStatus(status) {
  return String(status || '').trim() === enrollmentStatusConfirmed;
}

/** Birthday blessings collect month/day only, and the campus is a closed set. */
const WARMTH_CAMPUS_OPTIONS = ['鼓楼', '仙林', '苏州', '浦口'];
function accountByBusinessRef(ref) {
  const value = String(ref || '').trim();
  if (!value) return null;
  for (const account of accountsByUsername.values()) {
    if (account.accountId === value || account.username === value) return account;
  }
  return null;
}
function isValidBirthdayMonthDay(value) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Probe with a leap year so 02-29 stays valid.
  const probe = new Date(Date.UTC(2024, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
/** Birthday blessing submissions: one row per blessing a member writes. */
const WARMTH_DELIVERY_LABELS = Object.freeze({ specific: '指定学号', random: '随机匹配', repository: '祝福仓库' });
const WARMTH_DELIVERY_KEYS = Object.freeze({ 指定学号: 'specific', 随机匹配: 'random', 祝福仓库: 'repository' });
const WARMTH_DELIVERY_READY = '可投递';
const WARMTH_DELIVERY_WAITING = '等待对方加入';
const WARMTH_DELIVERY_BLOCKED = '不可投递（对方已退出）';
/** 审核通过的祝福会入库，并按投递方式分成三类，供后续站内展示与投递使用。 */
const blessingLibraryTable = '温暖祝福库表';
const LIBRARY_STATUS_ACTIVE = '在库';
const LIBRARY_CATEGORY_BY_DELIVERY = Object.freeze({ 祝福仓库: '祝福仓库', 指定学号: '指定个体', 随机匹配: '一对一随机' });
/** 生日当天自动投递：邮件 + 站内，一份祝福一条投递记录（幂等）。 */
const blessingDeliveryTable = '温暖祝福投递表';
const DELIVERY_SITE_DONE = '已投递';
const LIBRARY_STATUS_WITHDRAWN = '已撤下';
/** 收件人对已送达祝福的举报：管理端受理成立后会把该祝福从祝福库撤下。 */
const blessingReportTable = '温暖祝福举报表';
const REPORT_STATUS_PENDING = '待处理';
const REPORT_STATUS_HANDLED = '已处理';
const REPORT_STATUS_DISMISSED = '已驳回';
function registeredAccountByStudentId(studentId) {
  const value = String(studentId || '').trim();
  if (!value) return null;
  return [...accountsByUsername.values()].find((account) => String(account.studentId || '').trim() === value) || null;
}
/**
 * Resolves where a birthday blessing is delivered. Shared by the create and
 * resubmit routes so the "specific student" rules can never drift apart.
 * Returns `{ ok: false, message }` when the target is invalid.
 */
function resolveWarmthDelivery({ delivery, rawTargetStudentId, actorRef, enrollments }) {
  let deliveryState = WARMTH_DELIVERY_READY;
  let status = submissionStatusPending;
  let targetStudentId = '';
  if (delivery === 'specific') {
    targetStudentId = cleanText(rawTargetStudentId, '目标学号', 20);
    if (!/^\d{6,20}$/.test(targetStudentId)) return { ok: false, message: '请输入有效的学号。' };
    const target = registeredAccountByStudentId(targetStudentId);
    if (!target) return { ok: false, message: '该学号当前不可指定，请确认后重试。' };
    if (target.accountId === actorRef) return { ok: false, message: '不能把祝福指定给自己。' };
    const joined = enrollments.some((item) => item.program === 'birthday' && item.participantRef === target.accountId && isConfirmedEnrollmentStatus(item.status));
    if (!joined) { deliveryState = WARMTH_DELIVERY_WAITING; status = submissionStatusWaiting; }
  }
  return { ok: true, targetStudentId, deliveryState, status };
}
async function readWarmthBlessings(client) {
  const rows = await stateRows(client, communitySubmissionTable);
  return rows
    .filter((row) => String(row['项目'] || '') === 'birthday')
    .map((row) => {
      const status = String(row['状态'] || submissionStatusPending);
      const pending = status === submissionStatusPending || status === submissionStatusWaiting;
      const reviewNote = String(row['审核意见'] || '');
      const reviewedAt = row['审核时间'] || null;
      return {
        id: String(row['投稿ID'] || ''),
        program: 'birthday',
        content: String(row['内容'] || ''),
        actor: String(row['提交人'] || ''),
        nickname: String(row['署名昵称'] || ''),
        status,
        delivery: String(row['投递方式'] || ''),
        deliveryKey: WARMTH_DELIVERY_KEYS[String(row['投递方式'] || '')] || '',
        targetStudentId: String(row['目标学号'] || ''),
        deliveryState: String(row['投递条件'] || WARMTH_DELIVERY_READY),
        reviewNote: pending ? '' : reviewNote,
        reviewedAt: pending ? null : reviewedAt,
        previousReviewNote: pending ? reviewNote : '',
        previousReviewedAt: pending ? reviewedAt : null,
        submittedAt: row['提交时间'] || null,
      };
    })
    .sort(byDateDesc('submittedAt'));
}

async function readBlessingLibrary(client) {
  const rows = await stateRows(client, blessingLibraryTable);
  return rows
    .map((row) => ({
      id: String(row['入库ID'] || ''),
      submissionId: String(row['投稿ID'] || ''),
      program: String(row['项目'] || ''),
      category: String(row['分类'] || ''),
      content: String(row['内容'] || ''),
      nickname: String(row['署名昵称'] || ''),
      targetStudentId: String(row['目标学号'] || ''),
      submitter: String(row['来源投稿人'] || ''),
      status: String(row['状态'] || ''),
      reviewer: String(row['审核人'] || ''),
      storedAt: row['入库时间'] || null,
    }))
    .sort(byDateDesc('storedAt'));
}

/**
 * Ingests an approved submission into the blessing library, classified by its
 * delivery mode. Idempotent: a re-approved submission updates its existing row
 * instead of adding a second one (keyed by 投稿ID).
 */
async function ingestApprovedBlessing(client, submission, reviewer, storedAt) {
  if (String(submission['项目'] || '') !== 'birthday') return null;
  const submissionId = String(submission['投稿ID'] || '');
  const category = LIBRARY_CATEGORY_BY_DELIVERY[String(submission['投递方式'] || '')];
  if (!submissionId || !category) return null;
  const patch = {
    项目: 'birthday',
    分类: category,
    内容: String(submission['内容'] || ''),
    署名昵称: String(submission['署名昵称'] || ''),
    目标学号: category === '指定个体' ? String(submission['目标学号'] || '') : '',
    来源投稿人: String(submission['提交人'] || ''),
    状态: LIBRARY_STATUS_ACTIVE,
    审核人: reviewer,
    入库时间: storedAt,
  };
  const existing = (await stateRows(client, blessingLibraryTable)).find((row) => String(row['投稿ID'] || '') === submissionId);
  if (existing) {
    await client.updateRow(blessingLibraryTable, existing._id, patch);
    return String(existing['入库ID'] || '');
  }
  const libraryId = eventIdentifier('LIB');
  await client.appendRow(blessingLibraryTable, { 入库ID: libraryId, 投稿ID: submissionId, ...patch });
  return libraryId;
}

async function readWarmthReports(client) {
  const rows = await stateRows(client, blessingReportTable);
  return rows
    .map((row) => ({
      id: String(row['举报ID'] || ''),
      submissionId: String(row['投稿ID'] || ''),
      reporterRef: String(row['举报人标识'] || ''),
      reporterStudentId: String(row['举报人学号'] || ''),
      reason: String(row['原因'] || ''),
      status: String(row['状态'] || REPORT_STATUS_PENDING),
      handledBy: String(row['处理人'] || ''),
      resolutionNote: String(row['处理意见'] || ''),
      handledAt: row['处理时间'] || null,
      submittedAt: row['提交时间'] || null,
    }))
    .sort(byDateDesc('submittedAt'));
}

function pickRandom(list, count) {
  const pool = [...list];
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

async function readWarmthDeliveries(client) {
  const rows = await stateRows(client, blessingDeliveryTable);
  return rows
    .map((row) => ({
      id: String(row['投递ID'] || ''),
      submissionId: String(row['投稿ID'] || ''),
      recipientRef: String(row['收件人标识'] || ''),
      studentId: String(row['收件人学号'] || ''),
      triggerDay: String(row['触发日期'] || ''),
      source: String(row['来源'] || ''),
      mailStatus: String(row['邮件状态'] || ''),
      siteStatus: String(row['站内状态'] || ''),
      deliveredAt: row['投递时间'] || null,
      failureReason: String(row['失败原因'] || ''),
    }))
    .sort(byDateDesc('deliveredAt'));
}

/** 服务端所在时区无关的「Asia/Shanghai 的 MM-DD」。 */
function shanghaiMonthDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return `${month}-${day}`;
}

/**
 * 每天 08:00 的运行体：找出当天过生日、且已确认加入的成员，把指向他们的
 * 「指定个体」祝福（在库）同时通过邮件与站内投递。没有祝福时不做任何事。
 */
/**
 * 每天 08:00 的运行体。两条独立的线：
 *   线1（独立）：指向本人的「指定个体」祝福，有几个发几个；
 *   线2：按本人「已通过（已入库）」的祝福条数决定——
 *     · 写过 → 从「一对一随机」池随机匹配同等条数（排除自己写的、排除已被匹配走的）；
 *     · 没写过 → 从「祝福仓库」池随机抽取一条（仓库祝福可被多次调用）。
 * 两条线都通过邮件发送，并写入站内投递记录；没有可用祝福时不做任何事。
 */
async function runWarmthBirthdayDelivery(client, { now = new Date(), onlyDay = null } = {}) {
  const day = onlyDay || shanghaiMonthDay(now);
  const [enrollments, library, existingRows] = await Promise.all([
    readWarmthInterests(client),
    readBlessingLibrary(client),
    stateRows(client, blessingDeliveryTable),
  ]);
  const recipients = enrollments.filter((item) => item.program === 'birthday' && isConfirmedEnrollmentStatus(item.status) && item.birthdayMonthDay === day);
  const deliveredAt = now.toISOString();
  const summary = { day, recipients: recipients.length, specific: 0, matched: 0, repository: 0, delivered: 0, mailed: 0, records: [] };
  const deliveries = [...existingRows];

  async function deliver({ blessing, recipient, studentId, account, source }) {
    const existing = deliveries.find((row) => String(row['投稿ID'] || '') === blessing.submissionId
      && String(row['收件人学号'] || '') === studentId
      && String(row['触发日期'] || '') === day);
    if (existing && String(existing['站内状态'] || '') === DELIVERY_SITE_DONE) return false;
    const mail = await sendMail({
      to: String(account?.email || '').trim(),
      subject: '南京大学红十字会｜今天有人给你写了生日祝福',
      text: `今天是你的生日，这里有一段祝福：\n\n${blessing.content}\n\n—— ${blessing.nickname || '一位同学'}\n\n（平台在你生日当天自动送达；也可以登录网站查看。）`,
      kind: 'warmth-birthday',
      idempotencyKey: `WARMTH-BIRTHDAY:${blessing.submissionId}:${studentId}:${day}`,
    });
    const mailStatus = mail.ok ? '已发送' : (mail.skipped ? '未发送' : '发送失败');
    const patchRow = {
      投稿ID: blessing.submissionId,
      收件人标识: recipient.participantRef,
      收件人学号: studentId,
      触发日期: day,
      来源: source,
      邮件状态: mailStatus,
      站内状态: DELIVERY_SITE_DONE,
      投递时间: deliveredAt,
      失败原因: mail.ok ? '' : String(mail.reason || ''),
    };
    if (existing) {
      await client.updateRow(blessingDeliveryTable, existing._id, patchRow);
    } else {
      const row = { 投递ID: eventIdentifier('DLV'), ...patchRow };
      await client.appendRow(blessingDeliveryTable, row);
      deliveries.push(row);
    }
    summary.delivered += 1;
    if (mail.ok) summary.mailed += 1;
    summary.records.push({ submissionId: blessing.submissionId, studentId, source, mailStatus });
    return true;
  }

  for (const recipient of recipients) {
    const account = accountByBusinessRef(recipient.participantRef);
    const studentId = String(account?.studentId || recipient.studentId || '').trim();
    if (!studentId) continue;
    const active = library.filter((item) => item.status === LIBRARY_STATUS_ACTIVE);

    // 线1（独立）：指定给本人的祝福
    for (const blessing of active.filter((item) => item.category === '指定个体' && item.targetStudentId === studentId)) {
      if (await deliver({ blessing, recipient, studentId, account, source: '指定' })) summary.specific += 1;
    }

    // 线2：同一天同一人只做一次匹配/抽取（保证重复执行幂等）
    const matchedToday = deliveries.some((row) => String(row['收件人学号'] || '') === studentId
      && String(row['触发日期'] || '') === day
      && ['一对一匹配', '仓库抽取'].includes(String(row['来源'] || '')));
    if (matchedToday) continue;
    const written = active.filter((item) => item.submitter && item.submitter === account?.username);
    if (written.length) {
      const consumed = new Set(deliveries.map((row) => String(row['投稿ID'] || '')));
      const pool = active.filter((item) => item.category === '一对一随机' && item.submitter !== account?.username && !consumed.has(item.submissionId));
      for (const blessing of pickRandom(pool, written.length)) {
        if (await deliver({ blessing, recipient, studentId, account, source: '一对一匹配' })) summary.matched += 1;
      }
    } else {
      const pool = active.filter((item) => item.category === '祝福仓库');
      for (const blessing of pickRandom(pool, 1)) {
        if (await deliver({ blessing, recipient, studentId, account, source: '仓库抽取' })) summary.repository += 1;
      }
    }
  }
  return summary;
}

/** Canonical review status → the decision vocabulary the API speaks. */
function reviewDecisionFromStatus(value) {
  const status = String(value || '').trim();
  if (status === submissionStatusApproved) return 'approve';
  if (status === submissionStatusReturned) return 'return';
  if (status === submissionStatusRejected) return 'reject';
  return null;
}
function statusFromReviewDecision(decision) {
  if (decision === 'approve') return submissionStatusApproved;
  if (decision === 'reject') return submissionStatusRejected;
  return submissionStatusReturned;
}

/**
 * SeaTable listRows is paged. A hard-coded limit silently turns totals into
 * lower bounds, so operational aggregates must read until the table ends.
 * The non-enumerable readMeta property lets callers expose truncation without
 * changing the array contract used throughout the current API layer.
 */
async function listAllRows(client, tableName, options = {}) {
  return displayRead(client, JSON.stringify(['rows', tableName, options]), () => loadAllRows(client, tableName, options));
}
async function loadAllRows(client, tableName, { pageSize = 500, maxRows = 5000 } = {}) {
  const rows = [];
  let start = 0;
  let truncated = false;
  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const batch = await client.listRows(tableName, '', '', false, start, limit);
    if (!Array.isArray(batch)) throw httpError(502, '数据服务返回了无效分页');
    if (batch.length === 0) break;
    rows.push(...batch);
    start += batch.length;
    if (batch.length < limit) break;
    if (rows.length >= maxRows) {
      const overflow = await client.listRows(tableName, '', '', false, start, 1);
      if (!Array.isArray(overflow)) throw httpError(502, '数据服务返回了无效分页');
      truncated = overflow.length > 0;
    }
  }
  Object.defineProperty(rows, 'readMeta', {
    value: { total: rows.length, truncated, maxRows },
    enumerable: false,
  });
  return rows;
}
function readMeta(rows) {
  return rows?.readMeta || { total: Array.isArray(rows) ? rows.length : 0, truncated: false, maxRows: null };
}

function reviewFromRow(row) {
  const decision = reviewDecisionFromStatus(row['审核状态']);
  if (!decision) return null;
  return {
    decision,
    note: String(row['审核意见'] || ''),
    reviewer: String(row['审核人'] || ''),
    reviewedAt: row['审核时间'] || null,
  };
}
function stateRows(client, tableName, maxRows = 5000) {
  return listAllRows(client, tableName, { maxRows });
}
/** Newest first. Table order is insertion order, which is not display order. */
function byDateDesc(field) {
  return (left, right) => String(right[field] || '').localeCompare(String(left[field] || ''));
}

function auditIdentityRef(value) {
  const account = accountsByUsername.get(value);
  return account?.accountId || (/^ACC-/.test(value) ? value : 'REF-' + sign(String(value)).slice(0,24));
}

async function recordAudit(req, session, action, target, result = 'success', metadata = {}) {
  const keys = Object.keys(metadata || {});
  try {
    const client = await getBase();
    await client.appendRow(auditTable, {
      审计ID: eventIdentifier('AUD'),
      时间: new Date().toISOString(),
      操作人: action.startsWith('identity.') ? auditIdentityRef(session?.username || 'anonymous') : (session?.username || 'anonymous'),
      角色: session?.role || 'unknown',
      动作: action,
      对象: action.startsWith('identity.') ? auditIdentityRef(String(target || '')) : String(target || ''),
      结果: result,
      IP: action.startsWith('identity.') ? auditIdentityRef(clientIp(req)) : clientIp(req),
      备注: keys.length ? JSON.stringify(metadata) : '',
    });
  } catch (error) {
    // Audit is observational: never let it fail the operation it describes.
    console.error(`Audit write failed: ${error.message}`);
  }
}

async function readRecentAudit(limit = 50) {
  try {
    const client = await getBase();
    const rows = await stateRows(client, auditTable);
    return rows
      .map((row) => ({
        at: row['时间'] || null,
        actor: String(row['操作人'] || 'anonymous'),
        role: String(row['角色'] || 'unknown'),
        action: String(row['动作'] || ''),
        target: String(row['对象'] || ''),
        result: String(row['结果'] || ''),
        ip: String(row['IP'] || ''),
        metadata: (() => { try { return row['备注'] ? JSON.parse(row['备注']) : {}; } catch { return {}; } })(),
      }))
      .sort(byDateDesc('at'))
      .slice(0, Math.min(Math.max(limit, 1), 200));
  } catch { return []; }
}

/* --- 宣传投稿表: public submissions and legacy-content review conclusions --- */

async function readOutreachSubmissionRows(client) {
  return stateRows(client, outreachSubmissionTable);
}

async function readOutreachReviews(client) {
  const rows = await readOutreachSubmissionRows(client);
  const reviews = {};
  for (const row of rows) {
    if (String(row['来源'] || '') === publicSubmissionSource) continue;
    const review = reviewFromRow(row);
    if (!review) continue;
    const id = String(row['投稿ID'] || '');
    if (id) reviews[id] = review;
  }
  return reviews;
}

async function readPublicSubmissions(client) {
  const rows = await readOutreachSubmissionRows(client);
  return rows
    .filter((row) => String(row['来源'] || '') === publicSubmissionSource)
    .map((row) => ({
      id: String(row['投稿ID'] || ''),
      title: String(row['标题'] || ''),
      content: String(row['正文'] || ''),
      category: String(row['类别'] || ''),
      signature: String(row['对外署名'] || ''),
      contactName: String(row['联系人'] || ''),
      contactEmail: String(row['联系邮箱'] || ''),
      // Account username for submissions made after the portal gained login;
      // older rows carry only the mailbox, which the field falls back to.
      submitterRef: String(row['投稿人引用'] || ''),
      originalConfirm: String(row['原创确认'] || '') === '已确认',
      portraitConfirm: String(row['肖像授权'] || '') === '已确认',
      status: String(row['审核状态'] || submissionStatusPending),
      submittedAt: row['提交时间'] || null,
      review: reviewFromRow(row),
    }))
    .sort(byDateDesc('submittedAt'));
}

function publicSubmissionRow(submission) {
  return {
    投稿ID: submission.id,
    来源: publicSubmissionSource,
    项目ID: '',
    类别: submission.category,
    标题: submission.title,
    正文: submission.content,
    附件引用: '',
    // Account username when the portal was signed in; the contact mailbox is
    // kept as the fallback so rows written before the login requirement are
    // still attributable.
    投稿人引用: submission.submitterRef || submission.contactEmail,
    联系人: submission.contactName,
    联系邮箱: submission.contactEmail,
    对外署名: submission.signature,
    公开范围: '',
    原创确认: submission.originalConfirm ? '已确认' : '未确认',
    肖像授权: submission.portraitConfirm ? '已确认' : '未确认',
    同意版本: submission.consentVersion,
    审核状态: submissionStatusPending,
    审核意见: '',
    审核人: '',
    提交时间: submission.submittedAt,
    审核时间: '',
  };
}

/** Writes (or overwrites) the review conclusion on a submission row. */
async function writeSubmissionReview(client, submissionId, review, { status } = {}) {
  const row = { 审核状态: status || statusFromReviewDecision(review.decision), 审核意见: review.note || '', 审核人: review.reviewer, 审核时间: review.reviewedAt };
  const rows = await readOutreachSubmissionRows(client);
  const existing = rows.find((item) => String(item['投稿ID'] || '') === submissionId);
  if (!existing) return null;
  return client.updateRow(outreachSubmissionTable, existing._id, row);
}

/**
 * Reviews of legacy content (策划案 / 文创征集 / 课程反馈) live in the same
 * table, keyed by the same content id the API exposes, so one table answers
 * "what has been reviewed and what did we decide".
 */
async function saveOutreachReview(client, contentId, review, item) {
  const rows = await readOutreachSubmissionRows(client);
  const existing = rows.find((row) => String(row['投稿ID'] || '') === contentId);
  const patch = {
    审核状态: statusFromReviewDecision(review.decision),
    审核意见: review.note || '',
    审核人: review.reviewer,
    审核时间: review.reviewedAt,
  };
  if (existing) return client.updateRow(outreachSubmissionTable, existing._id, patch);
  return client.appendRow(outreachSubmissionTable, {
    投稿ID: contentId,
    来源: item?.type || '遗留内容',
    项目ID: '',
    类别: item?.type || '',
    标题: item?.title || contentId,
    正文: item?.summary || '',
    附件引用: '',
    投稿人引用: '',
    联系人: '',
    联系邮箱: '',
    对外署名: '',
    公开范围: '',
    原创确认: '',
    肖像授权: '',
    同意版本: 'v1',
    提交时间: item?.submittedAt || '',
    ...patch,
  });
}

/* --- 宣传发布任务表 --- */

async function readOutreachPublications(client) {
  const rows = await stateRows(client, outreachTaskTable);
  const publications = {};
  for (const row of rows) {
    const contentId = String(row['投稿ID'] || '');
    if (!contentId) continue;
    publications[contentId] = {
      taskId: String(row['任务ID'] || ''),
      contentId,
      channel: String(row['发布渠道'] || ''),
      plannedAt: row['计划发布时间'] || null,
      status: String(row['发布状态'] || ''),
      note: String(row['备注'] || ''),
      createdBy: String(row['创建人'] || ''),
      createdAt: row['创建时间'] || null,
      resultAt: row['完成时间'] || null,
      publishedLink: String(row['发布链接'] || ''),
      failureReason: String(row['失败原因'] || ''),
      retryCount: toFiniteNumber(row['重试次数']),
      resultBy: String(row['确认人'] || ''),
    };
  }
  return publications;
}

async function saveOutreachPublication(client, contentId, task) {
  const row = {
    任务ID: task.taskId,
    投稿ID: contentId,
    发布渠道: task.channel || '',
    计划发布时间: task.plannedAt || '',
    发布状态: task.status || '',
    发布链接: task.publishedLink || '',
    失败原因: task.failureReason || '',
    重试次数: String(toFiniteNumber(task.retryCount)),
    确认人: task.resultBy || '',
    完成时间: task.resultAt || '',
    备注: task.note || '',
    创建人: task.createdBy || '',
    创建时间: task.createdAt || '',
  };
  const rows = await stateRows(client, outreachTaskTable);
  const existing = rows.find((item) => String(item['投稿ID'] || '') === contentId);
  if (existing) return client.updateRow(outreachTaskTable, existing._id, row);
  return client.appendRow(outreachTaskTable, row);
}

/* --- 温暖连接参加表: public sign-ups and console consent share one shape --- */

async function readEnrollmentRows(client) {
  return stateRows(client, communityEnrollmentTable);
}

/** Console opt-ins, keyed the way the console reads them: `<actor>:<program>`. */
async function readCommunityConsents(client) {
  const rows = await readEnrollmentRows(client);
  const consents = {};
  for (const row of rows) {
    if (String(row['来源'] || '') !== consoleEnrollmentSource) continue;
    const key = String(row['登记ID'] || '');
    if (!key) continue;
    consents[key] = {
      actor: String(row['参与者标识'] || ''),
      program: String(row['项目'] || ''),
      frequency: String(row['频率'] || ''),
      contentMode: String(row['内容模式'] || ''),
      enabled: String(row['状态'] || '') === enrollmentStatusConfirmed,
      updatedAt: row['提交时间'] || null,
    };
  }
  return consents;
}

async function readWarmthInterests(client) {
  const rows = await readEnrollmentRows(client);
  return rows
    .filter((row) => String(row['来源'] || '') === portalEnrollmentSource)
    .map((row) => ({
      id: String(row['登记ID'] || ''),
      program: String(row['项目'] || ''),
      frequency: String(row['频率'] || ''),
      nickname: String(row['昵称'] || ''),
      participantRef: String(row['参与者标识'] || ''),
      studentId: String(accountByBusinessRef(row['参与者标识'])?.studentId || ''),
      email: String(row['邮箱'] || ''),
      campus: String(row['校区'] || ''),
      birthdayMonthDay: String(row['生日月日'] || ''),
      note: String(row['备注'] || ''),
      status: String(row['状态'] || ''),
      consentVersion: String(row['同意版本'] || ''),
      submittedAt: row['提交时间'] || null,
      handledBy: String(row['处理人'] || '') || null,
      handledAt: row['处理时间'] || null,
    }))
    .sort(byDateDesc('submittedAt'));
}

/** Confirmed participants from both the portal and the console, deduplicated. */
async function readConfirmedWarmthCandidates(client) {
  const portal = await readWarmthInterests(client);
  const consents = await readCommunityConsents(client);
  const seen = new Set();
  const candidates = [];
  for (const item of portal) {
    if (!isConfirmedEnrollmentStatus(item.status)) continue;
    const key = `${item.participantRef}|${item.program}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ participantRef: item.participantRef, program: item.program, frequency: item.frequency });
  }
  for (const item of Object.values(consents)) {
    if (!item.enabled) continue;
    const key = `${item.actor}|${item.program}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ participantRef: item.actor, program: item.program, frequency: item.frequency });
  }
  return candidates;
}

/** Upsert keyed by 登记ID — the natural key for both enrollment sources. */
async function saveEnrollment(client, registrationId, row) {
  const rows = await readEnrollmentRows(client);
  const existing = rows.find((item) => String(item['登记ID'] || '') === registrationId);
  if (existing) return client.updateRow(communityEnrollmentTable, existing._id, row);
  return client.appendRow(communityEnrollmentTable, { 登记ID: registrationId, ...row });
}

async function updateEnrollment(client, registrationId, patch) {
  const rows = await readEnrollmentRows(client);
  const existing = rows.find((item) => String(item['登记ID'] || '') === registrationId);
  if (!existing) return null;
  return client.updateRow(communityEnrollmentTable, existing._id, patch);
}

/* --- 温暖连接投稿表 --- */

async function readCommunitySubmissions(client) {
  const rows = await stateRows(client, communitySubmissionTable);
  return rows
    .map((row) => ({
      id: String(row['投稿ID'] || ''),
      program: String(row['项目'] || ''),
      content: String(row['内容'] || ''),
      tone: String(row['语气'] || ''),
      actor: String(row['提交人'] || ''),
      nickname: String(row['署名昵称'] || ''),
      delivery: String(row['投递方式'] || ''),
      targetStudentId: String(row['目标学号'] || ''),
      deliveryState: String(row['投递条件'] || ''),
      status: String(row['状态'] || submissionStatusPending),
      submittedAt: row['提交时间'] || null,
      review: reviewFromRow({ 审核状态: row['状态'], 审核意见: row['审核意见'], 审核人: row['审核人'], 审核时间: row['审核时间'] }),
    }))
    .sort(byDateDesc('submittedAt'));
}

async function updateCommunitySubmission(client, submissionId, patch) {
  const rows = await stateRows(client, communitySubmissionTable);
  const existing = rows.find((item) => String(item['投稿ID'] || '') === submissionId);
  if (!existing) return null;
  return client.updateRow(communitySubmissionTable, existing._id, patch);
}

async function cascadeWarmthTargetStatus(client, participantRef, joined) {
  const account = accountByBusinessRef(participantRef);
  const studentId = String(account?.studentId || '').trim();
  if (!studentId) return 0;
  const rows = await stateRows(client, communitySubmissionTable);
  let changed = 0;
  for (const row of rows) {
    if (String(row['目标学号'] || '') !== studentId) continue;
    const status = String(row['状态'] || '');
    const deliveryState = String(row['投递条件'] || '');
    if (joined) {
      if (status === submissionStatusWaiting) {
        await client.updateRow(communitySubmissionTable, row._id, { 状态: submissionStatusPending, 投递条件: WARMTH_DELIVERY_READY });
        changed += 1;
      } else if (deliveryState === WARMTH_DELIVERY_BLOCKED) {
        await client.updateRow(communitySubmissionTable, row._id, { 投递条件: WARMTH_DELIVERY_READY });
        changed += 1;
      }
    } else if (status === submissionStatusApproved) {
      if (deliveryState !== WARMTH_DELIVERY_BLOCKED) {
        await client.updateRow(communitySubmissionTable, row._id, { 投递条件: WARMTH_DELIVERY_BLOCKED });
        changed += 1;
      }
    } else if (status === submissionStatusPending || status === submissionStatusWaiting) {
      if (status !== submissionStatusWaiting || deliveryState !== WARMTH_DELIVERY_WAITING) {
        await client.updateRow(communitySubmissionTable, row._id, { 状态: submissionStatusWaiting, 投递条件: WARMTH_DELIVERY_WAITING });
        changed += 1;
      }
    }
  }
  return changed;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Public endpoints have no session to rate-limit against, so writes are capped
// per client address and per action bucket.
function enforcePublicLimit(req, bucket, limit = publicWriteLimit, identity = '') {
  const key = `${bucket}:${identity || clientIp(req)}`;
  const now = Date.now();
  for (const [existingKey, existing] of publicRequests) {
    if (existing.resetAt <= now) publicRequests.delete(existingKey);
  }
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
const keyedLocks = new Map();
async function withKeyedLock(key, task) {
  const prior = keyedLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chained = prior.then(() => gate);
  keyedLocks.set(key, chained);
  await prior;
  try {
    return await task();
  } finally {
    release();
    if (keyedLocks.get(key) === chained) keyedLocks.delete(key);
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
/**
 * Tables whose rows are owned by a business state machine or contain security
 * data. They remain readable in the data centre for diagnosis, but generic
 * CRUD must never bypass the domain routes that validate transitions and emit
 * audit records.
 */
const genericWriteProtectedTables = new Map([
  [materialsTable, '请使用物资申请、审批、出库和归还流程'],
  [inventoryTable, '库存基线只能通过物资专用流程维护'],
  ['物资配置表', '物资配置需要经过专用配置流程'],
  ['物资流水表', '流水只能由物资状态机生成'],
  [eventProjectTable, '请使用活动中心维护活动'],
  [eventSessionTable, '请使用活动中心维护场次'],
  [eventRegistrationTable, '报名、取消和签到必须经过活动状态机'],
  ['活动通知表', '通知必须经过活动通知流程'],
  ['活动附件表', '附件必须经过活动附件流程'],
  [outreachProjectTable, '请使用宣传中心维护项目'],
  [outreachSubmissionTable, '投稿审核必须经过宣传状态机'],
  [outreachTaskTable, '发布任务必须经过宣传状态机'],
  [communityEnrollmentTable, '参加、退出和确认必须经过温暖连接流程'],
  [communitySubmissionTable, '投稿审核必须经过温暖连接流程'],
  [auditTable, '审计记录为系统只写数据'],
  ['平台账号表', '账号必须经过身份与权限管理流程'],
  ['邮箱验证码表', '验证码为系统安全数据'],
  ['邮件发件记录表', '发件记录为系统留痕数据'],
  ['博爱青春策划案 线下答辩', '既有业务源表仅供平台读取'],
  ['博爱青春纪念品大赛', '既有业务源表仅供平台读取'],
  ['“红十字生命教育＋”第一轮试课', '既有业务源表仅供平台读取'],
]);

function genericDataAccess(table) {
  const reason = genericWriteProtectedTables.get(table) || '';
  return { read: true, write: !reason, mode: reason ? 'business-route-only' : 'controlled-repair', reason };
}

function assertGenericWriteAllowed(table) {
  const access = genericDataAccess(table);
  if (access.write) return access;
  const error = new Error(`数据中心禁止直接修改「${table}」：${access.reason}`);
  error.statusCode = 403;
  error.code = 'business_route_required';
  throw error;
}
const activitySchema = [
  { name: '活动项目表', purpose: '活动基本信息、报名窗口与运营负责人', columns: ['活动ID', '活动名称', '活动类型', '活动简介', '校区', '地点', '报名开始', '报名截止', '活动开始', '活动结束', '容量', '负责人', '状态', '公开范围'] },
  { name: '活动场次表', purpose: '同一活动的具体场次与签到配置', columns: ['场次ID', '活动ID', '开始时间', '结束时间', '地点', '容量', '签到开放', '签到方式', '状态'] },
  { name: '活动报名表', purpose: '参与者报名、候补、签到与授权记录', columns: ['报名ID', '活动ID', '场次ID', '参与者引用', '显示姓名', '南大邮箱', '校区', '报名答案', '同意版本', '报名状态', '候补序号', '签到码摘要', '提交时间', '取消时间', '签到时间'] },
];
const outreachSchema = [
  { name: '宣传项目表', purpose: '宣传主题、征集窗口、受众与发布渠道', columns: ['项目ID', '项目名称', '项目类型', '征集开始', '征集截止', '目标受众', '发布渠道', '状态', '负责人', '授权版本'] },
  { name: '宣传投稿表', purpose: '公众投稿正文与授权，以及对既有内容的审核结论（同一张表按来源区分）', columns: ['投稿ID', '来源', '项目ID', '类别', '标题', '正文', '附件引用', '投稿人引用', '联系人', '联系邮箱', '对外署名', '公开范围', '原创确认', '肖像授权', '同意版本', '审核状态', '审核意见', '审核人', '提交时间', '审核时间'] },
  { name: '宣传发布任务表', purpose: '渠道排期、发布确认、链接与失败重试记录', columns: ['任务ID', '投稿ID', '发布渠道', '计划发布时间', '发布状态', '发布链接', '失败原因', '重试次数', '确认人', '完成时间', '备注', '创建人', '创建时间'] },
];
/**
 * The state layer that replaced the former `logs/*.json` files. Composed from
 * the two domain definitions above so every table has exactly one definition:
 * the outreach preview shows the campaign tables, the state preview shows the
 * full storage layer (all six files that used to live on disk).
 */
const communityStateSchema = [
  { name: '温暖连接参加表', purpose: '公众端自愿登记与控制台侧同意记录，状态与处理留痕同一行', columns: ['登记ID', '来源', '项目', '频率', '昵称', '参与者标识', '邮箱', '校区', '生日月日', '备注', '内容模式', '状态', '同意版本', '提交时间', '处理人', '处理时间'] },
  { name: '温暖连接投稿表', purpose: '生日祝福与早安晚安内容投稿及审核结论', columns: ['投稿ID', '项目', '内容', '语气', '提交人', '状态', '审核意见', '审核人', '提交时间', '审核时间', '同意版本', '署名昵称', '投递方式', '目标学号', '投递条件', '附件'] },
  { name: '温暖祝福库表', purpose: '审核通过的生日祝福按投递方式分类入库（祝福仓库 / 指定个体 / 一对一随机）', columns: ['入库ID', '投稿ID', '项目', '分类', '内容', '署名昵称', '目标学号', '来源投稿人', '状态', '审核人', '入库时间'] },
  { name: '温暖祝福投递表', purpose: '生日当天自动投递（邮件 + 站内）留痕', columns: ['投递ID', '投稿ID', '收件人标识', '收件人学号', '触发日期', '来源', '邮件状态', '站内状态', '投递时间', '失败原因'] },
  { name: '温暖祝福举报表', purpose: '收件人举报已送达祝福的理由与处理结论', columns: ['举报ID', '投稿ID', '举报人标识', '举报人学号', '原因', '状态', '处理人', '处理意见', '处理时间', '提交时间'] },
  { name: '操作审计表', purpose: '登录、审批、出入库、签到核验、内容审核与公众端提交的操作留痕', columns: ['审计ID', '时间', '操作人', '角色', '动作', '对象', '结果', 'IP', '备注'] },
];
const stateSchema = [
  ...outreachSchema,
  ...communityStateSchema,
];
/**
 * Compares a declared schema against the live Base so the console can show what
 * is actually provisioned. Read-only: never creates or alters anything.
 */
async function schemaPreview(client, definitions) {
  const metadata = await client.getMetadata();
  const currentTables = new Map((metadata?.tables || []).map((table) => [table.name, table]));
  return definitions.map((definition) => {
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
}
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
function isFlagOn(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return /^(true|是|yes|y|1|开启|成功|通过|已报名|已核对|已录入)$/i.test(String(value).trim());
}
function isFlagOff(value) {
  if (value === false) return true;
  return /^(false|否|no|n|0|禁用|关闭)$/i.test(String(value ?? '').trim());
}
function cellText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) {
    const text = value.map((item) => cellText(item, '')).filter(Boolean).join('、');
    return text || fallback;
  }
  if (typeof value === 'object') {
    const candidate = value.display_value ?? value.name ?? value.title ?? value.label ?? value.value;
    return candidate === value ? fallback : cellText(candidate, fallback);
  }
  const text = String(value).trim();
  return text || fallback;
}
function inventorySummary(row, config = {}) {
  const initial = toFiniteNumber(row['初始数量']);
  const baselineQuantity = toFiniteNumber(row['现有数量']);
  const quantity = baselineQuantity + toFiniteNumber(config.__ledgerDelta);
  const configuredThreshold = toFiniteNumber(config['预警阈值']);
  const fallbackThreshold = initial > 0 ? Math.min(initial, Math.max(1, Math.ceil(initial * 0.2))) : 0;
  const threshold = isFlagOff(config['阈值启用'])
    ? null
    : Math.min(initial > 0 ? initial : Number.POSITIVE_INFINITY, configuredThreshold > 0 ? configuredThreshold : fallbackThreshold);
  const flow = config.__flowStats || {};
  const difference = initial - quantity;
  const baselineBorrowed = toFiniteNumber(row['借出数量']);
  const baselineReturned = toFiniteNumber(row['归还数量']);
  const baselineOutstanding = Math.max(0, baselineBorrowed - baselineReturned);
  const untrackedDifference = Math.max(0, Math.abs(initial - baselineQuantity) - baselineOutstanding - Math.max(0, toFiniteNumber(flow.outbound) - toFiniteNumber(flow.returned)));
  const thresholdStatus = threshold !== null && quantity <= threshold
    ? (quantity < initial ? 'critical' : 'notice')
    : null;
  return {
    id: row._id, code: materialCode(row), name: String(row['物资名称'] || '未命名物资'), center: String(row['中心'] || '未分类'), unit: String(row['单位'] || '件'), cabinet: String(row['柜号'] || '未标注'), level: String(row['层数'] || '未标注'), initial, baselineQuantity, quantity, difference, baselineDifference: initial - baselineQuantity, baselineBorrowed, baselineReturned, baselineOutstanding, untrackedDifference, threshold,
    outbound: toFiniteNumber(flow.outbound), returned: toFiniteNumber(flow.returned), inbound: toFiniteNumber(flow.inbound), loss: toFiniteNumber(flow.loss), adjustment: toFiniteNumber(flow.adjustment), destinations: flow.destinations || [], sourceStatuses: Array.isArray(row['物资管理']) ? row['物资管理'].map(String) : [],
    lowStock: thresholdStatus === 'critical', thresholdStatus,
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
function cleanText(value, label, max = 200, { allowNewlines = false } = {}) {
  if (typeof value !== 'string') {
    const error = new Error(`${label}格式不正确`); error.statusCode = 400; throw error;
  }
  let text = value.trim();
  if (!text) { const error = new Error(`${label}不能为空`); error.statusCode = 400; throw error; }
  const control = allowNewlines ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  text = text.replace(control, '').replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
  if (text.length > max) { const error = new Error(`${label}长度不能超过${max}个字符`); error.statusCode = 400; throw error; }
  return text;
}
function optionalCleanText(value, label, max = 200, options) {
  if (value === undefined || value === null || value === '') return '';
  return cleanText(value, label, max, options);
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
async function volunteerRows(client, tableName, maxRows = 5000) {
  return listAllRows(client, tableName, { maxRows });
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
    volunteerRows(client, '个人主页（编辑版）'),
    volunteerRows(client, '活动及时长汇总表'),
  ]);
  const workflow = summarizeVolunteerWorkflow(registrations, checkins);
  const events = workflow.groups;
  const registrationsById = new Map(registrations.map(row => [row._id, row]));
  const checkinsById = new Map(checkins.map(row => [row._id, row]));
  const approvalQueue = approvals.slice(-8).reverse().map((row) => ({
    activity: cellText(row['活动名称'], '未命名活动'), type: cellText(row['活动类别'], '活动'), date: row['活动日期'] || null,
    owner: maskedApplicant(cellText(row['负责人'])), status: isFlagOn(row['审批通过']) ? '已通过' : cellText(row['进程'], '待处理'), progress: cellText(row['进程']),
  }));
  const recentCheckins = checkins.slice(-8).reverse().map(row => ({
    activity: cellText((Array.isArray(row['活动名称']) ? row['活动名称'] : []).map(link => registrationsById.get(link?.row_id || link)?.['活动名称']).filter(Boolean), '关联待核验'),
    name: maskedApplicant(cellText(row['姓名'])), time: row['活动时间'] || row['创建时间'] || null, verified: row['已核对并录入'] === '已核对并录入',
  }));
  const pendingHours = registrations.map(row => ({ row, readiness: registrationReadiness(row, checkinsById) }))
    .filter(item => ['待录入', '待核定时长', '需核验'].includes(item.readiness.state));
  const hoursQueue = pendingHours.slice(-50).reverse().map(({ row, readiness }) => ({
    id: row._id,
    activity: cellText(row['活动名称'], '未命名活动'), date: row['报名日期'] || null,
    slot: cellText(row['报名时段']), position: cellText(row['岗位']),
    name: maskedApplicant(cellText(row['姓名'])), hours: readiness.hours == null ? '待核定' : String(readiness.hours),
    status: readiness.state, entryStatus: cellText(row['录入状态'], '未填写'),
    statusSource: 'derived', problems: readiness.problems,
  }));
  return {
    ok: true, source: { baseUuid: volunteerBaseUuid, readOnly: true, tables: ['活动报名总表', '活动签到', '登记审批', '个人主页（编辑版）', '活动及时长汇总表'], reads: { registrations: readMeta(registrations), checkins: readMeta(checkins), approvals: readMeta(approvals), profiles: readMeta(profiles), hours: readMeta(hours) } },
    stats: { memberProfiles: profiles.length, registrations: registrations.length, checkins: checkins.length, approvals: approvals.length, eventCount: events.length, hoursQueue: pendingHours.length },
    workflow: { states: workflow.states, orphanCheckins: workflow.orphanCheckins, complete: ![registrations, checkins].some(rows => readMeta(rows).truncated), evidence: '报名记录ID与签到关联双向核验；录入状态来自活动报名总表', queueShown: hoursQueue.length, verifiedCheckins: workflow.registrationsWithVerifiedCheckin },
    events: events.sort((a, b) => b.registrations - a.registrations).slice(0, 12), approvalQueue, recentCheckins, hoursQueue,
  };
}
async function safeRows(client, tableName, maxRows = 5000) {
  try { return await listAllRows(client, tableName, { maxRows }); }
  catch { return []; }
}
/**
 * Collects the three legacy content sources into one review queue. Extracted so
 * that writing a review conclusion can snapshot the source title without
 * re-deriving the whole overview.
 */
async function buildCampaignRows(client) {
  const [planning, submissions, feedback] = await Promise.all([
    safeRows(client, '博爱青春策划案 线下答辩'),
    safeRows(client, '博爱青春纪念品大赛'),
    safeRows(client, '“红十字生命教育＋”第一轮试课'),
  ]);
  return {
    counts: { planning: planning.length, creative: submissions.length, feedback: feedback.length },
    rows: [
      ...planning.map((row) => ({ id: `planning:${row._id}`, type: '策划案', title: String(row['策划案名称'] || row['团队名称'] || '未命名策划'), status: '已收集', source: '博爱青春策划案 线下答辩', author: maskedApplicant(row['负责人'] || row['团队负责人'] || row['答辩人姓名'] || row['姓名']), submittedAt: row['提交时间'] || row['创建时间'] || row._ctime || row._mtime || null, summary: String(row['策划案简介'] || row['项目简介'] || row['策划案内容'] || '暂无摘要'), authorization: String(row['授权'] || row['是否同意公开'] || '未采集') })),
      ...submissions.map((row) => ({ id: `creative:${row._id}`, type: '文创征集', title: String(row['文创名称'] || row['参赛类别'] || '未命名作品'), status: '已收集', source: '博爱青春纪念品大赛', author: maskedApplicant(row['作者'] || row['姓名'] || row['学号'] || row['负责人']), submittedAt: row['提交时间'] || row['创建时间'] || row._ctime || row._mtime || null, summary: String(row['作品简介'] || row['设计理念'] || row['参赛说明'] || '暂无摘要'), authorization: String(row['授权'] || row['是否同意公开'] || '未采集') })),
      ...feedback.map((row) => ({ id: `feedback:${row._id}`, type: '课程反馈', title: String(row['课程名称'] || '未命名课程'), status: row['改进建议'] ? '有反馈' : '待补充', source: '“红十字生命教育＋”第一轮试课', author: maskedApplicant(row['反馈人'] || row['姓名'] || row['授课人']), submittedAt: row['提交时间'] || row['创建时间'] || row._ctime || row._mtime || null, summary: String(row['改进建议'] || row['课程反馈'] || '暂无摘要'), authorization: '内部反馈' })),
    ],
  };
}

async function getOutreachOverview(client) {
  const [{ counts, rows: campaignRows }, notices, reviews, publications] = await Promise.all([
    buildCampaignRows(client),
    volunteerBase ? getVolunteerBase().then(base => safeRows(base, process.env.SEATABLE_VOLUNTEER_NOTICE_TABLE || '报名通知')) : Promise.resolve([]),
    readOutreachReviews(client),
    readOutreachPublications(client),
  ]);
  const reviewedCampaigns = campaignRows.map((item) => ({ ...item, review: reviews[item.id] || null, publication: publications[item.id] || null, status: reviews[item.id]?.decision === 'approve' ? '已通过' : reviews[item.id]?.decision === 'return' ? '待修改' : item.status }));
  return {
    ok: true,
    stats: { contentCount: reviewedCampaigns.length, planningCount: counts.planning, creativeCount: counts.creative, feedbackCount: counts.feedback, noticeCount: notices.length, reviewPending: reviewedCampaigns.filter((item) => !item.review).length, reviewApproved: reviewedCampaigns.filter((item) => item.review?.decision === 'approve').length, reviewReturned: reviewedCampaigns.filter((item) => item.review?.decision === 'return').length, publicationPending: reviewedCampaigns.filter((item) => item.publication?.status === '待人工发布').length },
    // The console must be able to reach every item counted by contentCount.
    // Client-side filters can narrow the list without silently hiding rows.
    campaigns: reviewedCampaigns,
    notices: notices.slice(-12).reverse().map((row) => ({ type: String(row['活动类别'] || '活动'), title: String(row['活动名称'] || '未命名活动'), status: String(row['审批进程'] || row['隐藏'] || '待发布'), group: String(row['QQ群号'] || '') })),
    sources: ['博爱青春策划案 线下答辩', '博爱青春纪念品大赛', '“红十字生命教育＋”第一轮试课', ...(volunteerBase ? ['报名通知（志愿服务 Base）'] : [])],
  };
}
async function getNotificationsOverview(client, permissionValue = CONSOLE_PERMISSION_SCOPES) {
  const allowed = new Set(normalizePermissions(permissionValue, 'platform_admin'));
  const when = (scope, task, fallback = null) => allowed.has(scope) ? task() : Promise.resolve(fallback);
  const [materialsResult, eventsResult, outreachResult, volunteerResult, communityResult, publicSubmissionResult, warmthResult] = await Promise.allSettled([
    when('materials', () => getMaterialsOverview(client)),
    when('events', () => getEventsOverview(client)),
    when('outreach', () => getOutreachOverview(client)),
    when('events', () => volunteerBase ? getVolunteerBase().then(getVolunteerOverview) : Promise.resolve(null)),
    when('community', () => readCommunitySubmissions(client), []),
    when('outreach', () => readPublicSubmissions(client), []),
    when('community', () => readWarmthInterests(client), []),
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
  warmthInterests.filter((item) => item.status === enrollmentStatusPending).slice(0, 10).forEach((item) => items.push({ type: '温暖连接待确认', priority: 'medium', title: item.program === 'birthday' ? `生日祝福 · ${item.nickname}` : `早安晚安 · ${item.nickname}`, detail: '公众端自愿登记，需人工确认后才进入队列', view: 'community' }));
  const scopeByView = { materials: 'materials', activities: 'events', services: 'events', outreach: 'outreach', community: 'community' };
  const visibleItems = items.filter((item) => allowed.has(scopeByView[item.view]));
  const priority = { high: 0, medium: 1, low: 2 };
  visibleItems.sort((a, b) => priority[a.priority] - priority[b.priority]);
  return { ok: true, stats: { total: visibleItems.length, high: visibleItems.filter((item) => item.priority === 'high').length, medium: visibleItems.filter((item) => item.priority === 'medium').length, low: visibleItems.filter((item) => item.priority === 'low').length }, items: visibleItems.slice(0, 24), sources: { materials: allowed.has('materials') && Boolean(materials), events: allowed.has('events') && Boolean(events), outreach: allowed.has('outreach') && Boolean(outreach), volunteer: allowed.has('events') && Boolean(volunteer), community: allowed.has('community'), portal: true } };
}
async function getEventsOverview(client) {
  const [projects, sessions, registrations] = await Promise.all([
    listAllRows(client, eventProjectTable),
    listAllRows(client, eventSessionTable),
    listAllRows(client, eventRegistrationTable),
  ]);
  return {
    ok: true, source: { table: eventProjectTable, mode: 'managed-events', reads: { projects: readMeta(projects), sessions: readMeta(sessions), registrations: readMeta(registrations) } },
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
    listAllRows(client, eventProjectTable),
    listAllRows(client, eventSessionTable),
    listAllRows(client, eventRegistrationTable),
  ]);
  assertCompleteRows(projects, sessions, registrations);
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
  const confirmed = scopedActive.filter((row) => ['已确认', '已签到'].includes(row['报名状态'])).length;
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

const publicReadCache = createReadCache();

function getPublicEvents(client) {
  return publicReadCache.get('events', () => loadPublicEvents(client));
}

async function loadPublicEvents(client) {
  const [projects, sessions, registrations, workflow] = await Promise.all([
    listAllRows(client, eventProjectTable),
    listAllRows(client, eventSessionTable),
    listAllRows(client, eventRegistrationTable),
    ['production','test'].includes(process.env.PLATFORM_WORKFLOW_MODE) || process.env.PLATFORM_TEST_WORKFLOW === 'true'
      ? getWorkflow().then(w => w.publicRead()) : { events: [], registrations: [] },
  ]);
  return [...projects.filter(isPubliclyListed).map((project) => publicEventProjection(project, sessions, registrations)),
    ...projectWorkflowEvents(workflow.events, workflow.registrations)]
    .sort((a, b) => {
      const rank = (event) => (event.status === '报名中' ? 0 : event.status === '进行中' ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return String(a.startAt || '9999').localeCompare(String(b.startAt || '9999'));
    });
}
async function getMaterialsOverview(client) {
  const [applicationsRaw, inventoryRaw, configRaw, flowRaw] = await Promise.all([
    listAllRows(client, materialsTable),
    listAllRows(client, inventoryTable),
    listAllRows(client, '物资配置表'),
    listAllRows(client, '物资流水表'),
  ]);

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
  const thresholdNotices = inventory.filter((item) => item.thresholdStatus === 'notice');
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
    ok: true,
    policy: { thresholdRule: '优先采用配置表阈值；未配置时采用初始数量的 20%（至少 1，且不高于初始数量）', source: '物资配置表 + 物资流水表' },
    reads: { applications: readMeta(applicationsRaw), inventory: readMeta(inventoryRaw), config: readMeta(configRaw), flows: readMeta(flowRaw) },
    stats: { categoryCount: inventory.length, totalInventoryItems: inventory.length, totalInitialQuantity, totalCurrentQuantity, totalDifference, totalUntrackedDifference, totalLossQuantity, lowStockCount: lowStock.length, thresholdNoticeCount: thresholdNotices.length, pendingCount: pending.length, borrowedCount: applications.filter((item) => !item.returned && item.status.includes('借出')).length, overdueCount: overdue.length, abnormalReturnCount: abnormalReturns.length, flowCount: flowRaw.length },
    series: dailySeries(flowRaw, {
      inbound: (row) => (['入库', '归还', '盘点增加'].includes(String(row['操作类型'] || '')) ? [row['操作时间'], toFiniteNumber(row['数量'])] : null),
      outbound: (row) => (['出库', '报损', '盘点减少'].includes(String(row['操作类型'] || '')) ? [row['操作时间'], toFiniteNumber(row['数量'])] : null),
    }),
    inventory, applications: applications.sort((a, b) => b.overdueDays - a.overdueDays), pending, overdue, abnormalReturns, lowStock, thresholdNotices, recentFlows,
  };
}

function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
const withEventMutation = createMutationQueue();
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
    listAllRows(client, inventoryTable),
    listAllRows(client, '物资配置表'),
    listAllRows(client, '物资流水表'),
  ]);
  assertCompleteRows(inventory, configs, flows);
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
    listAllRows(client, materialsTable),
    listAllRows(client, '物资流水表'),
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
  const claims = { username: account.username, role: account.role, exp: Date.now() + sessionTtlSeconds * 1000, csrf: randomBytes(32).toString('base64url') };
  // Table accounts carry identity attributes that outlive a restart-less
  // registration, so they travel inside the signed token itself.
  claims.authVersion = sign(credentialVersion(account));
  if (account.memberCode) claims.memberCode = account.memberCode;
  if (account.email) claims.email = account.email;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
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
    // A disabled/retired account invalidates its existing session immediately
    // in this process; it cannot keep operating until the cookie expires.
    if (!canAuthenticate(account) || session.role !== account.role || !session.csrf || !Number.isFinite(session.exp) || session.exp <= Date.now() || revokedSessions.has(session.csrf) || session.authVersion !== sign(credentialVersion(account))) return null;
    return session;
  } catch { return null; }
}

function sessionCookie(value, maxAge = sessionTtlSeconds) {
  return `nju_redcross_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
}

function clientIp(req) {
  const peer = req.socket.remoteAddress || 'unknown';
  // Only the local reverse proxy may supply client identity.
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
    const forwarded = String(req.headers['x-real-ip'] || '');
    if (/^[0-9a-fA-F:.]+$/.test(forwarded) && forwarded.length <= 45) return forwarded;
  }
  return peer;
}
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
    json(res, 401, { ok: false, code: 'login_required', message: '请先登录平台。' });
    return null;
  }
  return session;
}

/**
 * Console guard. A signed-in member is told plainly that this surface is not
 * theirs, instead of being bounced to a login form they have already passed.
 */
function requireConsoleAccess(req, res, requiredScope = null) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { ok: false, code: 'login_required', message: '请先登录管理平台。' });
    return null;
  }
  if (!consoleRoles.has(session.role)) {
    json(res, 403, { ok: false, code: 'console_forbidden', message: '当前账号属于活动平台，没有管理平台权限。' });
    return null;
  }
  const account = accountsByUsername.get(session.username);
  if (requiredScope && !hasPermission(account, requiredScope)) {
    json(res, 403, { ok: false, code: 'permission_denied', requiredScope, message: `当前账号没有 ${requiredScope} 模块权限。` });
    return null;
  }
  return session;
}

/** Portal guard. Any signed-in account may use the student surface. */
function requirePortalSession(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { ok: false, code: 'login_required', message: '该操作需要先登录活动平台。' });
    return null;
  }
  return session;
}

function requireCsrf(req, res, session) {
  const csrf = req.headers['x-csrf-token'];
  if (typeof csrf !== 'string' || !safeEqual(csrf, session.csrf)) {
    json(res, 403, { ok: false, code: 'csrf_failed', message: 'CSRF 校验失败，请刷新页面后重试。' });
    return false;
  }
  return true;
}

/** Combined guard for student-surface writes: signed in, then CSRF checked. */
function requirePortalWrite(req, res) {
  const session = requirePortalSession(req, res);
  if (!session) return null;
  if (!requireCsrf(req, res, session)) return null;
  return session;
}

function businessAccountRef(session) {
  return accountsByUsername.get(session.username)?.accountId || session.username;
}
function ownsBusinessRef(session, value) {
  return [session.username,businessAccountRef(session)].includes(String(value || ''));
}

function sessionPayload(session) {
  const account = accountsByUsername.get(session.username);
  const role = roleDefinitions[session.role];
  return {
    ok: true,
    authenticated: true,
    user: {
      username: session.username,
      accountId: account?.accountId || null,
      label: account?.label || session.username,
      role: session.role,
      roleLabel: role?.label || session.role,
      surfaces: role?.surfaces || [],
      consoleAccess: consoleRoles.has(session.role),
      permissions: normalizePermissions(account?.permissions, session.role),
      memberCode: account?.memberCode || session.memberCode || null,
      email: account?.email || session.email || null,
      realName: account?.realName || null,
      studentId: account?.studentId || null,
    },
    csrfToken: session.csrf,
    expiresAt: session.exp,
  };
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
    const username = String(body.username || '').trim().toLowerCase();
    if (username.length > 160 || typeof body.password !== 'string' || body.password.length > 72) return json(res, 400, { ok: false, message: '账号或密码格式不正确。' });
    let account;
    if (accountLoad.source.startsWith('seatable:')) {
      // Always reload the authoritative record; password and status changes cannot
      // fall back to stale cached credentials when SeaTable is unavailable.
      const resolved = await resolveSignInAccount(await getIdentityBase(), username);
      if (resolved.ambiguous) {
        recordFailedLogin(ip);
        return json(res,409,{ok:false,code:'ambiguous_login',message:'姓名或学号对应多个账号，请使用校园邮箱或唯一学号登录。'});
      }
      account = resolved.account;
      if (account) accountsByUsername.set(account.username, account);
    } else {
      account = accountsByUsername.get(username);
    }
    // Table accounts carry a scrypt hash; file-bootstrap accounts still hold a
    // plaintext password, so both paths must be accepted during the migration.
    const supplied = String(body.password || '');
    const passwordOk = Boolean(account) && (account.passwordHash
      ? verifyPassword(supplied, account.passwordHash)
      : safeEqual(supplied, account.password));
    const active = Boolean(account) && (!account.status || account.status === '启用');
    if (!account || !passwordOk || !active) {
      recordFailedLogin(ip);
      return json(res, 401, { ok: false, message: '用户名或密码错误。' });
    }
    if (!canAuthenticate(account)) return json(res, 403, { ok: false, code: 'email_verification_required', email: account.email, message: '请先完成校园邮箱验证，再登录。' });
    if (account.rowId) await (await getIdentityBase()).updateRow(ACCOUNT_TABLE, account.rowId, { 最近登录: new Date().toISOString() });
    await recordAudit(req, account, 'identity.login', account.username, 'success', {});
    loginAttempts.delete(ip);
    const token = makeSession(account);
    const session = getSession({ headers: { cookie: `nju_redcross_session=${token}` } });
    return json(res, 200, sessionPayload(session), { 'Set-Cookie': sessionCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const session = requireSession(req, res);
    if (!session || !requireCsrf(req, res, session)) return;
    revokedSessions.set(session.csrf, session.exp);
    for (const [key, expiry] of revokedSessions) if (expiry <= Date.now()) revokedSessions.delete(key);
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

function getPublicOverview(client) {
  return publicReadCache.get('overview', () => loadPublicOverview(client));
}

async function loadPublicOverview(client) {
  const [events, inventory] = await Promise.all([
    getPublicEvents(client),
    listAllRows(client, inventoryTable),
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
      volunteerRecords: null,
    },
    featured: open.slice(0, 6),
    recent: events.filter((event) => event.status !== '报名中').slice(0, 4),
    programs: publicPrograms,
    emailDomains: publicEmailDomains,
  };
}

/**
 * Student surface. Reading is open so anyone can browse activities, materials
 * and the warmth programme before deciding to take part; creating a record, or
 * reading back one's own records, requires a signed-in account. Every write is
 * additionally rate limited, consent gated and never echoes personal data.
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
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'register', 6);
    const body = await readJson(req);
    const account=accountsByUsername.get(session.username);
    if(!account?.emailVerified||!account.realName)return json(res,403,{ok:false,message:'请先在会员中心完善真实姓名并完成邮箱验证。'});
    const outcome = await registerForEvent(client, {
      eventKey: decodeURIComponent(publicRegistration[1]),
      body:{...body,name:account.realName,email:account.email},
      participantRef: businessAccountRef(session),
      restrictEmailDomain: true,
    });
    await recordAudit(req, session, 'public.event.registration', outcome.row['报名ID'], 'success', { eventId: outcome.project['活动ID'], status: outcome.status });
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
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'lookup', 30);
    const body = await readJson(req);
    const code = requiredText(body.code, '报名编号', 60);
    const email = String(body.email || '').trim().toLowerCase();
    const [registrations, projects, sessions] = await Promise.all([
      safeRows(client, eventRegistrationTable),
      safeRows(client, eventProjectTable),
      safeRows(client, eventSessionTable),
    ]);
    const record = registrations.find((row) => {
      if (String(row['报名ID'] || '').toUpperCase() !== code.toUpperCase()) return false;
      // Either the record belongs to the signed-in account, or the caller
      // proved ownership with the exact mailbox used at registration time.
      if (ownsBusinessRef(session,row['参与者引用'])) return true;
      return Boolean(email) && email === String(accountsByUsername.get(session.username)?.email || '').toLowerCase() && String(row['南大邮箱'] || '').toLowerCase() === email;
    });
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
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'materials', 5);
    const body = await readJson(req);
    assertPublicEmail(String(body.email || '').trim());
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认物资借用与归还责任条款。' });
    const row = materialRequestPayload(body);
    const result = await client.appendRow(materialsTable, row);
    await recordAudit(req, session, 'public.materials.application', result?._id || 'new', 'success', { purpose: row['借用用途'], quantity: row['借用件数'] });
    return json(res, 201, {
      ok: true,
      request: { code: `REQ-${result?._id || ''}`, status: '待审批', items: row['借用物资名及数量'], plannedBorrowDate: row['拟借用日期'], plannedReturnDate: row['拟归还日期'] },
      message: '借用申请已提交，等待物资管理员审批。',
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/submissions') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'submissions', 8);
    const body = await readJson(req);
    const title = requiredText(body.title, '标题', 120);
    const content = requiredText(body.content, '正文', 4000);
    const category = String(body.category || '宣传稿件').trim();
    const email = assertPublicEmail(requiredText(body.email, '联系邮箱', 160));
    const name = requiredText(body.name, '联系人', 60);
    if (body.originalConfirm !== true) return json(res, 400, { ok: false, message: '请确认内容为原创或已获得授权。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认内容使用范围与审核规则。' });
    const submission = {
      id: eventIdentifier('SUB'),
      title, content, category,
      signature: String(body.signature || '实名署名').trim(),
      contactName: name,
      contactEmail: email,
      submitterRef: businessAccountRef(session),
      originalConfirm: true,
      portraitConfirm: body.portraitConfirm === true,
      status: submissionStatusPending,
      submittedAt: new Date().toISOString(),
      consentVersion: 'v1',
      review: null,
    };
    await client.appendRow(outreachSubmissionTable, publicSubmissionRow(submission));
    await recordAudit(req, session, 'public.submission.create', submission.id, 'success', { category, length: content.length });
    return json(res, 201, { ok: true, submission: { id: submission.id, status: submission.status, submittedAt: submission.submittedAt, title }, message: '投稿已提交，进入人工审核队列。' });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/warmth/blessings') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, '昵称', 40);
    const content = cleanText(body.content, '祝福内容', 1000, { allowNewlines: true });
    const delivery = cleanText(body.delivery, '投递方式', 20);
    if (!Object.hasOwn(WARMTH_DELIVERY_LABELS, delivery)) return json(res, 400, { ok: false, message: '请选择祝福的投递方式。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认祝福由本人撰写并接受人工审核。' });
    const enrollments = await readWarmthInterests(client);
    const enrolled = enrollments.some((item) => item.program === 'birthday' && item.participantRef === actorRef && isConfirmedEnrollmentStatus(item.status));
    if (!enrolled) return json(res, 403, { ok: false, message: '请先加入生日祝福计划，再写祝福。' });
    const resolvedDelivery = resolveWarmthDelivery({ delivery, rawTargetStudentId: body.targetStudentId, actorRef, enrollments });
    if (!resolvedDelivery.ok) return json(res, 400, { ok: false, message: resolvedDelivery.message });
    const { targetStudentId, deliveryState, status } = resolvedDelivery;
    const blessingId = eventIdentifier('CARE');
    const submittedAt = new Date().toISOString();
    await client.appendRow(communitySubmissionTable, {
      投稿ID: blessingId,
      项目: 'birthday',
      内容: content,
      语气: '温暖',
      提交人: session.username,
      状态: status,
      审核意见: '',
      审核人: '',
      提交时间: submittedAt,
      审核时间: '',
      同意版本: 'v1',
      投递方式: WARMTH_DELIVERY_LABELS[delivery],
      目标学号: targetStudentId,
      投递条件: deliveryState,
      署名昵称: nickname,
      附件: '',
    });
    await recordAudit(req, session, 'public.warmth.blessing.create', blessingId, 'success', { delivery });
    return json(res, 201, {
      ok: true,
      blessing: { id: blessingId, nickname, status, delivery: WARMTH_DELIVERY_LABELS[delivery], deliveryState },
      message: status === submissionStatusWaiting
        ? '祝福已提交。对方还没有加入生日祝福计划，等他加入后会进入审核队列。'
        : '祝福已提交，等待管理员审核。',
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/public/warmth/blessings/mine') {
    const session = requirePortalSession(req, res);
    if (!session) return;
    const mine = (await readWarmthBlessings(client)).filter((item) => item.actor === session.username);
    const approved = mine.filter((item) => item.status === submissionStatusApproved).length;
    return json(res, 200, {
      ok: true,
      stats: { total: mine.length, pending: mine.filter((item) => item.status === submissionStatusPending).length, waiting: mine.filter((item) => item.status === submissionStatusWaiting).length, approved, revision: mine.filter((item) => item.status === submissionStatusReturned).length, rejected: mine.filter((item) => item.status === submissionStatusRejected).length, oneOnOneQuota: approved },
      blessings: mine.map((item) => ({ ...item, excerpt: item.content.slice(0, 60) })),
    });
  }

  // 站内投递：只返回投递给本人的祝福（不是祝福库本身，公众端不展示祝福库）。
  if (req.method === 'GET' && url.pathname === '/api/public/warmth/blessings/delivered') {
    const session = requirePortalSession(req, res);
    if (!session) return;
    const account = accountsByUsername.get(session.username);
    const myStudentId = String(account?.studentId || '').trim();
    // 姓名自动取自个人资料（与同步到「个人主页（编辑版）」的姓名同源），无需任何填写
    const recipientName = String(account?.realName || '').trim();
    const [deliveries, library, reports] = await Promise.all([readWarmthDeliveries(client), readBlessingLibrary(client), readWarmthReports(client)]);
    const actorRef = businessAccountRef(session);
    const bySubmission = new Map(library.map((item) => [item.submissionId, item]));
    const mine = myStudentId
      ? deliveries.filter((row) => row.siteStatus === DELIVERY_SITE_DONE && row.studentId === myStudentId)
      : [];
    return json(res, 200, {
      ok: true,
      recipientName,
      blessings: mine.map((row) => ({
        id: row.id,
        submissionId: row.submissionId,
        content: bySubmission.get(row.submissionId)?.content || '',
        nickname: bySubmission.get(row.submissionId)?.nickname || '',
        source: row.source,
        reported: reports.some((report) => report.submissionId === row.submissionId && report.reporterRef === actorRef),
        deliveredAt: row.deliveredAt,
      })).filter((item) => item.content),
    });
  }

  // 举报：只有收到该祝福的人可以举报，必须填写理由；同一人对同一条只允许一次待处理举报。
  const warmthBlessingReport = url.pathname.match(/^\/api\/public\/warmth\/blessings\/([^/]+)\/report$/);
  if (warmthBlessingReport && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    enforcePublicLimit(req, 'warmth-report', 5, actorRef);
    const blessingId = decodeURIComponent(warmthBlessingReport[1]);
    const body = await readJson(req);
    const reason = cleanText(body.reason, '举报理由', 500, { allowNewlines: true });
    const account = accountsByUsername.get(session.username);
    const myStudentId = String(account?.studentId || '').trim();
    const outcome = await withKeyedLock(`warmth-report:${blessingId}:${actorRef}`, async () => {
      const received = (await readWarmthDeliveries(client)).some((row) => row.submissionId === blessingId
        && row.siteStatus === DELIVERY_SITE_DONE
        && myStudentId
        && row.studentId === myStudentId);
      if (!received) return { code: 403, payload: { ok: false, message: '只能举报已经送达给你的祝福。' } };
      const existing = (await readWarmthReports(client)).find((row) => row.submissionId === blessingId && row.reporterRef === actorRef && row.status === REPORT_STATUS_PENDING);
      if (existing) return { code: 409, payload: { ok: false, message: '你已经举报过这条祝福，管理员正在处理。' } };
      const reportId = eventIdentifier('RPT');
      await client.appendRow(blessingReportTable, {
        举报ID: reportId,
        投稿ID: blessingId,
        举报人标识: actorRef,
        举报人学号: myStudentId,
        原因: reason,
        状态: REPORT_STATUS_PENDING,
        处理人: '',
        处理意见: '',
        处理时间: '',
        提交时间: new Date().toISOString(),
      });
      await recordAudit(req, session, 'public.warmth.blessing.report', reportId, 'success', { blessingId });
      return { code: 201, payload: { ok: true, report: { id: reportId, status: REPORT_STATUS_PENDING }, message: '举报已提交，管理员会尽快处理。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  const warmthBlessingResubmit = url.pathname.match(/^\/api\/public\/warmth\/blessings\/([^/]+)\/resubmit$/);
  if (warmthBlessingResubmit && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    const blessingId = decodeURIComponent(warmthBlessingResubmit[1]);
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, '昵称', 40);
    const content = cleanText(body.content, '祝福内容', 1000, { allowNewlines: true });
    const delivery = cleanText(body.delivery, '投递方式', 20);
    if (!Object.hasOwn(WARMTH_DELIVERY_LABELS, delivery)) return json(res, 400, { ok: false, message: '请选择祝福的投递方式。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认祝福由本人撰写并接受人工审核。' });
    const outcome = await withKeyedLock(`warmth-blessing:${blessingId}`, async () => {
      const rows = await stateRows(client, communitySubmissionTable);
      const row = rows.find((item) => String(item['投稿ID'] || '') === blessingId);
      if (!row) return { code: 404, payload: { ok: false, message: '祝福不存在。' } };
      if (String(row['提交人'] || '') !== session.username) return { code: 403, payload: { ok: false, message: '只能修改自己的祝福。' } };
      if (String(row['状态'] || '') !== submissionStatusReturned) return { code: 409, payload: { ok: false, message: '只有「需修改」的祝福可以重新提交。' } };
      const confirmedEnrollments = await readWarmthInterests(client);
      const stillJoined = confirmedEnrollments.some((item) => item.program === 'birthday' && item.participantRef === actorRef && isConfirmedEnrollmentStatus(item.status));
      if (!stillJoined) return { code: 403, payload: { ok: false, message: '请先加入生日祝福计划，再重新提交祝福。' } };
      const resolvedDelivery = resolveWarmthDelivery({ delivery, rawTargetStudentId: body.targetStudentId, actorRef, enrollments: confirmedEnrollments });
      if (!resolvedDelivery.ok) return { code: 400, payload: { ok: false, message: resolvedDelivery.message } };
      const { targetStudentId, deliveryState, status } = resolvedDelivery;
      await client.updateRow(communitySubmissionTable, row._id, {
        内容: content,
        署名昵称: nickname,
        投递方式: WARMTH_DELIVERY_LABELS[delivery],
        目标学号: targetStudentId,
        投递条件: deliveryState,
        状态: status,
        提交时间: new Date().toISOString(),
      });
      await recordAudit(req, session, 'public.warmth.blessing.resubmit', blessingId, 'success', { delivery });
      return { code: 200, payload: { ok: true, blessing: { id: blessingId, status, delivery: WARMTH_DELIVERY_LABELS[delivery], deliveryState }, message: status === submissionStatusWaiting ? '已重新提交。对方还没有加入计划，等他加入后会进入审核队列。' : '已重新提交，等待管理员审核。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  if (req.method === 'POST' && url.pathname === '/api/public/warmth/interest') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    enforcePublicLimit(req, 'warmth-join', 10, actorRef);
    const body = await readJson(req);
    const program = cleanText(body.program, '项目', 20);
    if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目。' });
    // Contact details always come from the verified account, never from the body.
    const account = accountsByUsername.get(session.username);
    const email = assertPublicEmail(String(account?.email || '').trim());
    if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出与人工审核规则。' });
    const isBirthdayProgram = program === 'birthday';
    let nickname = '';
    let frequency = '';
    let campus = '';
    let birthdayMonthDay = '';
    let note = '';
    if (isBirthdayProgram) {
      // Birthday is picked as month + day; the year is never collected or stored.
      birthdayMonthDay = cleanText(body.birthdayMonthDay, '生日月日', 5);
      if (!isValidBirthdayMonthDay(birthdayMonthDay)) return json(res, 400, { ok: false, message: '请选择有效的生日月份和日期。' });
      campus = cleanText(body.campus, '校区', 10);
      if (!WARMTH_CAMPUS_OPTIONS.includes(campus)) return json(res, 400, { ok: false, message: '请选择鼓楼、仙林、苏州或浦口校区。' });
    } else {
      nickname = cleanText(body.nickname, '显示昵称', 40);
      frequency = cleanText(body.frequency, '接收频率', 10);
      if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率。' });
      campus = optionalCleanText(body.campus, '校区', 20);
      note = optionalCleanText(body.note, '备注', 300, { allowNewlines: true });
    }
    const outcome = await withKeyedLock(`warmth-interest:${actorRef}:${program}`, async () => {
      const interests = await readWarmthInterests(client);
      const active = interests.find((item) => item.participantRef === actorRef && item.program === program && isActiveEnrollmentStatus(item.status));
      if (active) {
        return {
          code: 409,
          payload: {
            ok: false,
            message: isBirthdayProgram
              ? '你已报名生日祝福计划，请在会员中心修改或退出。'
              : '该账号已经登记过这个项目，无需重复提交。',
          },
        };
      }
      const submittedAt = new Date().toISOString();
      const inactive = interests.find((item) => item.participantRef === actorRef && item.program === program && !isActiveEnrollmentStatus(item.status));
      // Joining the birthday programme is a self-service opt-in: the member is
      // active immediately, and only submitted content goes through review.
      const enrollmentStatus = isBirthdayProgram ? enrollmentStatusConfirmed : enrollmentStatusPending;
      const rowPatch = {
        频率: frequency,
        昵称: nickname,
        邮箱: email,
        校区: campus,
        生日月日: birthdayMonthDay,
        备注: note,
        内容模式: 'reviewed',
        状态: enrollmentStatus,
        同意版本: 'v1',
        提交时间: submittedAt,
        处理人: isBirthdayProgram ? '系统自动确认' : '',
        处理时间: isBirthdayProgram ? submittedAt : '',
      };
      if (inactive) {
        await updateEnrollment(client, inactive.id, rowPatch);
        if (isBirthdayProgram) await cascadeWarmthTargetStatus(client, actorRef, true);
        await recordAudit(req, session, 'public.warmth.interest.rejoin', inactive.id, 'success', { program });
        return { code: 200, payload: { ok: true, interest: { id: inactive.id, program, frequency, status: enrollmentStatus }, message: isBirthdayProgram ? '已重新加入生日祝福计划，可以直接写祝福了。' : '已重新提交参加意愿，等待人工确认。' } };
      }
      const interestId = eventIdentifier('WARM');
      await saveEnrollment(client, interestId, { 来源: portalEnrollmentSource, 项目: program, ...rowPatch });
      if (isBirthdayProgram) await cascadeWarmthTargetStatus(client, actorRef, true);
      await recordAudit(req, session, 'public.warmth.interest', interestId, 'success', { program, frequency });
      return { code: 201, payload: { ok: true, interest: { id: interestId, program, frequency, status: enrollmentStatus }, message: isBirthdayProgram ? '已加入生日祝福计划，可以直接写祝福了；内容仍会先经人工审核。' : '已记录你的参加意愿。平台不会自动发送内容，所有内容都会先经人工审核。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  const warmthInterestUpdate = url.pathname.match(/^\/api\/public\/warmth\/interests\/([^/]+)\/update$/);
  if (warmthInterestUpdate && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    enforcePublicLimit(req, 'warmth-update', 30, actorRef);
    const interestId = decodeURIComponent(warmthInterestUpdate[1]);
    const body = await readJson(req);
    const birthdayMonthDay = cleanText(body.birthdayMonthDay, '生日月日', 5);
    if (!isValidBirthdayMonthDay(birthdayMonthDay)) return json(res, 400, { ok: false, message: '请选择有效的生日月份和日期。' });
    const campus = cleanText(body.campus, '校区', 10);
    if (!WARMTH_CAMPUS_OPTIONS.includes(campus)) return json(res, 400, { ok: false, message: '请选择鼓楼、仙林、苏州或浦口校区。' });
    const outcome = await withKeyedLock(`warmth-enrollment:${interestId}`, async () => {
      const rows = await readEnrollmentRows(client);
      const row = rows.find((item) => String(item['登记ID'] || '') === interestId);
      if (!row) return { code: 404, payload: { ok: false, message: '参加登记不存在。' } };
      if (String(row['来源'] || '') !== portalEnrollmentSource || String(row['参与者标识'] || '') !== actorRef) {
        return { code: 403, payload: { ok: false, message: '只能修改自己的登记。' } };
      }
      if (String(row['项目'] || '') !== 'birthday') return { code: 400, payload: { ok: false, message: '该登记不是生日祝福计划。' } };
      if (!isActiveEnrollmentStatus(row['状态'])) return { code: 409, payload: { ok: false, message: '已退出的登记不能修改，请重新报名。' } };
      await updateEnrollment(client, interestId, { 校区: campus, 生日月日: birthdayMonthDay });
      await recordAudit(req, session, 'public.warmth.interest.update', interestId, 'success', { campus });
      return { code: 200, payload: { ok: true, interest: { id: interestId, program: 'birthday', status: String(row['状态'] || ''), campus, birthdayMonthDay }, message: '生日资料已更新。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  const warmthInterestWithdraw = url.pathname.match(/^\/api\/public\/warmth\/interests\/([^/]+)\/withdraw$/);
  if (warmthInterestWithdraw && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    enforcePublicLimit(req, 'warmth-withdraw', 10, actorRef);
    const interestId = decodeURIComponent(warmthInterestWithdraw[1]);
    const outcome = await withKeyedLock(`warmth-enrollment:${interestId}`, async () => {
      const rows = await readEnrollmentRows(client);
      const row = rows.find((item) => String(item['登记ID'] || '') === interestId);
      if (!row) return { code: 404, payload: { ok: false, message: '参加登记不存在。' } };
      if (String(row['来源'] || '') !== portalEnrollmentSource || String(row['参与者标识'] || '') !== actorRef) {
        return { code: 403, payload: { ok: false, message: '只能退出自己的登记。' } };
      }
      if (String(row['状态'] || '') !== enrollmentStatusWithdrawn) {
        await updateEnrollment(client, interestId, { 状态: enrollmentStatusWithdrawn, 处理人: session.username, 处理时间: new Date().toISOString() });
        await cascadeWarmthTargetStatus(client, actorRef, false);
        await recordAudit(req, session, 'public.warmth.interest.withdraw', interestId, 'success', {});
      }
      return { code: 200, payload: { ok: true, message: '已退出该计划，之后不会再进入匹配或发送队列。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  return json(res, 404, { ok: false, message: 'Not found' });
}

/**
 * Signed-in student surface. Everything is scoped to the session account, so a
 * member can only ever read back their own records — there is no code path here
 * that accepts another person's identifier.
 */
async function portalRoutes(req, res, url) {
  if (!url.pathname.startsWith('/api/portal/')) return false;
  const session = requirePortalSession(req, res);
  if (!session) return;
  const client = await getBase();

  if (req.method === 'GET' && url.pathname === '/api/portal/me') {
    const [registrations, projects, sessions, submissions, enrollments] = await Promise.all([
      safeRows(client, eventRegistrationTable),
      safeRows(client, eventProjectTable),
      safeRows(client, eventSessionTable),
      readPublicSubmissions(client),
      readWarmthInterests(client),
    ]);

    const myRegistrations = registrations
      .filter((row) => ownsBusinessRef(session,row['参与者引用']))
      .map((row) => {
        const project = projects.find((item) => item['活动ID'] === row['活动ID']);
        const eventSession = sessions.find((item) => String(item['场次ID'] || '') === String(row['场次ID'] || ''));
        return {
          code: String(row['报名ID'] || ''),
          status: String(row['报名状态'] || ''),
          waitlist: toFiniteNumber(row['候补序号']),
          eventName: String(project?.['活动名称'] || '未命名活动'),
          eventStatus: String(project?.['状态'] || ''),
          startAt: eventSession?.['开始时间'] || project?.['活动开始'] || null,
          location: String(eventSession?.['地点'] || project?.['地点'] || ''),
          submittedAt: row['提交时间'] || null,
          checkedInAt: row['签到时间'] || null,
          cancelledAt: row['取消时间'] || null,
        };
      })
      .sort(byDateDesc('submittedAt'));

    const mySubmissions = submissions
      .filter((item) => ownsBusinessRef(session,item.submitterRef))
      .map((item) => ({ id: item.id, title: item.title, category: item.category, status: item.status, submittedAt: item.submittedAt, reviewNote: item.review?.note || '' }));

    const myEnrollments = enrollments
      .filter((item) => ownsBusinessRef(session,item.participantRef))
      .map((item) => ({ id: item.id, program: item.program, frequency: item.frequency, status: item.status, submittedAt: item.submittedAt, campus: item.campus, birthdayMonthDay: item.birthdayMonthDay }));

    return json(res, 200, {
      ok: true,
      account: sessionPayload(session).user,
      stats: { registrations: myRegistrations.length, submissions: mySubmissions.length, enrollments: myEnrollments.length },
      registrations: myRegistrations,
      submissions: mySubmissions,
      enrollments: myEnrollments,
    });
  }

  return json(res, 404, { ok: false, message: 'Not found' });
}

/**
 * Wiring for the two development workstreams (identity, event operations).
 * Each module owns its own URL prefix and returns false for anything it does
 * not handle, so every original route keeps working untouched.
 */
configureMailer({
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpUser,
  smtpPassword,
  from: reminderFrom,
  isProduction,
  getClient: getIdentityBase,
});

const identityCtx = {
  ...(profileAccess?{getProfileBase}:{}),
  json,
  readJson,
  getBase: getIdentityBase,
  requireCsrf,
  requireSession,
  getSession,
  makeSession,
  sessionCookie,
  sessionPayload,
  recordAudit,
  clientIp,
  identifier: eventIdentifier,
  sendMail,
  accounts: accountsByUsername,
  accountStore: { tableName: ACCOUNT_TABLE, hashPassword, verifyPassword, generateMemberCode },
  config: {
    isProduction,
    privateIdentity: Boolean(identityApiToken),
    businessBaseUuid: process.env.SEATABLE_BUSINESS_BASE_UUID || '',
    volunteerBaseUuid,
    profileBaseUuid,
    registrationAvailable: mailerStatus().configured,
    codeSecret: sessionSecret,
    minimumPasswordLength,
    sessionTtlSeconds,
    // Strong binding: student self-registration only accepts campus mail.
    smailDomains: ['smail.nju.edu.cn', 'nju.edu.cn'],
    publicEmailDomains,
    publicWriteLimit,
    root,
  },
};

const eventsCtx = {
  json,
  readJson,
  getBase,
  requireConsoleAccess,
  requireCsrf,
  recordAudit,
  clientIp,
  identifier: eventIdentifier,
  getEventsOverview,
  njubox,
  tables: { project: eventProjectTable, session: eventSessionTable, registration: eventRegistrationTable },
  config: {
    root,
    njuboxServerUrl: process.env.NJUBOX_SERVER_URL?.trim() || 'https://box.nju.edu.cn',
    njuboxToken: process.env.NJUBOX_API_TOKEN?.trim() || '',
    njuboxRepoId: process.env.NJUBOX_REPO_ID?.trim() || '',
    njuboxUploadDir: process.env.NJUBOX_UPLOAD_DIR?.trim() || '/红十字会/活动策划案',
  },
};

async function api(req, res, url) {
  const eventWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    (/^\/api\/events(?:\/|$)/.test(url.pathname) || /^\/api\/public\/events\/[^/]+\/registrations$/.test(url.pathname));
  return eventWrite ? withEventMutation(() => dispatchApi(req, res, url)) : dispatchApi(req, res, url);
}

async function dispatchApi(req, res, url) {
  try {
    if (url.pathname.startsWith('/api/auth/') && req.method === 'POST' && req.headers.origin) {
      let trusted = false;
      try { const origin = new URL(req.headers.origin); trusted = origin.host === req.headers.host && ['https:', 'http:'].includes(origin.protocol); } catch {}
      if (!trusted) return json(res, 403, { ok: false, code: 'origin_forbidden', message: '请求来源不受信任。' });
    }
    if (accountLoad.source.startsWith('seatable:') && url.pathname !== '/api/auth/logout' && getSession(req)) {
      const session = getSession(req);
      const fresh = await findAccountByLogin(await getIdentityBase(), session.username);
      if (fresh) accountsByUsername.set(session.username, fresh);
      else accountsByUsername.delete(session.username);
    }

    if(['/api/volunteer/workflow','/api/portal/workflow','/api/public/workflow/events'].some(prefix=>url.pathname===prefix||url.pathname.startsWith(`${prefix}/`))) {
      return await workflowRoutes(req,res,url,{getWorkflow,getWishlist,getManagedSources:async()=>getEventsOverview(await getBase()).then(data=>data.events),requireConsoleAccess,requirePortalSession,requireCsrf,readJson,json,
        actor:businessAccountRef,getAccount:session=>getIdentityBase().then(base=>findAccountByLogin(base,session.username)),
        audit:(request,account,action,id)=>recordAudit(request,account,action,id,'success',{})});
    }
    if (url.pathname.startsWith('/api/portal/')) {
      return await portalRoutes(req, res, url);
    }
    if (url.pathname.startsWith('/api/public/')) {
      return await publicRoutes(req, res, url);
    }
    if (url.pathname.startsWith('/api/auth/')) {
      const identity = await identityRoutes(req, res, url, identityCtx);
      if (identity !== false) return identity;
      const handled = await authApi(req, res, url);
      if (handled !== false) return handled;
    }
    // The event-operations module owns both the bare prefixes and everything
    // under them (the smoke suite posts to /api/event-notices without a slash).
    const isEventsOps = ['/api/event-notices', '/api/event-attachments'].some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );
    if (isEventsOps) {
      return await eventsOpsRoutes(req, res, url, eventsCtx);
    }
    const requiredScope = scopeForConsolePath(url.pathname);
    const session = requireConsoleAccess(req, res, requiredScope);
    if (!session) return;
    const isWrite = ['POST', 'PUT', 'DELETE'].includes(req.method);
    if (isWrite && !requireCsrf(req, res, session)) return;
    const client = await getBase();

    if (req.method === 'GET' && url.pathname === '/api/materials/overview') {
      return json(res, 200, await getMaterialsOverview(client));
    }
    const qrMatch = url.pathname.match(/^\/api\/materials\/inventory\/([^/]+)\/qr$/);
    if (qrMatch && req.method === 'GET') {
      const [inventory, configs] = await Promise.all([listAllRows(client, inventoryTable), listAllRows(client, '物资配置表')]);
      const row = inventory.find((item) => item._id === decodeURIComponent(qrMatch[1]));
      if (!row) return json(res, 404, { ok: false, message: 'Inventory item not found' });
      const svg = await QRCode.toString(materialCode(row), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#520d2e', light: '#fffdfb' } });
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
    if (req.method === 'GET' && url.pathname === '/api/materials/scan') {
      const code = String(url.searchParams.get('code') || '').trim();
      if (!/^NJU-RC-[A-Za-z0-9_-]+$/.test(code)) return json(res, 400, { ok: false, message: 'Unsupported inventory QR code' });
      const [inventory, configs] = await Promise.all([listAllRows(client, inventoryTable), listAllRows(client, '物资配置表')]);
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
      const rows = await listAllRows(client, materialsTable);
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
          listAllRows(client, materialsTable),
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
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, tables: await schemaPreview(client, activitySchema) });
    }
    if (req.method === 'GET' && url.pathname === '/api/outreach/schema-preview') {
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, tables: await schemaPreview(client, outreachSchema) });
    }
    if (req.method === 'GET' && url.pathname === '/api/state/schema-preview') {
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, storage: 'seatable', tables: await schemaPreview(client, stateSchema) });
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
        listAllRows(client, eventProjectTable),
        listAllRows(client, eventSessionTable),
      ]);
      assertCompleteRows(projects, sessions);
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
      const projects = await listAllRows(client, eventProjectTable);
      assertCompleteRows(projects);
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
      const rows = await listAllRows(client, eventRegistrationTable);
      assertCompleteRows(rows);
      const registration = rows.find((row) => row._id === registrationId || row['报名ID'] === registrationId);
      if (!registration) return json(res, 404, { ok: false, message: '报名记录不存在' });
      if (registrationAction[2] === 'cancel') {
        const result = await client.updateRow(eventRegistrationTable, registration._id, { 报名状态: '已取消', 取消时间: new Date().toISOString() });
        await recordAudit(req, session, 'event.registration.cancel', registration['报名ID'], 'success', { eventId: registration['活动ID'] });
        return json(res, 200, { ok: true, result, message: '报名已取消' });
      }
      if (!['已确认', '已签到'].includes(registration['报名状态'])) return json(res, 409, { ok: false, message: '仅已确认的报名可以签到，候补或取消记录不能签到' });
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
      return json(res, 200, { ok: true, source: `seatable:${auditTable}`, entries: await readRecentAudit(Number(url.searchParams.get('limit') || 50)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/volunteer/hours-preview') {
      const body = await readJson(req);
      const source = await getVolunteerBase();
      const [registrations, checkins] = await Promise.all([
        listAllRows(source, '活动报名总表'), listAllRows(source, '活动签到'),
      ]);
      assertCompleteRows(registrations, checkins);
      if (body.exportConfigId !== undefined) {
        if (typeof body.exportConfigId !== 'string' || !body.exportConfigId) return json(res, 400, { ok: false, message: '导出配置标识无效' });
        const configs = await listAllRows(source, '志愿时长录入excel生成');
        assertCompleteRows(configs);
        return json(res, 200, { ok: true, ...previewHoursExport(registrations, checkins, body.registrationIds, configs.find(row => row._id === body.exportConfigId)) });
      }
      return json(res, 200, { ok: true, ...previewHoursEntry(registrations, checkins, body.registrationIds) });
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
      const { rows: campaignRows } = await buildCampaignRows(client);
      const item = campaignRows.find((campaign) => campaign.id === contentId);
      if (!item) return json(res, 404, { ok: false, message: '内容不存在，无法审核' });
      const review = { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() };
      await saveOutreachReview(client, contentId, review, item);
      await recordAudit(req, session, `outreach.review.${decision}`, contentId, 'success', { noteLength: note.length });
      return json(res, 200, { ok: true, review, message: decision === 'approve' ? '内容审核通过' : '内容已退回修改' });
    }
    const outreachPublication = url.pathname.match(/^\/api\/outreach\/publications\/([^/]+)\/schedule$/);
    if (outreachPublication && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachPublication[1]);
      const reviews = await readOutreachReviews(client);
      if (reviews[contentId]?.decision !== 'approve') return json(res, 409, { ok: false, message: '只有审核通过的内容才能排期' });
      const body = await readJson(req);
      const channel = String(body.channel || '').trim();
      if (!['site', 'email', 'wechat', 'qq'].includes(channel)) return json(res, 400, { ok: false, message: '不支持该发布渠道' });
      const plannedAt = parsedDate(body.plannedAt);
      if (!plannedAt) return json(res, 400, { ok: false, message: '请输入有效的计划发布时间' });
      const task = { taskId: eventIdentifier('PUB'), contentId, channel, plannedAt: plannedAt.toISOString(), status: '待人工发布', note: String(body.note || '').trim(), createdBy: session.username, createdAt: new Date().toISOString(), retryCount: 0 };
      await saveOutreachPublication(client, contentId, task);
      await recordAudit(req, session, 'outreach.publication.schedule', task.taskId, 'success', { contentId, channel, plannedAt: task.plannedAt });
      return json(res, 201, { ok: true, task, message: '发布任务已排期，等待人工确认' });
    }
    const outreachPublicationResult = url.pathname.match(/^\/api\/outreach\/publications\/([^/]+)\/result$/);
    if (outreachPublicationResult && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachPublicationResult[1]);
      const body = await readJson(req);
      const status = String(body.status || '').trim();
      if (!['published', 'failed'].includes(status)) return json(res, 400, { ok: false, message: '发布结果必须是 published 或 failed' });
      const publications = await readOutreachPublications(client);
      const task = publications[contentId];
      if (!task) return json(res, 404, { ok: false, message: '发布任务不存在' });
      const failureReason = String(body.failureReason || '').trim();
      if (status === 'failed' && !failureReason) return json(res, 400, { ok: false, message: '发布失败必须填写原因' });
      const updated = { ...task, status: status === 'published' ? '已发布' : '发布失败待重试', resultAt: new Date().toISOString(), publishedLink: String(body.publishedLink || '').trim(), failureReason, retryCount: status === 'failed' ? Number(task.retryCount || 0) + 1 : Number(task.retryCount || 0), resultBy: session.username };
      await saveOutreachPublication(client, contentId, updated);
      await recordAudit(req, session, `outreach.publication.${status}`, task.taskId, 'success', { contentId, retryCount: updated.retryCount });
      return json(res, 200, { ok: true, task: updated, message: status === 'published' ? '已记录发布结果' : '已记录失败，可人工重试' });
    }
    if (req.method === 'GET' && url.pathname === '/api/outreach/public-submissions') {
      const submissions = await readPublicSubmissions(client);
      return json(res, 200, {
        ok: true,
        stats: {
          total: submissions.length,
          pending: submissions.filter((item) => item.status === submissionStatusPending).length,
          approved: submissions.filter((item) => item.status === submissionStatusApproved).length,
          returned: submissions.filter((item) => item.status === submissionStatusReturned).length,
        },
        submissions: submissions.slice(0, 60).map((item) => ({
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
      const review = { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() };
      const result = await writeSubmissionReview(client, submissionId, review);
      if (!result) return json(res, 404, { ok: false, message: '投稿不存在' });
      await recordAudit(req, session, `outreach.public-submission.${decision}`, submissionId, 'success', { noteLength: note.length });
      return json(res, 200, { ok: true, submission: { id: submissionId, status: statusFromReviewDecision(decision), review }, message: decision === 'approve' ? '投稿审核通过' : '投稿已退回修改' });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/interests') {
      const interests = await readWarmthInterests(client);
      return json(res, 200, {
        ok: true,
        source: `seatable:${communityEnrollmentTable}`,
        stats: {
          total: interests.length,
          pending: interests.filter((item) => item.status === enrollmentStatusPending).length,
          accepted: interests.filter((item) => item.status === enrollmentStatusConfirmed).length,
          withdrawn: interests.filter((item) => item.status === enrollmentStatusWithdrawn).length,
        },
        interests: interests.map((item) => {
          const account = accountByBusinessRef(item.participantRef);
          return {
            id: item.id,
            program: item.program,
            frequency: item.frequency,
            nickname: item.nickname,
            realName: account?.realName || '',
            studentId: item.studentId,
            contactEmail: item.email,
            campus: item.campus,
            department: account?.department || '',
            grade: account?.grade || '',
            gender: account?.gender || '',
            memberCode: account?.memberCode || '',
            birthdayMonthDay: item.birthdayMonthDay,
            note: item.note,
            status: item.status,
            submittedAt: item.submittedAt,
            handledBy: item.handledBy || null,
            handledAt: item.handledAt || null,
          };
        }),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/warmth-reports') {
      const reports = await readWarmthReports(client);
      const countOf = (status) => reports.filter((item) => item.status === status).length;
      return json(res, 200, {
        ok: true,
        source: `seatable:${blessingReportTable}`,
        stats: { total: reports.length, pending: countOf(REPORT_STATUS_PENDING), handled: countOf(REPORT_STATUS_HANDLED), dismissed: countOf(REPORT_STATUS_DISMISSED) },
        reports: reports.slice(0, 60),
      });
    }
    const warmthReportDecision = url.pathname.match(/^\/api\/community\/warmth-reports\/([^/]+)\/(handle|dismiss)$/);
    if (warmthReportDecision && req.method === 'POST') {
      const reportId = decodeURIComponent(warmthReportDecision[1]);
      const action = warmthReportDecision[2];
      const body = await readJson(req);
      const note = optionalCleanText(body.note, '处理意见', 500, { allowNewlines: true });
      if (action === 'handle' && !note) return json(res, 400, { ok: false, message: '受理举报必须填写处理意见。' });
      const outcome = await withKeyedLock(`warmth-report:${reportId}`, async () => {
        const report = (await readWarmthReports(client)).find((item) => item.id === reportId);
        if (!report) return { code: 404, payload: { ok: false, message: '举报记录不存在' } };
        if (report.status !== REPORT_STATUS_PENDING) return { code: 409, payload: { ok: false, message: '该举报已经处理过。' } };
        const status = action === 'handle' ? REPORT_STATUS_HANDLED : REPORT_STATUS_DISMISSED;
        const rows = await stateRows(client, blessingReportTable);
        const row = rows.find((item) => String(item['举报ID'] || '') === reportId);
        await client.updateRow(blessingReportTable, row._id, { 状态: status, 处理人: session.username, 处理意见: note, 处理时间: new Date().toISOString() });
        if (action === 'handle') {
          const entry = (await stateRows(client, blessingLibraryTable)).find((item) => String(item['投稿ID'] || '') === report.submissionId);
          if (entry) await client.updateRow(blessingLibraryTable, entry._id, { 状态: LIBRARY_STATUS_WITHDRAWN });
        }
        await recordAudit(req, session, `community.warmth.report.${action}`, reportId, 'success', { submissionId: report.submissionId });
        return { code: 200, payload: { ok: true, report: { id: reportId, status }, message: action === 'handle' ? '举报成立，该祝福已从祝福库撤下。' : '举报已驳回。' } };
      });
      return json(res, outcome.code, outcome.payload);
    }
    if (req.method === 'POST' && url.pathname === '/api/community/blessing-delivery/run') {
      const body = await readJson(req);
      const onlyDay = body?.day ? cleanText(body.day, '日期', 5) : null;
      if (onlyDay && !isValidBirthdayMonthDay(onlyDay)) return json(res, 400, { ok: false, message: '日期格式应为 MM-DD。' });
      const summary = await runWarmthBirthdayDelivery(client, { onlyDay });
      await recordAudit(req, session, 'community.blessing.delivery.run', onlyDay || 'today', 'success', { delivered: summary.delivered });
      return json(res, 200, { ok: true, summary });
    }
    const interestDecision = url.pathname.match(/^\/api\/community\/interests\/([^/]+)\/(confirm|withdraw)$/);
    if (interestDecision && req.method === 'POST') {
      const interestId = decodeURIComponent(interestDecision[1]);
      const action = interestDecision[2];
      const outcome = await withKeyedLock(`warmth-enrollment:${interestId}`, async () => {
        const rows = await readEnrollmentRows(client);
        const row = rows.find((item) => String(item['登记ID'] || '') === interestId);
        if (!row) return { code: 404, payload: { ok: false, message: '参加登记不存在' } };
        const status = action === 'confirm' ? enrollmentStatusConfirmed : enrollmentStatusWithdrawn;
        await updateEnrollment(client, interestId, { 状态: status, 处理人: session.username, 处理时间: new Date().toISOString() });
        await cascadeWarmthTargetStatus(client, String(row['参与者标识'] || ''), action === 'confirm');
        await recordAudit(req, session, `community.interest.${action}`, interestId, 'success', { program: row['项目'] || '' });
        return { code: 200, payload: { ok: true, interest: { id: interestId, status }, message: action === 'confirm' ? '已确认参加，内容仍需人工审核后才会转达。' : '已登记退出，不再进入任何匹配或发送队列。' } };
      });
      return json(res, outcome.code, outcome.payload);
    }
    if (req.method === 'GET' && url.pathname === '/api/notifications/overview') {
      return json(res, 200, await getNotificationsOverview(client, normalizePermissions(accountsByUsername.get(session.username)?.permissions, session.role)));
    }
    if (req.method === 'GET' && url.pathname === '/api/community/overview') {
      const consents = await readCommunityConsents(client);
      const candidates = await readConfirmedWarmthCandidates(client);
      const current = Object.values(consents).filter((item) => item.actor === session.username && item.enabled);
      return json(res, 200, { ok: true, mode: 'admin-pilot', source: `seatable:${communityEnrollmentTable}`, writesToSeaTable: true, stats: { active: candidates.length, currentUserActive: current.length }, programs: ['birthday', 'morning'], current: current.map(({ program, frequency, contentMode, updatedAt }) => ({ program, frequency, contentMode, updatedAt })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/matching-preview') {
      const eligible = await readConfirmedWarmthCandidates(client);
      const byProgram = ['birthday', 'morning'].map((program) => ({ program, eligible: eligible.filter((item) => item.program === program).length, weekly: eligible.filter((item) => item.program === program && item.frequency === 'weekly').length }));
      return json(res, 200, { ok: true, mode: 'preview-only', generatedAt: new Date().toISOString(), candidateCount: eligible.length, byProgram, pairs: [], requiresManualApproval: true, message: '当前仅生成候选统计，不创建匹配关系、不发送消息。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/submissions') {
      const submissions = await readCommunitySubmissions(client);
      return json(res, 200, { ok: true, source: `seatable:${communitySubmissionTable}`, stats: { total: submissions.length, pending: submissions.filter((item) => item.status === submissionStatusPending).length, waiting: submissions.filter((item) => item.status === submissionStatusWaiting).length, approved: submissions.filter((item) => item.status === submissionStatusApproved).length, returned: submissions.filter((item) => item.status === submissionStatusReturned).length, rejected: submissions.filter((item) => item.status === submissionStatusRejected).length }, submissions: submissions.slice(0, 30).map(({ id, program, content, tone, status, submittedAt, actor, nickname, delivery, targetStudentId, deliveryState, review }) => ({ id, program, content, tone, status, submittedAt, actor: maskedApplicant(actor), nickname, delivery, targetStudentId, deliveryState, review: review || null })) });
    }
    if (req.method === 'POST' && url.pathname === '/api/community/submissions') {
      const body = await readJson(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该投稿项目' });
      const consents = await readCommunityConsents(client);
      if (!consents[`${session.username}:${program}`]?.enabled) return json(res, 403, { ok: false, message: '请先加入该项目并确认同意规则' });
      const content = requiredText(body.content, '投稿内容', 1000);
      const tone = String(body.tone || '温暖').trim();
      const submission = { id: eventIdentifier('CARE'), program, content, tone, actor: session.username, status: submissionStatusPending, submittedAt: new Date().toISOString(), consentVersion: 'v1' };
      await client.appendRow(communitySubmissionTable, {
        投稿ID: submission.id,
        项目: submission.program,
        内容: submission.content,
        语气: submission.tone,
        提交人: submission.actor,
        状态: submission.status,
        审核意见: '',
        审核人: '',
        提交时间: submission.submittedAt,
        审核时间: '',
        同意版本: submission.consentVersion,
      });
      await recordAudit(req, session, 'community.submission.create', submission.id, 'success', { program, contentLength: content.length });
      return json(res, 201, { ok: true, submission: { id: submission.id, program, status: submission.status, submittedAt: submission.submittedAt }, message: '投稿已进入人工审核队列' });
    }
    const communitySubmissionReview = url.pathname.match(/^\/api\/community\/submissions\/([^/]+)\/review$/);
    if (communitySubmissionReview && req.method === 'POST') {
      const submissionId = decodeURIComponent(communitySubmissionReview[1]);
      const body = await readJson(req);
      const decision = cleanText(body.decision, '审核结果', 20);
      if (!['approve', 'return', 'reject', 'reopen'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve、return、reject 或 reopen' });
      const note = decision === 'reopen' ? '' : optionalCleanText(body.note, '审核意见', 500, { allowNewlines: true });
      if (decision !== 'approve' && decision !== 'reopen' && !note) return json(res, 400, { ok: false, message: decision === 'reject' ? '直接拒绝必须填写理由' : '退回投稿必须填写审核意见' });
      const outcome = await withKeyedLock(`warmth-blessing:${submissionId}`, async () => {
        const rows = await stateRows(client, communitySubmissionTable);
        const row = rows.find((item) => String(item['投稿ID'] || '') === submissionId);
        if (!row) return { code: 404, payload: { ok: false, message: '投稿不存在' } };
        const currentStatus = String(row['状态'] || submissionStatusPending);
        if (decision === 'reopen') {
          if (currentStatus !== submissionStatusRejected) return { code: 409, payload: { ok: false, message: '只有「已拒绝」的投稿可以撤销拒绝并重新审核。' } };
          await client.updateRow(communitySubmissionTable, row._id, { 状态: submissionStatusPending, 审核意见: '', 审核人: '', 审核时间: '' });
          await recordAudit(req, session, 'community.submission.reopen', submissionId, 'success', {});
          return { code: 200, payload: { ok: true, submission: { id: submissionId, status: submissionStatusPending, review: null }, message: '已撤销拒绝，投稿重新进入待审核。' } };
        }
        if (currentStatus !== submissionStatusPending) return { code: 409, payload: { ok: false, message: '只有「待审核」的投稿可以审核；如需重审已拒绝投稿，请先撤销拒绝。' } };
        const review = { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() };
        const nextStatus = decision === 'approve' ? submissionStatusApproved : decision === 'reject' ? submissionStatusRejected : submissionStatusReturned;
        await client.updateRow(communitySubmissionTable, row._id, { 状态: nextStatus, 审核意见: note, 审核人: review.reviewer, 审核时间: review.reviewedAt });
        if (decision === 'approve') await ingestApprovedBlessing(client, row, session.username, review.reviewedAt);
        await recordAudit(req, session, `community.submission.${decision}`, submissionId, 'success', { noteLength: note.length });
        const decisionMessage = decision === 'approve' ? '投稿审核通过' : decision === 'reject' ? '投稿已直接拒绝' : '投稿已退回修改';
        return { code: 200, payload: { ok: true, submission: { id: submissionId, status: nextStatus, review }, message: decisionMessage } };
      });
      return json(res, outcome.code, outcome.payload);
    }
    if (req.method === 'POST' && url.pathname === '/api/community/consent') {
      const body = await readJson(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目' });
      const frequency = String(body.frequency || '').trim();
      if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率' });
      if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出和人工审核规则' });
      const contentMode = String(body.contentMode || 'reviewed').trim();
      const key = `${session.username}:${program}`;
      await saveEnrollment(client, key, {
        来源: consoleEnrollmentSource,
        项目: program,
        频率: frequency,
        昵称: session.username,
        参与者标识: session.username,
        邮箱: '',
        校区: '',
        生日月日: '',
        备注: '',
        内容模式: contentMode,
        状态: enrollmentStatusConfirmed,
        同意版本: 'v1',
        提交时间: new Date().toISOString(),
        处理人: session.username,
        处理时间: '',
      });
      await recordAudit(req, session, 'community.consent.enable', key, 'success', { program, frequency });
      return json(res, 200, { ok: true, consent: { program, frequency, contentMode, enabled: true }, message: '已记录自愿参加意愿；真实发送仍需人工审核' });
    }
    const communityWithdraw = url.pathname.match(/^\/api\/community\/consent\/([^/]+)\/withdraw$/);
    if (communityWithdraw && req.method === 'POST') {
      const program = decodeURIComponent(communityWithdraw[1]);
      const key = `${session.username}:${program}`;
      const withdrawnAt = new Date().toISOString();
      const consents = await readCommunityConsents(client);
      if (consents[key]) {
        await updateEnrollment(client, key, { 状态: enrollmentStatusWithdrawn, 处理人: session.username, 处理时间: withdrawnAt });
      }
      await recordAudit(req, session, 'community.consent.withdraw', key, 'success', { program });
      return json(res, 200, { ok: true, message: '已退出该项目，后续不会进入匹配和发送队列' });
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const metadata = await client.getMetadata();
      const allTables = metadata?.tables || [];
      const permissions = normalizePermissions(accountsByUsername.get(session.username)?.permissions, session.role);
      const metadataVisible = permissions.includes('data') || permissions.includes('settings');
      const tables = (metadataVisible ? allTables : []).map(({ _id, name, columns = [], views = [] }) => ({
        _id, name,
        columns: columns.map(({ key, name: columnName, type }) => ({ key, name: columnName, type })),
        views: views.map(({ _id: viewId, name: viewName }) => ({ _id: viewId, name: viewName })),
        dataAccess: genericDataAccess(name),
      }));
      return json(res, 200, { ok: true, server: serverUrl, configuredTable: configuredTable || null, tableCount: allTables.length, metadataVisible, tables, volunteerSourceConfigured: Boolean(volunteerBase) });
    }
    if (req.method === 'GET' && url.pathname === '/api/rows') {
      const table = tableFrom(url);
      const rows = await client.listRows(table, '', '', false, '', 100);
      return json(res, 200, { ok: true, table, rows });
    }
    if (url.pathname === '/api/rows' && req.method === 'POST') {
      const body = await readJson(req);
      const table = tableFrom(url, body);
      assertGenericWriteAllowed(table);
      if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
        const error = new Error('row must be a JSON object keyed by SeaTable column names'); error.statusCode = 400; throw error;
      }
      const result = await client.appendRow(table, body.row);
      await recordAudit(req, session, 'data.row.create', result?._id || 'new', 'success', { table });
      return json(res, 201, { ok: true, table, result });
    }
    const rowMatch = url.pathname.match(/^\/api\/rows\/([^/]+)$/);
    if (rowMatch && req.method === 'PUT') {
      const body = await readJson(req); const table = tableFrom(url, body);
      assertGenericWriteAllowed(table);
      const rowId = decodeURIComponent(rowMatch[1]);
      const result = await client.updateRow(table, rowId, body.row || {});
      await recordAudit(req, session, 'data.row.update', rowId, 'success', { table });
      return json(res, 200, { ok: true, table, result });
    }
    if (rowMatch && req.method === 'DELETE') {
      const table = tableFrom(url);
      assertGenericWriteAllowed(table);
      const rowId = decodeURIComponent(rowMatch[1]);
      const result = await client.deleteRow(table, rowId);
      await recordAudit(req, session, 'data.row.delete', rowId, 'success', { table });
      return json(res, 200, { ok: true, table, result });
    }
    return json(res, 404, { ok: false, message: 'Not found' });
  } catch (error) {
    const failure = apiFailure(error);
    return json(res, failure.status, failure.payload);
  }
}

const staticFile = createStaticHandler(publicDir);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        res.once('finish', () => {
          if (res.statusCode < 400) { publicReadCache.clear(); clearDisplayReads(); }
        });
      }
      const display = req.method === 'GET' && (
        /^\/api\/(?:materials|events|volunteer|outreach|notifications|community)\/overview$/.test(url.pathname)
        || ['/api/public/overview', '/api/public/events', '/api/public/workflow/events', '/api/volunteer/workflow', '/api/volunteer/workflow/sources', '/api/community/interests', '/api/community/submissions', '/api/community/matching-preview', '/api/outreach/public-submissions'].includes(url.pathname)
      );
      return await (display ? withDisplayReads(() => api(req, res, url)) : api(req, res, url));
    }
    return await staticFile(req, res, url);
  } catch {
    if (!res.headersSent) json(res, 500, { ok: false, message: 'Request could not be completed' });
    else res.destroy();
  }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Open http://localhost:${port} or set another PORT in .env.`);
  else console.error(error);
  process.exitCode = 1;
});
server.listen(port, () => {
  if(process.env.PLATFORM_WORKFLOW_MODE==='production'){
    let warming=false;
    const warm=async()=>{if(warming)return;warming=true;try{await withDisplayReads(async()=>getPublicEvents(await getBase()));}catch{console.warn('Activity snapshot refresh deferred');}finally{warming=false;}};
    const vacancyTimer=setInterval(()=>getWishlist().then(w=>w.deliver()).catch(()=>console.warn('Vacancy reminders deferred')),60_000);vacancyTimer.unref();
    const activityTimer=setInterval(warm,30_000);activityTimer.unref();void warm();
  }
  // 每天 08:00（Asia/Shanghai）扫描当天过生日的成员并投递指定祝福；低频检查，命中后当天只跑一次。
  const warmthDeliveryHour = Number(process.env.WARMTH_DELIVERY_HOUR || 8);
  if (String(process.env.WARMTH_DELIVERY_ENABLED || 'true').toLowerCase() !== 'false') {
    let lastDeliveryDay = '';
    const tick = async () => {
      try {
        const day = shanghaiMonthDay();
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date()));
        if (hour !== warmthDeliveryHour || lastDeliveryDay === day) return;
        lastDeliveryDay = day;
        const summary = await runWarmthBirthdayDelivery(await getBase());
        console.log(`[warmth] 生日祝福投递完成（${summary.day}）：收件人 ${summary.recipients}，投递 ${summary.delivered}，邮件 ${summary.mailed}`);
      } catch (error) {
        console.error('Warmth birthday delivery failed:', error.message);
      }
    };
    const timer = setInterval(tick, 5 * 60 * 1000);
    timer.unref();
    void tick();
    console.log(`Warmth birthday delivery: enabled, runs at ${String(warmthDeliveryHour).padStart(2, '0')}:00 Asia/Shanghai`);
  } else {
    console.log('Warmth birthday delivery: disabled by WARMTH_DELIVERY_ENABLED=false');
  }
  console.log(`NJU Red Cross platform running at http://localhost:${port}`);
  console.log(`SeaTable server: ${serverUrl}`);
  console.log(`Platform authentication: three roles (super_admin, platform_admin, member), session ${sessionTtlHours}h`);
  const mail = mailerStatus();
  console.log(mail.configured
    ? `Outbound mail: SMTP transport ready${mail.from ? ` (from ${mail.from})` : ''}`
    : (isProduction
      ? 'Outbound mail: SMTP not configured; public self-registration is disabled.'
      : 'Outbound mail: SMTP not configured; verification codes are logged to the console (development transport).'));
  if (String(process.env.MATERIALS_REMINDER_ENABLED || 'false').toLowerCase() === 'true' && smtpHost && smtpUser && smtpPassword) {
    const reminderTimer = setInterval(() => sendOverdueReminders().catch((error) => console.error('Overdue reminder failed:', error.message)), reminderIntervalMinutes * 60 * 1000);
    reminderTimer.unref();
    sendOverdueReminders().catch((error) => console.error('Overdue reminder failed:', error.message));
  } else {
    console.log('Overdue email reminder: disabled unless explicitly enabled and SMTP is configured.');
  }
});
