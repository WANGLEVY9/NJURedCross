import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const conflict = message => Object.assign(new Error(message), { statusCode: 409 });
function proposalJson(proposal) {
  if (!proposal || typeof proposal.id !== 'string' || !proposal.id.trim() || typeof proposal.eventId !== 'string' || !proposal.eventId.trim()
    || typeof proposal.actor !== 'string' || !proposal.actor.trim() || !/^[a-f0-9]{64}$/.test(proposal.baseDigest)
    || proposal.status !== 'pending' || !Array.isArray(proposal.changes) || !proposal.changes.length) throw new Error('变更申请格式无效');
  const json = JSON.stringify(proposal);
  if (Buffer.byteLength(json, 'utf8') > 128 * 1024) throw new Error('变更申请内容过大');
  return json;
}

/** Private local storage. Caller supplies a persistent path outside public/. */
export function createActivityChangeStore(file) {
  if (file !== ':memory:') {
    if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('变更申请存储必须使用绝对路径');
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS activity_changes (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, proposal TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','applying','approved','returned')),
      version INTEGER NOT NULL DEFAULT 1, review_token TEXT, reviewer TEXT,
      reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS activity_changes_active_event
      ON activity_changes(event_id) WHERE status IN ('pending','applying');`);
  if (!db.prepare('PRAGMA table_info(activity_changes)').all().some(column => column.name === 'decision')) db.exec('ALTER TABLE activity_changes ADD COLUMN decision TEXT');
  function row(id) {
    const stored = db.prepare('SELECT * FROM activity_changes WHERE id=?').get(id);
    if (!stored) return null;
    let proposal;
    try { proposal = JSON.parse(stored.proposal); proposalJson(proposal); }
    catch { throw new Error('变更申请存储损坏，请核对，禁止覆盖原数据'); }
    if (proposal.id !== stored.id || proposal.eventId !== stored.event_id) throw new Error('变更申请存储身份不一致');
    return { proposal, status: stored.status, version: stored.version, reviewer: stored.reviewer,
      reason: stored.reason, decision: stored.decision, createdAt: stored.created_at, updatedAt: stored.updated_at };
  }
  return {
    create(proposal) {
      const json = proposalJson(proposal), existing = row(proposal.id);
      if (existing) {
        if (JSON.stringify(existing.proposal) === json) return existing;
        throw conflict('申请编号已被其他内容使用');
      }
      const at = new Date().toISOString();
      try { db.prepare('INSERT INTO activity_changes(id,event_id,proposal,status,created_at,updated_at) VALUES(?,?,?,\'pending\',?,?)').run(proposal.id, proposal.eventId, json, at, at); }
      catch (error) {
        if (db.prepare("SELECT id FROM activity_changes WHERE event_id=? AND status IN ('pending','applying')").get(proposal.eventId)) throw conflict('此活动已有待审核或待核实的变更申请');
        throw error;
      }
      return row(proposal.id);
    },
    get: row,
    active(eventId) {
      const current = db.prepare("SELECT id FROM activity_changes WHERE event_id=? AND status IN ('pending','applying')").get(eventId);
      return current ? row(current.id) : null;
    },
    beginReview(id, version, reviewer, { decision = 'approve', reason = '' } = {}) {
      if (!reviewer || typeof reviewer !== 'string') throw new Error('审核人无效');
      if (!['approve', 'return'].includes(decision) || typeof reason !== 'string' || decision === 'return' && !reason.trim()) throw new Error('审核决定或原因无效');
      const token = randomUUID();
      const result = db.prepare("UPDATE activity_changes SET status='applying',version=version+1,review_token=?,reviewer=?,decision=?,reason=?,updated_at=? WHERE id=? AND version=? AND status='pending'").run(token, reviewer, decision, reason.trim(), new Date().toISOString(), id, version);
      if (result.changes !== 1) throw conflict('申请已更新或正在处理，请刷新核对');
      return { token, entry: row(id) };
    },
    resumeReview(id, version, reviewer) {
      const current = db.prepare("SELECT review_token FROM activity_changes WHERE id=? AND version=? AND reviewer=? AND status='applying'").get(id, version, reviewer);
      if (!current) throw conflict('无法恢复此审核，请刷新后核对');
      return { token: current.review_token, entry: row(id) };
    },
    finishReview(id, token, status, reason = '') {
      if (!['approved', 'returned'].includes(status) || typeof reason !== 'string' || status === 'returned' && !reason.trim()) throw new Error('审核结果或退回原因无效');
      if (typeof token !== 'string' || !token) throw new Error('审核凭据无效');
      const result = db.prepare("UPDATE activity_changes SET status=?,reason=?,version=version+1,review_token=NULL,updated_at=? WHERE id=? AND review_token=? AND status='applying'").run(status, reason.trim(), new Date().toISOString(), id, token);
      if (result.changes !== 1) throw conflict('审核凭据失效，禁止重复确认结果');
      return row(id);
    },
    close() { db.close(); },
  };
}
