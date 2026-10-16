import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertSameMailIntent } from './intent.js';

function conflict() {
  return Object.assign(
    new Error('邮件重试任务已变化或数据无效，停止处理。'),
    { code: 'mail_retry_conflict' },
  );
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export async function openMailRetryStore(file) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);

  try {
    db.exec(`
      PRAGMA busy_timeout = 1000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;

      CREATE TABLE IF NOT EXISTS mail_retry_jobs (
        operation_key TEXT PRIMARY KEY,
        intent_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued'
      );
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  function get(key) {
    const row = db.prepare(`
      SELECT * FROM mail_retry_jobs WHERE operation_key = ?
    `).get(key);

    if (!row) return null;

    const intent = JSON.parse(row.intent_json);
    const envelope = JSON.parse(row.payload_json);

    if (
      intent.key !== row.operation_key
      || intent.kind !== 'security'
      || !/^[a-f0-9]{64}$/.test(intent.fingerprint || '')
      || envelope.version !== 1
      || !validTime(row.expires_at)
      || !validTime(row.next_attempt_at)
      || !Number.isSafeInteger(row.attempts)
      || row.attempts < 0
      || !['queued', 'completed', 'stopped'].includes(row.status)
    ) {
      throw conflict();
    }

    return {
      intent,
      envelope,
      expiresAt: row.expires_at,
      nextAttemptAt: row.next_attempt_at,
      attempts: row.attempts,
      status: row.status,
    };
  }

  return {
    get,

    enqueue({ intent, envelope, expiresAt, nextAttemptAt }) {
      if (
        !intent || intent.kind !== 'security'
        || typeof intent.key !== 'string' || !intent.key.trim()
        || !/^[a-f0-9]{64}$/.test(intent.fingerprint || '')
        || !envelope || envelope.version !== 1
        || !/^[a-f0-9]{24}$/.test(envelope.iv || '')
        || !/^[a-f0-9]{32}$/.test(envelope.tag || '')
        || typeof envelope.data !== 'string'
        || envelope.data.length > 160_000
        || !/^(?:[a-f0-9]{2})+$/.test(envelope.data)
        || !validTime(expiresAt) || !validTime(nextAttemptAt)
        || nextAttemptAt >= expiresAt
      ) {
        throw conflict();
      }

      db.prepare(`
        INSERT INTO mail_retry_jobs (
          operation_key, intent_json, payload_json,
          expires_at, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(operation_key) DO NOTHING
      `).run(
        intent.key,
        JSON.stringify(intent),
        JSON.stringify(envelope),
        expiresAt,
        nextAttemptAt,
      );

      const existing = get(intent.key);
      assertSameMailIntent(existing.intent, intent);

      if (
        JSON.stringify(existing.intent) !== JSON.stringify(intent)
        || existing.expiresAt !== expiresAt
      ) {
        throw conflict();
      }

      return existing;
    },

    due({ now = Date.now(), limit = 5 } = {}) {
      if (
        !validTime(now)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      ) {
        throw conflict();
      }

      return db.prepare(`
        SELECT operation_key FROM mail_retry_jobs
        WHERE status = 'queued' AND next_attempt_at <= ?
        ORDER BY next_attempt_at, operation_key
        LIMIT ?
      `).all(now, limit).map(row => get(row.operation_key));
    },

    update(key, expectedAttempts, {
      attempts,
      status,
      nextAttemptAt,
    }) {
      const existing = get(key);

      if (
        !existing || existing.status !== 'queued'
        || existing.attempts !== expectedAttempts
        || !Number.isSafeInteger(attempts)
        || attempts < expectedAttempts
        || attempts > expectedAttempts + 1
        || !['queued', 'completed', 'stopped'].includes(status)
        || !validTime(nextAttemptAt)
        || (
          status === 'queued'
          && (
            attempts !== expectedAttempts + 1
            || nextAttemptAt <= existing.nextAttemptAt
            || nextAttemptAt >= existing.expiresAt
          )
        )
      ) {
        throw conflict();
      }

      const result = db.prepare(`
        UPDATE mail_retry_jobs
        SET attempts = ?, status = ?, next_attempt_at = ?
        WHERE operation_key = ? AND attempts = ? AND status = 'queued'
      `).run(attempts, status, nextAttemptAt, key, expectedAttempts);

      if (result.changes !== 1) throw conflict();
      return get(key);
    },

    close() {
      db.close();
    },
  };
}