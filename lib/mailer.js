/**
 * 通用发信服务（支撑线 D · 一次建成，三处受益：验证码 / 消息订阅 / 提醒）。
 *
 * 两种通道：
 *   · SMTP —— 配齐 SMTP_HOST/USER/PASSWORD 后启用
 *   · console —— 开发兜底：把信件全文打到服务端日志（生产环境禁用）
 *
 * 纪律：
 *   · 幂等：相同 幂等键 已成功发送过的信不再发第二封（查 邮件发件记录表）
 *   · 留痕：每封发件（含失败）都写 邮件发件记录表
 *   · 发信失败绝不抛出到调用方 —— 返回 { ok:false, reason } 由路由决定语义
 *   · 邮件发件记录表 属新建表；表未建好时静默跳过留痕，不影响发信本身
 */

import nodemailer from 'nodemailer';
import { randomBytes } from 'node:crypto';

export const MAIL_TABLE = '邮件发件记录表';
export const MAIL_COLUMNS = [
  '记录ID', '收件人', '主题', '类型', '状态', '幂等键', '通道', '错误', '发送时间',
];

let config = { configured: false, transport: 'none', from: null, isProduction: false };
let transporter = null;
let getClient = null;

export function configureMailer(options = {}) {
  const smtpReady = Boolean(options.smtpHost && options.smtpUser && options.smtpPassword);
  config = {
    configured: smtpReady,
    transport: smtpReady ? 'smtp' : (options.isProduction ? 'none' : 'console'),
    from: options.from || options.smtpUser || null,
    smtpUser: options.smtpUser || null,
    isProduction: Boolean(options.isProduction),
  };
  transporter = smtpReady
    ? nodemailer.createTransport({ host: options.smtpHost, port: options.smtpPort || 587, secure: Boolean(options.smtpSecure), connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, auth: { user: options.smtpUser, pass: options.smtpPassword } })
    : null;
  getClient = typeof options.getClient === 'function' ? options.getClient : null;
}

export function mailerStatus() {
  return { configured: config.configured, transport: config.transport, from: config.from };
}

function recordId() {
  return `MAIL-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** 分页读取全部发件记录，避免 200 行上限导致幂等漏判。表缺失/读失败时视为未发送（宁可重发，不可漏发验证码）。 */
async function listMailRows(client) {
  const all = [];
  for (let start = 0; start < 50000; start += 500) {
    const chunk = await client.listRows(MAIL_TABLE, '', '', false, start, 500);
    all.push(...chunk);
    if (chunk.length < 500) break;
  }
  return all;
}

/**
 * 找出该幂等键最早的一条「已发送 / 发送中」记录（失败记录不阻拦重试）。
 * 无幂等键或表不可用时返回 null（视为未发送）。
 */
async function firstHandledMail(client, idempotencyKey) {
  if (!idempotencyKey || !client) return null;
  try {
    const rows = await listMailRows(client);
    const matched = rows
      .filter((row) => String(row['幂等键'] || '') === idempotencyKey && ['已发送', '发送中'].includes(String(row['状态'] || '')))
      .sort((a, b) => String(a['发送时间'] || '').localeCompare(String(b['发送时间'] || '')));
    return matched[0] || null;
  } catch {
    return null;
  }
}

async function recordDelivery(client, { to, subject, kind, status, idempotencyKey, transport, error }) {
  if (!client) return;
  try {
    await client.appendRow(MAIL_TABLE, {
      记录ID: recordId(),
      收件人: to,
      主题: String(subject || '').slice(0, 120),
      类型: kind || 'generic',
      状态: status,
      幂等键: idempotencyKey || '',
      通道: transport,
      错误: error || '',
      发送时间: new Date().toISOString(),
    });
  } catch {
    // 留痕是旁路：绝不因记录失败让发信本身报错。
  }
}

/**
 * 发送一封邮件。
 * @param {{to:string, subject:string, text:string, kind?:string, idempotencyKey?:string}} message
 * @returns {Promise<{ok:boolean, transport:string, skipped?:boolean, reason?:string, devCodeChannel?:boolean}>}
 */
export async function sendMail(message = {}) {
  const { to, subject, text, kind = 'generic', idempotencyKey = '' } = message;
  if (!to || !String(to).includes('@')) return { ok: false, transport: config.transport, skipped: true, reason: 'missing or invalid recipient' };

  let client = null;
  if (getClient) {
    try { client = await getClient(); } catch { client = null; }
  }

  // 幂等占位（claim）：先落一条「发送中」，再确认自己是最早的占位。
  // SeaTable 没有唯一约束，用「先写占位、后发送」把并发重复窗口压到最小；失败记录不阻拦重试。
  let claimRowId = null;
  const claimRecordId = recordId();
  if (client && idempotencyKey) {
    if (await firstHandledMail(client, idempotencyKey)) {
      return { ok: true, transport: 'idempotent-skip', skipped: true };
    }
    try {
      const appended = await client.appendRow(MAIL_TABLE, {
        记录ID: claimRecordId,
        收件人: to,
        主题: String(subject || '').slice(0, 120),
        类型: kind,
        状态: '发送中',
        幂等键: idempotencyKey,
        通道: config.transport,
        错误: '',
        发送时间: new Date().toISOString(),
      });
      claimRowId = appended?._id || appended?.data?._id || null;
      const earliest = await firstHandledMail(client, idempotencyKey);
      if (earliest && String(earliest['记录ID'] || '') !== claimRecordId) {
        return { ok: true, transport: 'idempotent-skip', skipped: true };
      }
    } catch { claimRowId = null; }
  }

  const finish = async (status, channel, error) => {
    if (client && claimRowId) {
      try {
        await client.updateRow(MAIL_TABLE, claimRowId, { 状态: status, 通道: channel, 错误: error || '' });
        return;
      } catch { /* 更新占位失败时退回追加留痕 */ }
    }
    await recordDelivery(client, { to, subject, kind, status, idempotencyKey, transport: channel, error });
  };

  if (transporter) {
    let error = '';
    try {
      await transporter.sendMail({ from: config.from || config.smtpUser, to, subject, text });
    } catch (sendError) {
      error = sendError?.message || String(sendError);
    }
    await finish(error ? '失败' : '已发送', 'smtp', error);
    return error
      ? { ok: false, transport: 'smtp', reason: error }
      : { ok: true, transport: 'smtp' };
  }

  if (!config.isProduction) {
    // 开发兜底通道：验证码等关键内容打到服务端日志，冒烟脚本可读 devCode。
    console.log(`\n[mailer:console] -> ${to} (${kind})\n  主题: ${subject}\n  正文:\n${String(text).split('\n').map((line) => `  | ${line}`).join('\n')}\n`);
    await finish('已发送', 'console', '');
    return { ok: true, transport: 'console', devCodeChannel: true };
  }

  // 生产且未配置 SMTP：把占位标为未发送，避免长期挂在「发送中」
  await finish('未发送', 'none', 'mailer is not configured');
  return { ok: false, transport: 'none', skipped: true, reason: 'mailer is not configured and production forbids the console transport' };
}
