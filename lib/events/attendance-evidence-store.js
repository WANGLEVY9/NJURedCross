/**
 * 签到凭证元数据（SQLite，单机单进程）。
 *
 * 业务表「签到照片ID」仍是一个裸 UUID：Box 文件的完整路径、所属活动与报名
 * 都记在这里，读取时按 id 反查。这样迁移不需要改业务表列，也不需要改
 * `submitAttendance` 的 UUID 校验。历史本地文件没有元数据行，读取时回退本地目录。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const invalid = (message, code = 'evidence_store_invalid') => Object.assign(new Error(message), { code });

export const EVIDENCE_PROVIDERS = Object.freeze({ box: 'box', local: 'local' });

export function evidenceStorePath() {
  if (process.env.WORKFLOW_EVIDENCE_DB?.trim()) return process.env.WORKFLOW_EVIDENCE_DB.trim();
  return process.env.NODE_ENV === 'production'
    ? '/var/lib/njuredcross/write-state/attendance-evidence.sqlite'
    : `${process.cwd()}/.write-state/attendance-evidence.sqlite`;
}

export async function openEvidenceStore(file = evidenceStorePath()) {
  if (typeof file !== 'string' || !file) throw invalid('凭证元数据路径无效');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      mime TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      event_id TEXT NOT NULL DEFAULT '',
      registration_code TEXT NOT NULL DEFAULT '',
      student_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      referenced INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS evidence_provider_idx ON evidence(provider);
  `);
  // 旧表平稳升级：新增姓名/活动名/文件名/签到时间，便于在 Box 里直接校对。
  const existingColumns = new Set(db.prepare('PRAGMA table_info(evidence)').all().map(row => row.name));
  for (const [name, definition] of [
    ['event_name', "TEXT NOT NULL DEFAULT ''"], ['person_name', "TEXT NOT NULL DEFAULT ''"],
    ['filename', "TEXT NOT NULL DEFAULT ''"], ['signed_at', "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!existingColumns.has(name)) db.exec(`ALTER TABLE evidence ADD COLUMN ${name} ${definition}`);
  }
  const columns = 'id, provider, path, bytes, mime, sha256, event_id, event_name, person_name, registration_code, student_id, filename, signed_at, created_at, referenced';
  return {
    db,
    get(id) {
      if (!/^[a-f0-9-]{36}$/.test(String(id || ''))) return null;
      return db.prepare(`SELECT ${columns} FROM evidence WHERE id = ?`).get(id) || null;
    },
    record(entry) {
      if (!entry?.id || !entry?.provider || !entry?.path) throw invalid('凭证元数据不完整');
      const placeholders = columns.split(',').map(name => `@${name.trim()}`).join(',');
      db.prepare(`INSERT OR REPLACE INTO evidence (${columns}) VALUES (${placeholders})`)
        .run({
          referenced: 0, event_id: '', event_name: '', person_name: '', registration_code: '',
          student_id: '', filename: '', signed_at: '',
          ...entry,
        });
      return this.get(entry.id);
    },
    list(provider = null) {
      return provider
        ? db.prepare(`SELECT ${columns} FROM evidence WHERE provider = ? ORDER BY created_at`).all(provider)
        : db.prepare(`SELECT ${columns} FROM evidence ORDER BY created_at`).all();
    },
    markReferenced(ids) {
      const update = db.prepare('UPDATE evidence SET referenced = 1 WHERE id = ?');
      db.exec('UPDATE evidence SET referenced = 0');
      for (const id of ids) update.run(String(id));
    },
    remove(id) {
      db.prepare('DELETE FROM evidence WHERE id = ?').run(String(id));
    },
    close() { db.close(); },
  };
}
