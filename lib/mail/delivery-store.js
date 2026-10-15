import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSameMailIntent } from './intent.js';

const transitions = {
  pending: new Set(['sending', 'cancelled']),
  sending: new Set(['sent', 'unknown']),
  unknown: new Set(['sent', 'cancelled']),
  sent: new Set(),
  cancelled: new Set(),
};

function conflict(message) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'mail_delivery_state_conflict',
  });
}

function validateIntent(intent) {
  if (
    !intent || typeof intent.key !== 'string' || !intent.key.trim()
    || intent.key.length > 200
    || !/^[a-f0-9]{64}$/.test(intent.fingerprint || '')
    || typeof intent.to !== 'string' || !intent.to.includes('@')
    || typeof intent.subject !== 'string' || typeof intent.kind !== 'string'
    || Object.keys(intent).some(key => ![
      'key', 'fingerprint', 'to', 'subject', 'kind',
    ].includes(key))
  ) throw conflict('邮件任务身份结构不正确，禁止保存或继续发送。');
}

export async function openMailDeliveryStore(file) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      PRAGMA busy_timeout = 1000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS mail_deliveries (
        operation_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        state TEXT NOT NULL,
        record_id TEXT NOT NULL UNIQUE,
        recorded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  function get(key) {
    const row = db.prepare('SELECT * FROM mail_deliveries WHERE operation_key = ?').get(key);
    if (!row) return null;
    const intent = JSON.parse(row.intent_json);
    validateIntent(intent);
    if (
      intent.key !== row.operation_key || intent.fingerprint !== row.fingerprint
      || !Object.hasOwn(transitions, row.state)
      || !/^MAIL-[a-f0-9-]{36}$/.test(row.record_id)
      || ![0, 1].includes(row.recorded)
      || (row.recorded === 1 && row.state !== 'sent')
    ) throw conflict('邮件任务记录校验失败，必须停止发送。');
    return {
      intent,
      state: row.state,
      recordId: row.record_id,
      recorded: row.recorded === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    get,
    create(intent) {
      validateIntent(intent);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO mail_deliveries
          (operation_key, fingerprint, intent_json, state, record_id, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?, ?)
        ON CONFLICT(operation_key) DO NOTHING
      `).run(intent.key, intent.fingerprint, JSON.stringify(intent), `MAIL-${randomUUID()}`, now, now);
      const stored = get(intent.key);
      assertSameMailIntent(stored.intent, intent);
      // Metadata is immutable as well as the keyed content digest.
      if (JSON.stringify(stored.intent) !== JSON.stringify(intent)) {
        throw conflict('已有邮件任务的身份信息不能修改。');
      }
      return stored;
    },
    transition(key, expected, next) {
      if (!Object.hasOwn(transitions, expected) || !transitions[expected].has(next)) {
        throw conflict('不允许的邮件状态变化。');
      }
      const stored = get(key);
      if (!stored || stored.state !== expected) {
        throw conflict('邮件任务阶段已变化或不存在，不能继续执行。');
      }
      const result = db.prepare(`
        UPDATE mail_deliveries SET state = ?, updated_at = ?
        WHERE operation_key = ? AND state = ?
      `).run(next, new Date().toISOString(), key, expected);
      if (result.changes !== 1) throw conflict('邮件任务已被另一执行者处理。');
      return get(key);
    },
    markRecorded(key) {
      const stored = get(key);
      if (!stored || stored.state !== 'sent') {
        throw conflict('只有已发送邮件能确认远程留痕。');
      }
      db.prepare(`
        UPDATE mail_deliveries SET recorded = 1, updated_at = ?
        WHERE operation_key = ? AND state = 'sent'
      `).run(new Date().toISOString(), key);
      return get(key);
    },
    unrecordedSent({ limit = 100 } = {}) {
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) {
        throw new TypeError('留痕任务读取上限必须为1至1000的整数。');
      }
      return db.prepare(`
        SELECT operation_key FROM mail_deliveries
        WHERE state = 'sent' AND recorded = 0
        ORDER BY created_at, operation_key LIMIT ?
      `).all(limit).map(row => get(row.operation_key));
    },
    close() { db.close(); },
  };
}
