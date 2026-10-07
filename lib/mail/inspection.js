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
