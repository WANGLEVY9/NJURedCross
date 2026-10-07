/** SMTP delivery uses durable local state; remote records can be repaired separately. */
import { sendSmtpMail } from './http/smtp-request.js';
import { randomBytes } from 'node:crypto';
import { assertRequestActive } from './http/request-budget.js';
import { hasDeliveredMail } from './mail/delivery-history.js';
import {
  createMailIntent,
  assertSameMailIntent,
} from './mail/intent.js';
import { sealMailPayload } from './mail/payload.js';
import { runMailRetryBatch } from './mail/retry-worker.js';
import { deliverMailOnce } from './mail/delivery.js';

export const MAIL_TABLE = '邮件发件记录表';
export const MAIL_COLUMNS = [
  '记录ID', '收件人', '主题', '类型', '状态', '幂等键', '通道', '错误', '发送时间',
];

let config = { configured: false, transport: 'none', from: null, isProduction: false };
let transporter = null;
let getClient = null;
let deliveryStore = null;
let deliverySecret = null;
let retryStore = null;
let retryNow = Date.now;
let smtpSend = sendSmtpMail;

export function configureMailer(options = {}) {
  deliveryStore = options.deliveryStore || null;
  deliverySecret = options.deliverySecret || null;
  retryStore = options.retryStore || null;
  retryNow = typeof options.now === 'function' ? options.now : Date.now;
  smtpSend = typeof options.smtpSend === 'function' ? options.smtpSend : sendSmtpMail;
  const smtpReady = Boolean(options.smtpHost && options.smtpUser && options.smtpPassword);
  config = {
    configured: smtpReady,
    transport: smtpReady ? 'smtp' : (options.isProduction ? 'none' : 'console'),
    from: options.from || options.smtpUser || null,
    smtpUser: options.smtpUser || null,
    isProduction: Boolean(options.isProduction),
  };
  transporter = smtpReady ? {
    host: options.smtpHost,
    port: options.smtpPort || 587,
    secure: Boolean(options.smtpSecure),
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    auth: { user: options.smtpUser, pass: options.smtpPassword },
  } : null;
  getClient = typeof options.getClient === 'function' ? options.getClient : null;
}

export function mailerStatus() {
  return { configured: config.configured, transport: config.transport, from: config.from };
}

