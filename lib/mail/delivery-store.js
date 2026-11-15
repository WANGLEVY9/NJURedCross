import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSameMailIntent } from './intent.js';

const transitions = {
  pending: new Set(['sending', 'cancelled']),
  // 传输层确认「正文一个字都没发出去」时退回 pending 重试；这是唯一的回退边，
  // 只由 delivery.js 在能证明未送达时使用。
  sending: new Set(['sent', 'unknown', 'pending']),
  unknown: new Set(['sent', 'cancelled']),
  sent: new Set(),
  cancelled: new Set(),
};

/**
 * 发送阶段：''＝还没写出正文（DATA），'data'＝DATA 已写出、正在等服务器回执。
 * 只保留这两个值——重启恢复只需要区分「正文一定没发」和「正文可能已经发了」。
 */
const stages = new Set(['', 'data']);

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
        stage TEXT NOT NULL DEFAULT '',
        record_id TEXT NOT NULL UNIQUE,
        recorded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    // 2026-11-15 之前的库没有 stage 列，补上即可。旧行没有阶段信息，无从判断正文
    // 有没有交出去，一律按「可能已发出」处理——与升级前的行为一致，不会因为升级而重发。
    const columns = db.prepare('PRAGMA table_info(mail_deliveries)').all()
      .map(column => column.name);
    if (!columns.includes('stage')) {
      db.exec(`
        ALTER TABLE mail_deliveries ADD COLUMN stage TEXT NOT NULL DEFAULT '';
        UPDATE mail_deliveries SET stage = 'data' WHERE state = 'sending';
      `);
    }
  } catch (error) {
    db.close();
    throw error;
  }

  /**
   * 启动恢复：`sending` 是「已认领、未确认」。上次进程在发信途中退出时——
   * - 正文没写出：可以安全退回 pending 重发（不然这封信永远发不出去）；
   * - 正文已经写出：服务器可能已收下，只能记 unknown，等人工核对发送记录。
   *
   * 这里假定本进程是状态库的唯一写者（server.js 只在启动时打开一次）。
   */
  const recovered = { pending: 0, unknown: 0 };
  try {
    const now = new Date().toISOString();
    recovered.pending = db.prepare(`
      UPDATE mail_deliveries SET state = 'pending', stage = '', updated_at = ?
      WHERE state = 'sending' AND stage <> 'data'
    `).run(now).changes;
    recovered.unknown = db.prepare(`
      UPDATE mail_deliveries SET state = 'unknown', updated_at = ?
      WHERE state = 'sending' AND stage = 'data'
    `).run(now).changes;
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
      || !stages.has(row.stage)
      || !/^MAIL-[a-f0-9-]{36}$/.test(row.record_id)
      || ![0, 1].includes(row.recorded)
      || (row.recorded === 1 && row.state !== 'sent')
    ) throw conflict('邮件任务记录校验失败，必须停止发送。');
    return {
      intent,
      state: row.state,
      stage: row.stage,
      recordId: row.record_id,
      recorded: row.recorded === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    get,
    /** 上次进程发信途中退出后的恢复结果，供启动日志告警。 */
    recovered,
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
        UPDATE mail_deliveries
        SET state = ?, stage = COALESCE(?, stage), updated_at = ?
        WHERE operation_key = ? AND state = ?
      `).run(
        next,
        // 每次进入 sending / 退回 pending 都清零阶段：重试时不能残留上一次的「DATA 已发」。
        next === 'sending' || next === 'pending' ? '' : null,
        new Date().toISOString(),
        key,
        expected,
      );
      if (result.changes !== 1) throw conflict('邮件任务已被另一执行者处理。');
      return get(key);
    },
    /**
     * 记录「正文（DATA）已经写出」。只对正在发送的任务有意义：写完这一行，
     * 进程再退出时重启恢复就知道这封信可能已经送达，不能重发。
     */
    markStage(key, stage) {
      if (!stages.has(stage)) throw new TypeError('未知的邮件发送阶段。');
      const result = db.prepare(`
        UPDATE mail_deliveries SET stage = ?, updated_at = ?
        WHERE operation_key = ? AND state = 'sending'
      `).run(stage, new Date().toISOString(), key);
      if (result.changes !== 1) throw conflict('邮件任务阶段已变化或不存在，不能标记发送阶段。');
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
