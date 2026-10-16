import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

function failure() {
  return Object.assign(
    new Error('邮件只读诊断未完成，请检查状态目录和数据库。'),
    { code: 'mail_inspection_unavailable' },
  );
}

function counts(db, table, column, allowed) {
  const result = Object.fromEntries(
    allowed.map(value => [value, 0]),
  );

  const rows = db.prepare(`
    SELECT ${column} AS state, COUNT(*) AS count
    FROM ${table}
    GROUP BY ${column}
  `).all();

  for (const row of rows) {
    if (
      !allowed.includes(row.state)
      || !Number.isSafeInteger(row.count)
      || row.count < 0
    ) {
      throw failure();
    }

    result[row.state] = row.count;
  }

  return result;
}

function readDatabase(file, read) {
  const db = new DatabaseSync(file, { readOnly: true });

  try {
    db.exec('BEGIN');
    return read(db);
  } finally {
    try {
      db.exec('ROLLBACK');
    } finally {
      db.close();
    }
  }
}

export function inspectMailState(directory) {
  try {
    if (typeof directory !== 'string' || !directory.trim()) {
      throw failure();
    }

    const delivery = readDatabase(
      join(directory, 'mail-deliveries.sqlite'),
      db => {
        const states = counts(
          db,
          'mail_deliveries',
          'state',
          ['pending', 'sending', 'sent', 'unknown', 'cancelled'],
        );

        const row = db.prepare(`
          SELECT COUNT(*) AS count
          FROM mail_deliveries
          WHERE state = 'sent' AND recorded = 0
        `).get();

        if (!Number.isSafeInteger(row.count) || row.count < 0) {
          throw failure();
        }

        return {
          states,
          recordsPending: row.count,
        };
      },
    );

    const retry = readDatabase(
      join(directory, 'mail-retries.sqlite'),
      db => ({
        states: counts(
          db,
          'mail_retry_jobs',
          'status',
          ['queued', 'completed', 'stopped'],
        ),
      }),
    );

    return {
      mode: 'read-only',
      writes: 0,
      crossDatabaseAtomic: false,
      delivery,
      retry,
    };
  } catch {
    throw failure();
  }
}
export function inspectMailTask(directory, recordId) {
  try {
    if (
      typeof directory !== 'string' || !directory.trim()
      || typeof recordId !== 'string'
      || !/^MAIL-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(recordId)
    ) {
      throw failure();
    }

    const row = readDatabase(
      join(directory, 'mail-deliveries.sqlite'),
      db => db.prepare(`
        SELECT operation_key, record_id, state, recorded,
               created_at, updated_at
        FROM mail_deliveries
        WHERE record_id = ?
      `).get(recordId),
    );

    if (!row) {
      return {
        mode: 'read-only',
        writes: 0,
        crossDatabaseAtomic: false,
        found: false,
        recordId,
        delivery: null,
        retry: null,
      };
    }

    if (
      !['pending', 'sending', 'sent', 'unknown', 'cancelled']
        .includes(row.state)
      || ![0, 1].includes(row.recorded)
      || (row.recorded === 1 && row.state !== 'sent')
      || typeof row.operation_key !== 'string'
      || !row.operation_key.trim()
      || !Number.isFinite(Date.parse(row.created_at))
      || !Number.isFinite(Date.parse(row.updated_at))
    ) {
      throw failure();
    }

    const retry = readDatabase(
      join(directory, 'mail-retries.sqlite'),
      db => {
        const job = db.prepare(`
          SELECT status, attempts, expires_at, next_attempt_at
          FROM mail_retry_jobs
          WHERE operation_key = ?
        `).get(row.operation_key);

        if (!job) return null;

        if (
          !['queued', 'completed', 'stopped'].includes(job.status)
          || !Number.isSafeInteger(job.attempts) || job.attempts < 0
          || !Number.isSafeInteger(job.expires_at) || job.expires_at < 0
          || !Number.isSafeInteger(job.next_attempt_at)
          || job.next_attempt_at < 0
        ) {
          throw failure();
        }

        return {
          status: job.status,
          attempts: job.attempts,
          expiresAt: job.expires_at,
          nextAttemptAt: job.next_attempt_at,
        };
      },
    );

    return {
      mode: 'read-only',
      writes: 0,
      crossDatabaseAtomic: false,
      found: true,
      recordId,
      delivery: {
        state: row.state,
        recorded: row.recorded === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      retry,
    };
  } catch {
    throw failure();
  }
}
export function listMailAttention(directory, {
  limit = 20,
  after = null,
} = {}) {
  try {
    const validId = value => (
      typeof value === 'string'
      && /^MAIL-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
    );

    if (
      typeof directory !== 'string' || !directory.trim()
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || (after !== null && !validId(after))
    ) {
      throw failure();
    }

    return readDatabase(
      join(directory, 'mail-deliveries.sqlite'),
      db => {
        const rows = db.prepare(`
          SELECT record_id, state, recorded, updated_at
          FROM mail_deliveries
          WHERE (
            state IN ('pending', 'sending', 'unknown')
            OR (state = 'sent' AND recorded = 0)
          )
          AND record_id > ?
          ORDER BY record_id
          LIMIT ?
        `).all(after || '', limit + 1);

        for (const row of rows) {
          if (
            !validId(row.record_id)
            || !['pending', 'sending', 'unknown', 'sent']
              .includes(row.state)
            || row.recorded !== 0
            || typeof row.updated_at !== 'string'
            || !Number.isFinite(Date.parse(row.updated_at))
          ) {
            throw failure();
          }
        }

        const hasMore = rows.length > limit;
        const items = rows.slice(0, limit).map(row => ({
          recordId: row.record_id,
          state: row.state,
          recorded: false,
          updatedAt: row.updated_at,
        }));

        return {
          mode: 'read-only',
          writes: 0,
          order: 'recordId',
          limit,
          items,
          hasMore,
          nextCursor: hasMore
            ? items.at(-1).recordId
            : null,
        };
      },
    );
  } catch {
    throw failure();
  }
}