function recordId() {
  return `MAIL-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function recordDelivery(client, {
  to, subject, kind, status, idempotencyKey, transport,
  error = '', id = recordId(), sentAt = new Date().toISOString(),
}, { strict = false } = {}) {
  try {
    if (!client) throw new Error('Missing delivery record client');
    await client.appendRow(MAIL_TABLE, {
      记录ID: id,
      收件人: to,
      主题: String(subject || '').slice(0, 120),
      类型: kind || 'generic',
      状态: status,
      幂等键: idempotencyKey || '',
      通道: transport,
      错误: error,
      发送时间: sentAt,
    });
  } catch {
    if (strict) throw new Error('邮件远程留痕暂不可确认。');
  }
}

function recordAccess(factory) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(() => {
      if (!factory) throw new Error('Missing record connection');
      return factory();
    }).then(client => {
      if (!client || typeof client.listRows !== 'function') throw new Error('Invalid record connection');
      return client;
    });
    return pending;
  };
}

async function recordSent(entry, access) {
  const client = await access();
  // A previous append may have succeeded despite a lost response.
  // Positive history avoids another append, and never triggers SMTP.
  if (await hasDeliveredMail(client, entry.intent.key, {
    transport: 'smtp', expectedIntent: entry.intent,
  })) return;
  await recordDelivery(client, {
    to: entry.intent.to, subject: entry.intent.subject,
    kind: entry.intent.kind, status: '已发送',
    idempotencyKey: entry.intent.key, transport: 'smtp',
    id: entry.recordId, sentAt: entry.updatedAt,
  }, { strict: true });
}

export async function sendMail(message = {}) {
  const { to, subject, text, kind = 'generic', idempotencyKey = '' } = message;
  if (!to || !String(to).includes('@')) {
    return { ok: false, transport: config.transport, skipped: true, reason: 'missing or invalid recipient' };
  }

  if (transporter) {
    if (!deliveryStore || !deliverySecret) {
      return { ok: false, transport: 'smtp', code: 'mail_delivery_store_unavailable', reason: '邮件状态库未配置，本次未发送。' };
    }
    let intent;
    try { intent = createMailIntent(message, { secret: deliverySecret }); }
    catch { return { ok: false, transport: 'smtp', code: 'invalid_mail_intent', reason: '邮件任务格式不正确，本次未发送。' }; }
    if (intent.kind === 'security' && retryStore) {
      try {
        const timestamp = retryNow();
        let job = retryStore.get(intent.key);

        if (job) {
          assertSameMailIntent(job.intent, intent);
        } else {
          job = retryStore.enqueue({
            intent,
            envelope: sealMailPayload(message, {
              secret: deliverySecret,
            }),
            expiresAt: timestamp + 24 * 60 * 60_000,
            nextAttemptAt: timestamp + 60_000,
          });
        }
        if (job.status === 'completed') {
          return {
            ok: true,
            skipped: true,
            transport: 'idempotent-skip',
          };
        }

        if (
          job.status === 'stopped'
          || job.expiresAt <= timestamp
        ) {
          return {
            ok: false,
            transport: 'smtp',
            code: 'mail_retry_stopped',
            reason: '邮件任务已停止或过期，需要人工处理。',
          };
        }
      } catch {
        return {
          ok: false,
          transport: 'smtp',
          code: 'mail_retry_store_unavailable',
          reason: '邮件重试任务无法安全保存，本次未发送。',
        };
      }
    }
    const store = deliveryStore;
    const options = transporter;
    const from = config.from || config.smtpUser;
    const send = smtpSend;
    const access = recordAccess(getClient);
    const result = await deliverMailOnce({
      store, intent,
      checkHistory: async value => hasDeliveredMail(await access(), value.key, {
        transport: 'smtp', expectedIntent: value,
      }),
      deliver: () => send(options, { from, to: intent.to, subject, text }),
      recordDelivery: entry => recordSent(entry, access),
    });
    return { ...result, transport: result.skipped ? 'idempotent-skip' : 'smtp' };
  }

  let client = null;
  try {
    assertRequestActive();
    if (getClient) client = await getClient();
    if (idempotencyKey && await hasDeliveredMail(client, idempotencyKey)) {
      return {
        ok: true, transport: 'idempotent-skip', skipped: true,
        ...(config.transport === 'console' ? { devCodeChannel: true } : {}),
      };
    }
  } catch {
    return { ok: false, transport: config.transport, code: 'mail_history_unavailable', reason: '邮件发送记录暂不可确认，本次未发送。' };
  }

  if (!config.isProduction) {
    console.log(`\n[mailer:console] -> ${to} (${kind})\n  主题: ${subject}\n  正文:\n${String(text).split('\n').map(line => `  | ${line}`).join('\n')}\n`);
    await recordDelivery(client, { to, subject, kind, status: '开发输出', idempotencyKey, transport: 'console' });
    return { ok: true, transport: 'console', devCodeChannel: true };
  }
  return { ok: false, transport: 'none', skipped: true, reason: 'mailer is not configured and production forbids the console transport' };
}

/** Repairs audit records only. This function cannot deliver SMTP messages. */
export async function repairMailRecords({ limit = 100 } = {}) {
  assertRequestActive();
  if (!deliveryStore) return { selected: 0, repaired: 0, pending: 0 };
  const entries = deliveryStore.unrecordedSent({ limit });
  const access = recordAccess(getClient);
  let repaired = 0;
  for (const entry of entries) {
    assertRequestActive();
    try {
      await recordSent(entry, access);
      deliveryStore.markRecorded(entry.intent.key);
      repaired++;
    } catch { /* Keep the durable job for a later record-only repair. */ }
  }
  return { selected: entries.length, repaired, pending: entries.length - repaired };
}
/** Retries queued security notifications using durable delivery state. */
export async function retryQueuedMail({ limit = 5 } = {}) {
  assertRequestActive();

  if (
    !transporter
    || !retryStore
    || !deliveryStore
    || !deliverySecret
  ) {
    return {
      selected: 0,
      completed: 0,
      rescheduled: 0,
      stopped: 0,
    };
  }

  return runMailRetryBatch({
    store: retryStore,
    getDelivery: key => deliveryStore.get(key),
    deliver: message => sendMail(message),
    secret: deliverySecret,
    now: retryNow,
    limit,
  });
}