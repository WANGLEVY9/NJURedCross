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
    ? nodemailer.createTransport({ host: options.smtpHost, port: options.smtpPort || 587, secure: Boolean(options.smtpSecure), auth: { user: options.smtpUser, pass: options.smtpPassword } })
    : null;
  getClient = typeof options.getClient === 'function' ? options.getClient : null;
}

export function mailerStatus() {
  return { configured: config.configured, transport: config.transport, from: config.from };
}

function recordId() {
  return `MAIL-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** 查幂等键是否已成功发送过。表缺失/读失败时视为未发送（宁可重发，不可漏发验证码）。 */
async function alreadySent(client, idempotencyKey) {
  if (!idempotencyKey || !client) return false;
  try {
    const rows = await client.listRows(MAIL_TABLE, '', '', false, '', 200);
    return rows.some((row) => String(row['幂等键'] || '') === idempotencyKey && String(row['状态'] || '') === '已发送');
  } catch {
    return false;
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

  if (await alreadySent(client, idempotencyKey)) {
    return { ok: true, transport: 'idempotent-skip', skipped: true };
  }

  if (transporter) {
    let error = '';
    try {
      await transporter.sendMail({ from: config.from || config.smtpUser, to, subject, text });
    } catch (sendError) {
      error = sendError?.message || String(sendError);
    }
    await recordDelivery(client, { to, subject, kind, status: error ? '失败' : '已发送', idempotencyKey, transport: 'smtp', error });
    return error
      ? { ok: false, transport: 'smtp', reason: error }
      : { ok: true, transport: 'smtp' };
  }

  if (!config.isProduction) {
    // 开发兜底通道：验证码等关键内容打到服务端日志，冒烟脚本可读 devCode。
    console.log(`\n[mailer:console] -> ${to} (${kind})\n  主题: ${subject}\n  正文:\n${String(text).split('\n').map((line) => `  | ${line}`).join('\n')}\n`);
    await recordDelivery(client, { to, subject, kind, status: '已发送', idempotencyKey, transport: 'console', error: '' });
    return { ok: true, transport: 'console', devCodeChannel: true };
  }

  return { ok: false, transport: 'none', skipped: true, reason: 'mailer is not configured and production forbids the console transport' };
}
