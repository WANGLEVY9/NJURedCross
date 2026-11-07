/**
 * 「无照片补签申请」的私有状态（SQLite）。
 *
 * 申请不是签到证据，也不会自动把报名改成已签到：志愿者提交说明后，
 * 负责人仍在既有「核实到场与初审」流程里逐一确认（HMAC 签名写签到表）。
 * 该流程完成后由路由层把对应申请结案，证据链保持不变。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const invalid = message => Object.assign(new Error(message), { code: 'attendance_request_invalid' });
export const ATTENDANCE_REQUEST_STATUS = Object.freeze({ pending: 'pending', approved: 'approved', rejected: 'rejected' });

export function attendanceRequestDbPath() {
  if (process.env.ATTENDANCE_REQUEST_DB?.trim()) return process.env.ATTENDANCE_REQUEST_DB.trim();
  return process.env.NODE_ENV === 'production'
    ? '/var/lib/njuredcross/write-state/attendance-requests.sqlite'
    : `${process.cwd()}/.write-state/attendance-requests.sqlite`;
}

export async function openAttendanceRequestStore(file = attendanceRequestDbPath()) {
  if (typeof file !== 'string' || !file) throw invalid('申请存储路径无效');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_requests (
      id TEXT PRIMARY KEY,
      registration_code TEXT NOT NULL,
      event_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT NOT NULL DEFAULT '',
      decided_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS attendance_requests_code_idx ON attendance_requests(registration_code, status);
    CREATE INDEX IF NOT EXISTS attendance_requests_event_idx ON attendance_requests(event_id, status);
  `);
  const columns = 'id, registration_code, event_id, account_id, student_id, reason, status, created_at, decided_at, decided_by';
  return {
    db,
    submit({ registrationCode, eventId = '', accountId = '', studentId = '', reason = '', now = new Date().toISOString() }) {
      const code = String(registrationCode || '').trim();
      const text = String(reason || '').trim();
      if (!code || !text || text.length > 300) throw invalid('补签说明无效');
      const pending = db.prepare(`SELECT ${columns} FROM attendance_requests WHERE registration_code = ? AND status = 'pending' LIMIT 1`).get(code);
      if (pending) return pending;
      const entry = {
        id: randomUUID(), registration_code: code, event_id: String(eventId || ''),
        account_id: String(accountId || ''), student_id: String(studentId || ''),
        reason: text, status: ATTENDANCE_REQUEST_STATUS.pending,
        created_at: now, decided_at: '', decided_by: '',
      };
      db.prepare(`INSERT INTO attendance_requests (${columns}) VALUES (@id,@registration_code,@event_id,@account_id,@student_id,@reason,@status,@created_at,@decided_at,@decided_by)`).run(entry);
      return entry;
    },
    forRegistration(code) {
      return db.prepare(`SELECT ${columns} FROM attendance_requests WHERE registration_code = ? ORDER BY created_at DESC LIMIT 1`).get(String(code || '')) || null;
    },
    forAccount(accountId) {
      return db.prepare(`SELECT ${columns} FROM attendance_requests WHERE account_id = ? ORDER BY created_at DESC`).all(String(accountId || ''));
    },
    forEvent(eventId, status = ATTENDANCE_REQUEST_STATUS.pending) {
      return db.prepare(`SELECT ${columns} FROM attendance_requests WHERE event_id = ? AND status = ? ORDER BY created_at`).all(String(eventId || ''), status);
    },
    decide(code, status, actor = '') {
      if (!Object.values(ATTENDANCE_REQUEST_STATUS).includes(status) || status === ATTENDANCE_REQUEST_STATUS.pending) throw invalid('结案状态无效');
      return db.prepare(`UPDATE attendance_requests SET status = ?, decided_at = ?, decided_by = ? WHERE registration_code = ? AND status = 'pending'`)
        .run(status, new Date().toISOString(), String(actor || ''), String(code || '')).changes;
    },
    close() { db.close(); },
  };
}

let shared = null;
export async function attendanceRequests() {
  if (!shared) shared = await openAttendanceRequestStore();
  return shared;
}
