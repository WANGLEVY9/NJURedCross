/**
 * 身份与信任路由（主线 A）：自助注册 → 邮箱验证码 → 验证即登录。
 *
 * 挂载在 /api/auth/* 之前（server.js 先调本模块，return false 才落回
 * 原有 authApi 的 login/logout/session）。
 *
 * 本模块独占的路径：
 *   POST /api/auth/register      注册（强绑定 smail/nju 邮箱）并签发验证码
 *   POST /api/auth/email-codes   重发验证码（60 秒冷却 / 每小时 5 次）
 *   POST /api/auth/verify-email  验证邮箱 → 发身份码 → 建立会话
 *   GET  /api/auth/account       当前账号档案（需登录，绝不返回密码哈希）
 *
 * 安全要点：
 *   · 验证码只存哈希 sha256(邮箱:码:验证码ID)，6 位数字、10 分钟有效、
 *     最多 5 次尝试、成功即消费（一次性）
 *   · 注册与发码各自限频（内存计数，按邮箱）
 *   · 邮箱验证通过后账号即注入运行时账号表（ctx.accounts 为活引用），
 *     后续 login/session 无需重启即可命中
 */

import { createHash, randomInt } from 'node:crypto';
import { ACCOUNT_TABLE, CODE_TABLE, createAccountRow, findAccountByLogin, generateMemberCode, hashPassword, updateAccountFields } from './store.js';

const CODE_TTL_SECONDS = 600;
const CODE_MAX_ATTEMPTS = 5;
const SEND_COOLDOWN_MS = 60 * 1000;
const SEND_HOURLY_LIMIT = 5;

/** email -> 时间戳数组（发码限频，进程内存即可）。 */
const sendHistory = new Map();

function pruneSendHistory(now) {
  if (sendHistory.size < 512) return;
  for (const [key, stamps] of sendHistory) {
    sendHistory.set(key, stamps.filter((t) => now - t < 3600_000));
    if (!sendHistory.get(key).length) sendHistory.delete(key);
  }
}

