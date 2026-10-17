/**
 * 持久化任务队列存储（SQLite，WAL）。
 *
 * 项目运行在单机单进程上，没有独立的消息中间件。用本地 SQLite 承担
 * “队列 + 收件箱”的角色，换来三件进程内队列给不了的性质：
 *   · 重启/崩溃后未完成的任务仍在；
 *   · 领取是事务内的 CAS，不会因为重入而重复执行；
 *   · 失败可退避重试，超过上限进入 failed 供人工核对。
 *
 * 存储里只放业务标识与最小参数，不放邮件正文、口令或凭据。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATUSES = new Set(['queued', 'running', 'done', 'failed']);
const MAX_PAYLOAD_BYTES = 64 * 1024;

function invalid(message) {
  return Object.assign(new Error(message), { code: 'job_store_invalid' });
}

function assertTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${label}无效`);
  return value;
}

export async function openJobStore(file, { maxAttempts = 5, now = Date.now } = {}) {
  if (typeof file !== 'string' || !file) throw invalid('任务队列路径无效');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw invalid('任务重试上限无效');
  }

  await mkdir(dirname(file), { recursive: true, mode: 0o700 });

  const db = new DatabaseSync(file);

  try {
    db.exec(`
      PRAGMA busy_timeout = 2000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        dedupe_key TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        run_after INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status, run_after);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe
        ON jobs (dedupe_key)
        WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  const selectRow = db.prepare('SELECT * FROM jobs WHERE id = ?');

  function hydrate(row) {
    if (!row) return null;
    if (!STATUSES.has(row.status)) throw invalid('任务状态无效');
    return {
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload_json),
      dedupeKey: row.dedupe_key,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAfter: row.run_after,
      lockedUntil: row.locked_until,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function findDedupe(key) {
    if (!key) return null;
    return hydrate(db.prepare(`
      SELECT * FROM jobs
      WHERE dedupe_key = ? AND status IN ('queued', 'running')
      LIMIT 1
    `).get(key));
  }

  return {
    /** 入队；相同 dedupeKey 的在途任务不会重复创建。 */
    enqueue({
      type,
      payload = {},
      dedupeKey = null,
      runAfter = now(),
      maxAttempts: limit = maxAttempts,
    }) {
      if (typeof type !== 'string' || !type.trim() || type.length > 120) throw invalid('任务类型无效');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw invalid('任务重试上限无效');
      assertTime(runAfter, '任务计划时间');
      if (dedupeKey !== null && (typeof dedupeKey !== 'string' || !dedupeKey || dedupeKey.length > 200)) {
        throw invalid('任务去重键无效');
      }

      const encoded = JSON.stringify(payload);
      if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_PAYLOAD_BYTES) {
        throw invalid('任务参数过大');
      }

      const existing = findDedupe(dedupeKey);
      if (existing) return { job: existing, created: false };

      const timestamp = now();
      const id = randomUUID();

      db.prepare(`
        INSERT INTO jobs (
          id, type, payload_json, dedupe_key, status, attempts,
          max_attempts, run_after, locked_until, last_error,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, 0, '', ?, ?)
        ON CONFLICT DO NOTHING
      `).run(id, type, encoded, dedupeKey, limit, runAfter, timestamp, timestamp);

      const created = hydrate(selectRow.get(id));
      if (created) return { job: created, created: true };

      // 唯一索引竞争：返回已有在途任务。
      const raced = findDedupe(dedupeKey);
      if (raced) return { job: raced, created: false };
      throw invalid('任务入队失败');
    },

    /** 事务内领取到期任务；租约到期后由 runner 回收。 */
    claim({ at = now(), limit = 1, leaseMs = 60_000 } = {}) {
      assertTime(at, '领取时间');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw invalid('领取数量无效');
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw invalid('任务租约无效');

      const picked = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        const rows = db.prepare(`
          SELECT id FROM jobs
          WHERE status = 'queued' AND run_after <= ?
          ORDER BY run_after, created_at
          LIMIT ?
        `).all(at, limit);

        const take = db.prepare(`
          UPDATE jobs
          SET status = 'running', attempts = attempts + 1,
              locked_until = ?, updated_at = ?
          WHERE id = ? AND status = 'queued'
        `);

        for (const row of rows) {
          const result = take.run(at + leaseMs, at, row.id);
          if (result.changes === 1) picked.push(row.id);
        }

        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return picked.map(id => hydrate(selectRow.get(id)));
    },

    complete(id) {
      const result = db.prepare(`
        UPDATE jobs
        SET status = 'done', locked_until = 0, last_error = '', updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(now(), id);
      if (result.changes !== 1) throw invalid('任务完成后状态冲突');
      return hydrate(selectRow.get(id));
    },

    /** 失败：未达上限按退避重新排队，达到上限进入 failed 待人工处理。 */
    fail(id, { error = 'job_failed', retryAfterMs = 30_000 } = {}) {
      const current = hydrate(selectRow.get(id));
      if (!current || current.status !== 'running') throw invalid('任务失败后状态冲突');

      const message = String(error).slice(0, 160);
      const exhausted = current.attempts >= current.maxAttempts;
      const nextRun = now() + Math.max(1_000, Math.min(retryAfterMs, 15 * 60_000));

      db.prepare(`
        UPDATE jobs
        SET status = ?, run_after = ?, locked_until = 0,
            last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(exhausted ? 'failed' : 'queued', exhausted ? current.runAfter : nextRun, message, now(), id);

      return hydrate(selectRow.get(id));
    },

    /** 进程崩溃/停机遗留的租约回收。 */
    releaseStale(at = now()) {
      const result = db.prepare(`
        UPDATE jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
            locked_until = 0, updated_at = ?
        WHERE status = 'running' AND locked_until <= ?
      `).run(at, at);
      return result.changes;
    },

    stats() {
      const counts = db.prepare(`
        SELECT status, COUNT(*) AS total FROM jobs GROUP BY status
      `).all();
      const summary = { queued: 0, running: 0, done: 0, failed: 0 };
      for (const row of counts) if (row.status in summary) summary[row.status] = row.total;
      const oldest = db.prepare(`
        SELECT MIN(run_after) AS due FROM jobs WHERE status = 'queued'
      `).get();
      return { ...summary, oldestQueuedAt: oldest?.due ?? null };
    },

    list({ status = 'queued', limit = 20 } = {}) {
      if (!STATUSES.has(status)) throw invalid('任务状态无效');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid('任务查询数量无效');
      return db.prepare(`
        SELECT * FROM jobs WHERE status = ? ORDER BY run_after, created_at LIMIT ?
      `).all(status, limit).map(hydrate);
    },

    close() {
      db.close();
    },
  };
}
