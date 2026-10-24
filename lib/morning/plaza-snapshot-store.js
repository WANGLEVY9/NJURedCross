import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const MORNING_PLAZA_DAILY_LIMIT = 6;

export function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

export async function openMorningPlazaSnapshotStore(file) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS morning_plaza_daily_snapshots (
      account_id TEXT NOT NULL,
      shanghai_date TEXT NOT NULL,
      card_ids TEXT NOT NULL,
      PRIMARY KEY (account_id, shanghai_date)
    );
    CREATE INDEX IF NOT EXISTS morning_plaza_daily_snapshots_date
      ON morning_plaza_daily_snapshots (shanghai_date);
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO morning_plaza_daily_snapshots (account_id, shanghai_date, card_ids)
    VALUES (?, ?, ?)
  `);
  const select = db.prepare(`
    SELECT card_ids FROM morning_plaza_daily_snapshots
    WHERE account_id = ? AND shanghai_date = ?
  `);
  const prune = db.prepare('DELETE FROM morning_plaza_daily_snapshots WHERE shanghai_date < ?');

  return {
    getOrCreate(accountId, date, cardIds) {
      const today = String(date || '');
      if (!accountId || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !Array.isArray(cardIds)) {
        throw new TypeError('Invalid daily plaza snapshot input');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        prune.run(today);
        insert.run(String(accountId), today, JSON.stringify(cardIds.slice(0, MORNING_PLAZA_DAILY_LIMIT)));
        const stored = select.get(String(accountId), today);
        db.exec('COMMIT');
        return JSON.parse(stored.card_ids);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