/** 返回 { allowed, retryAfter } 。冷却 60s + 每小时 5 次。 */
function checkSendLimit(email, now = Date.now()) {
  pruneSendHistory(now);
  const stamps = sendHistory.get(email) || [];
  if (stamps.length && now - stamps[stamps.length - 1] < SEND_COOLDOWN_MS) {
    return { allowed: false, retryAfter: Math.ceil((SEND_COOLDOWN_MS - (now - stamps[stamps.length - 1])) / 1000) };
  }
  const hourly = stamps.filter((t) => now - t < 3600_000);
  if (hourly.length >= SEND_HOURLY_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((3600_000 - (now - hourly[0])) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

function markSent(email, now = Date.now()) {
  const stamps = sendHistory.get(email) || [];
  stamps.push(now);
  sendHistory.set(email, stamps);
}

function codeHash(email, code, codeId) {
  return createHash('sha256').update(`${String(email)}:${String(code)}:${String(codeId)}`).digest('hex');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function emailAllowed(email, domains) {
  const domain = email.split('@')[1] || '';
  return (domains || []).some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}

export async function identityRoutes(req, res, url, ctx) {
  const pathname = url.pathname;
  if (req.method === 'POST' && pathname === '/api/auth/register') return register(req, res, ctx);
  if (req.method === 'POST' && pathname === '/api/auth/email-codes') return resendCode(req, res, ctx);
  if (req.method === 'POST' && pathname === '/api/auth/verify-email') return verifyEmail(req, res, ctx);
  if (req.method === 'GET' && pathname === '/api/auth/account') return accountProfile(req, res, ctx);
  return false;
}

/* -------------------------------------------------------------------------- *
 * 注册
 * -------------------------------------------------------------------------- */
async function register(req, res, ctx) {
  const body = await ctx.readJson(req);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = String(body.displayName || '').trim().slice(0, 40);
  const { minimumPasswordLength, smailDomains } = ctx.config;

  if (!email || !email.includes('@')) return ctx.json(res, 400, { ok: false, message: '请填写邮箱。' });
  if (!emailAllowed(email, smailDomains)) {
    return ctx.json(res, 400, { ok: false, message: `仅支持 ${smailDomains.join(' 或 ')} 邮箱注册，便于核验校内身份。` });
  }
  if (password.length < minimumPasswordLength) {
    return ctx.json(res, 400, { ok: false, message: `密码至少 ${minimumPasswordLength} 位。` });
  }
  if (password.length > 72) return ctx.json(res, 400, { ok: false, message: '密码过长（上限 72 位）。' });

  const client = await ctx.getBase();
  const existing = await findAccountByLogin(client, email);
  if (existing) return ctx.json(res, 409, { ok: false, message: '该邮箱已注册，请直接登录或找回密码。' });

  const created = await createAccountRow(client, {
    login: email,
    email,
    passwordHash: hashPassword(password),
    role: 'member',
    displayName: displayName || email.split('@')[0],
  });
  await ctx.recordAudit(req, { username: email, role: 'member' }, 'identity.register', created.accountId, 'success', { email });

  const delivery = await issueAndSendCode(client, ctx, { email, purpose: 'register', ip: ctx.clientIp(req) });
  if (delivery.rateLimited) {
    return ctx.json(res, 429, { ok: false, message: `发送太频繁，请 ${delivery.retryAfter} 秒后再试。` }, { 'Retry-After': String(delivery.retryAfter) });
  }

  return ctx.json(res, 201, {
    ok: true,
    email,
    message: '注册成功。验证码已发送到你的邮箱，10 分钟内有效。',
    expiresInSeconds: CODE_TTL_SECONDS,
    ...(delivery.devCode ? { devCode: delivery.devCode } : {}),
  });
}

/* -------------------------------------------------------------------------- *
 * 重发验证码
 * -------------------------------------------------------------------------- */
async function resendCode(req, res, ctx) {
  const body = await ctx.readJson(req);
  const email = normalizeEmail(body.email);
  const purpose = body.purpose === 'reset' ? 'reset' : 'register';
  if (!email || !email.includes('@')) return ctx.json(res, 400, { ok: false, message: '请填写邮箱。' });

  const client = await ctx.getBase();
  const account = await findAccountByLogin(client, email);
  if (!account) return ctx.json(res, 404, { ok: false, message: '该邮箱尚未注册。' });
  if (purpose === 'register' && account.emailVerified) {
    return ctx.json(res, 400, { ok: false, message: '该邮箱已完成验证，请直接登录。' });
  }

  const delivery = await issueAndSendCode(client, ctx, { email, purpose, ip: ctx.clientIp(req) });
  if (delivery.rateLimited) {
    return ctx.json(res, 429, { ok: false, message: `发送太频繁，请 ${delivery.retryAfter} 秒后再试。` }, { 'Retry-After': String(delivery.retryAfter) });
  }

  await ctx.recordAudit(req, { username: email, role: account.role }, 'identity.code.send', email, 'success', { purpose });
  return ctx.json(res, 200, {
    ok: true,
    message: '验证码已重新发送，10 分钟内有效。',
    expiresInSeconds: CODE_TTL_SECONDS,
    ...(delivery.devCode ? { devCode: delivery.devCode } : {}),
  });
}

/** 签发 + 发送一枚验证码。返回 { rateLimited, retryAfter?, devCode? }。 */
async function issueAndSendCode(client, ctx, { email, purpose, ip }) {
  const limit = checkSendLimit(email);
  if (!limit.allowed) return { rateLimited: true, retryAfter: limit.retryAfter };

  const codeId = ctx.identifier('VCD');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await client.appendRow(CODE_TABLE, {
    验证码ID: codeId,
    邮箱: email,
    用途: purpose,
    验证码哈希: codeHash(email, code, codeId),
    状态: '待使用',
    过期时间: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
    尝试次数: '0',
    创建时间: new Date().toISOString(),
    消费时间: '',
    IP: String(ip || ''),
  });

  const delivery = await ctx.sendMail({
    to: email,
    subject: '南京大学红十字会平台邮箱验证码',
    text: `你好！\n\n你的邮箱验证码是：${code}\n\n10 分钟内有效。若非本人操作，请忽略本邮件。\n\n南京大学红十字会平台`,
    kind: 'verification',
    idempotencyKey: `VCD:${codeId}`,
  });
  markSent(email);

  // SMTP 未配置且非生产环境时走 console 通道：把码回给调用方，便于本地联调与冒烟。
  const devCode = delivery.devCodeChannel ? code : undefined;
  if (!delivery.ok && !devCode) {
    return { rateLimited: false, devCode: undefined, delivery };
  }
  return { rateLimited: false, devCode };
}

/* -------------------------------------------------------------------------- *
 * 验证邮箱：验码 → 发身份码 → 建立会话
 * -------------------------------------------------------------------------- */
async function verifyEmail(req, res, ctx) {
  const body = await ctx.readJson(req);
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return ctx.json(res, 400, { ok: false, message: '请填写邮箱与 6 位验证码。' });

  const client = await ctx.getBase();
  const rows = await client.listRows(CODE_TABLE, '', '', false, '', 500);
  const candidates = rows
    .filter((row) => String(row['邮箱'] || '').trim().toLowerCase() === email && String(row['用途'] || '') === 'register' && String(row['状态'] || '') === '待使用')
    .sort((a, b) => String(b['创建时间'] || '').localeCompare(String(a['创建时间'] || '')));
  const target = candidates[0];
  if (!target) return ctx.json(res, 400, { ok: false, message: '没有待使用的验证码，请先获取。' });

  const now = Date.now();
  if (new Date(String(target['过期时间'] || '')).getTime() < now) {
    await client.updateRow(CODE_TABLE, target._id, { 状态: '已过期' });
    return ctx.json(res, 400, { ok: false, message: '验证码已过期，请重新获取。' });
  }

  const attempts = Number(target['尝试次数'] || 0);
  if (attempts >= CODE_MAX_ATTEMPTS) {
    await client.updateRow(CODE_TABLE, target._id, { 状态: '已失效' });
    return ctx.json(res, 429, { ok: false, message: '尝试次数过多，验证码已失效，请重新获取。' });
  }

  if (codeHash(email, code, target['验证码ID']) !== String(target['验证码哈希'] || '')) {
    const nextAttempts = attempts + 1;
    const patch = { 尝试次数: String(nextAttempts) };
    if (nextAttempts >= CODE_MAX_ATTEMPTS) patch['状态'] = '已失效';
    await client.updateRow(CODE_TABLE, target._id, patch);
    await ctx.recordAudit(req, { username: email, role: 'member' }, 'identity.email.verify', email, 'rejected', { reason: 'invalid-code', attempts: nextAttempts });
    return ctx.json(res, 401, { ok: false, message: '验证码错误。' });
  }

  await client.updateRow(CODE_TABLE, target._id, { 状态: '已消费', 消费时间: new Date().toISOString() });

  const account = await findAccountByLogin(client, email);
  if (!account) return ctx.json(res, 400, { ok: false, message: '账号不存在，请重新注册。' });
  if (account.status && account.status !== '启用') return ctx.json(res, 403, { ok: false, message: '该账号已被停用，请联系管理员。' });

  const memberCode = account.memberCode || generateMemberCode();
  const nowIso = new Date().toISOString();
  await updateAccountFields(client, account.rowId, { 邮箱已验证: '已验证', 身份码: memberCode, 最近登录: nowIso });

  // 注入运行时账号表：ctx.accounts 是 server.js 里 accountsByUsername 的活引用，
  // 后续 login / session / sessionPayload 无需重启即可命中新注册账号。
  const runtimeAccount = {
    username: account.username,
    email: account.email,
    passwordHash: account.passwordHash,
    role: account.role,
    label: account.label,
    memberCode,
  };
  ctx.accounts.set(account.username, runtimeAccount);

  await ctx.recordAudit(req, { username: account.username, role: account.role }, 'identity.email.verify', account.username, 'success', { memberCode });

  const token = ctx.makeSession(runtimeAccount);
  const session = ctx.getSession({ headers: { cookie: `nju_redcross_session=${token}` } });
  return ctx.json(res, 200, {
    ...ctx.sessionPayload(session),
    memberCode,
    message: '邮箱验证成功，已完成登录。',
  }, { 'Set-Cookie': ctx.sessionCookie(token) });
}

/* -------------------------------------------------------------------------- *
 * 账号档案
 * -------------------------------------------------------------------------- */
async function accountProfile(req, res, ctx) {
  const session = ctx.requireSession(req, res);
  if (!session) return;

  let account = null;
  try {
    account = await findAccountByLogin(await ctx.getBase(), session.username);
  } catch {
    account = null;
  }
  if (!account) account = ctx.accounts.get(session.username) || null;
  if (!account) return ctx.json(res, 404, { ok: false, message: '账号档案不存在。' });

  return ctx.json(res, 200, {
    ok: true,
    account: {
      username: account.username,
      email: account.email || session.email || null,
      displayName: account.label || account.username,
      role: account.role,
      memberCode: account.memberCode || session.memberCode || null,
      emailVerified: account.emailVerified ?? (account['邮箱已验证'] === '已验证'),
      registeredAt: account.registeredAt || null,
      lastLoginAt: account.lastLoginAt || null,
    },
  });
}
