import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertRequestActive } from '../http/request-budget.js';

function busy(error) {
  return error?.errcode === 5 || error?.errcode === 6;
}

export async function createWriteCoordinator(file, {
  waitMs = 30_000,
  retryMs = 25,
} = {}) {
  if (
    !Number.isSafeInteger(waitMs) || waitMs <= 0
    || !Number.isSafeInteger(retryMs) || retryMs <= 0
  ) {
    throw new TypeError('Lock waiting settings must be positive integers');
  }

  await mkdir(dirname(file), { recursive: true, mode: 0o700 });

  // This file is only for coordination, never for receipt storage.
  const initial = new DatabaseSync(file);
  try {
    initial.exec(`
      PRAGMA busy_timeout = 0;
      CREATE TABLE IF NOT EXISTS coordinator (
        id INTEGER PRIMARY KEY
      );
    `);
  } finally {
    initial.close();
  }

  return async function withWriteLock(task) {
    assertRequestActive();
    const db = new DatabaseSync(file);
    let acquired = false;
    const deadline = Date.now() + waitMs;

    try {
      db.exec('PRAGMA busy_timeout = 0');

      while (!acquired) {
        assertRequestActive();

        if (Date.now() >= deadline) {
          throw Object.assign(
            new Error('等待共享写锁超时，请稍后重试。'),
            {
              statusCode: 503,
              code: 'write_lock_timeout',
            },
          );
        }

        try {
          db.exec('BEGIN IMMEDIATE');
          acquired = true;
        } catch (error) {
          if (!busy(error)) throw error;
          await delay(retryMs);
        }
      }

      assertRequestActive();
      return await task();
    } finally {
      try {
        if (acquired) db.exec('ROLLBACK');
      } finally {
        db.close();
      }
    }
  };
}
