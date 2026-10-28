import { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const MORNING_PLAZA_DAILY_LIMIT = 6;

export function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

function shiftDate(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function shuffled(values, chooseIndex = randomInt) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = chooseIndex(index + 1);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

export function selectDailyCardIds(cardIds, previousIds = [], chooseIndex = randomInt) {
  const uniqueIds = [...new Set(cardIds.map(String).filter(Boolean))];
  const previous = new Set(previousIds);
  const fresh = uniqueIds.filter(id => !previous.has(id));
  if (!fresh.length) return shuffled(uniqueIds, chooseIndex).slice(0, MORNING_PLAZA_DAILY_LIMIT);
  if (fresh.length >= MORNING_PLAZA_DAILY_LIMIT) {
    return shuffled(fresh, chooseIndex).slice(0, MORNING_PLAZA_DAILY_LIMIT);
  }
  const previouslyShown = uniqueIds.filter(id => previous.has(id));
  const fill = shuffled(previouslyShown, chooseIndex)
    .slice(0, MORNING_PLAZA_DAILY_LIMIT - fresh.length);
  return shuffled([...shuffled(fresh, chooseIndex), ...fill], chooseIndex);
}

export async function openMorningPlazaSnapshotStore(file, { chooseIndex = randomInt } = {}) {
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
    CREATE TABLE IF NOT EXISTS morning_plaza_favorites (
      account_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (account_id, card_id)
    );
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
  const favoriteInsert = db.prepare(`
    INSERT OR IGNORE INTO morning_plaza_favorites (account_id, card_id, created_at)
    VALUES (?, ?, ?)
  `);
  const favoriteList = db.prepare('SELECT card_id FROM morning_plaza_favorites WHERE account_id = ? ORDER BY created_at DESC, card_id');
  const favoriteRemove = db.prepare('DELETE FROM morning_plaza_favorites WHERE account_id = ? AND card_id = ?');

  return {
    getOrCreate(accountId, date, cardIds) {
      const today = String(date || '');
      if (!accountId || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !Array.isArray(cardIds)) {
        throw new TypeError('Invalid daily plaza snapshot input');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        prune.run(shiftDate(today, -7));
        const stored = select.get(String(accountId), today);
        if (stored) {
          db.exec('COMMIT');
          return JSON.parse(stored.card_ids);
        }
        const previousSnapshot = select.get(String(accountId), shiftDate(today, -1));
        const previousIds = previousSnapshot ? JSON.parse(previousSnapshot.card_ids) : [];
        const selectedIds = selectDailyCardIds(cardIds, previousIds, chooseIndex);
        insert.run(String(accountId), today, JSON.stringify(selectedIds));
        const selected = select.get(String(accountId), today);
        db.exec('COMMIT');
        return JSON.parse(selected.card_ids);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    listFavorites(accountId) {
      return favoriteList.all(String(accountId || '')).map(row => row.card_id);
    },
    addFavorite(accountId, cardId, createdAt = new Date().toISOString()) {
      if (!accountId || !cardId) throw new TypeError('Invalid plaza favorite input');
      favoriteInsert.run(String(accountId), String(cardId), String(createdAt));
      return favoriteList.all(String(accountId)).map(row => row.card_id);
    },
    removeFavorite(accountId, cardId) {
      favoriteRemove.run(String(accountId || ''), String(cardId || ''));
      return favoriteList.all(String(accountId || '')).map(row => row.card_id);
    },
    close() {
      db.close();
    },
  };
}
