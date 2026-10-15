import { DatabaseSync } from 'node:sqlite';

const allowedStates = [
  'prepared',
  'flow_attempted',
  'flow_confirmed',
  'application_attempted',
  'completed',
];

function unavailable() {
  return Object.assign(
    new Error('物资凭据统计不可用，请检查本地状态数据库。'),
    { code: 'material_inspection_unavailable' },
  );
}

export function inspectMaterialState(file) {
  let db;
  let transactionStarted = false;

  try {
    if (typeof file !== 'string' || !file.trim()) {
      throw unavailable();
    }

    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 1000; BEGIN;');
    transactionStarted = true;

    const states = Object.fromEntries(
      allowedStates.map(state => [state, 0]),
    );
    const rows = db.prepare(`
      SELECT state, COUNT(*) AS count
      FROM material_receipts
      GROUP BY state
    `).all();

    let total = 0;

    for (const row of rows) {
      if (
        !allowedStates.includes(row.state)
        || !Number.isSafeInteger(row.count)
        || row.count < 0
        || !Number.isSafeInteger(total + row.count)
      ) {
        throw unavailable();
      }

      states[row.state] = row.count;
      total += row.count;
    }

    return {
      mode: 'read-only',
      writes: 0,
      networkRequests: 0,
      states,
      total,
      unfinished: total - states.completed,
      plansValidated: false,
    };
  } catch {
    throw unavailable();
  } finally {
    if (db) {
      try {
        if (transactionStarted) db.exec('ROLLBACK;');
      } finally {
        db.close();
      }
    }
  }
}