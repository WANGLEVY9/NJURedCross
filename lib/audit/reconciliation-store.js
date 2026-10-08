import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHmac } from 'node:crypto';
import { sealAuditPayload, openAuditPayload } from './payload.js';

const transitions = {
  prepared: new Set(['attempted']),
  attempted: new Set(['unconfirmed', 'confirmed']),
  unconfirmed: new Set(['confirmed']),
  confirmed: new Set(),
};

function conflict() {
  return Object.assign(
    new Error('审计核对凭据不一致，已停止处理。'),
    { code: 'audit_reconciliation_conflict' },
  );
}

export async function openAuditReconciliationStore(file, options) {
    options = { ...options };
  if (
    typeof options?.secret !== 'string'
    || options.secret.length < 32
    || typeof options.baseUuid !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
      .test(options.baseUuid)
  ) {
    throw conflict();
  }

  const keyCheck = createHmac('sha256', options.secret)
    .update('nju-redcross/audit-store/v1')
    .digest('hex');

  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);

  try {
    db.exec(`
      PRAGMA busy_timeout = 1000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;

      CREATE TABLE IF NOT EXISTS audit_store_context (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        base_uuid TEXT NOT NULL,
        key_check TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_receipts (
        audit_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.prepare(`
      INSERT INTO audit_store_context (singleton, base_uuid, key_check)
      VALUES (1, ?, ?)
      ON CONFLICT(singleton) DO NOTHING
    `).run(options.baseUuid, keyCheck);

    const stored = db.prepare(
      'SELECT base_uuid, key_check FROM audit_store_context WHERE singleton = 1',
    ).get();

    if (
      stored.base_uuid !== options.baseUuid
      || stored.key_check !== keyCheck
    ) {
      throw conflict();
    }
  } catch (error) {
    db.close();
    throw error;
  }

  function get(id) {
    const record = db.prepare(
      'SELECT * FROM audit_receipts WHERE audit_id = ?',
    ).get(id);
    if (!record) return null;

    const envelope = JSON.parse(record.envelope_json);
    const row = openAuditPayload(envelope, options);

    if (
      row['审计ID'] !== record.audit_id
      || envelope.fingerprint !== record.fingerprint
      || !Object.hasOwn(transitions, record.state)
    ) {
      throw conflict();
    }

    return {
      auditId: record.audit_id,
      fingerprint: record.fingerprint,
      state: record.state,
      row,
      updatedAt: record.updated_at,
    };
  }

  return {
    get baseUuid() {
      return options.baseUuid;
    },

    get,

    prepare(row) {
      const envelope = sealAuditPayload(row, options);

      db.prepare(`
        INSERT INTO audit_receipts (
          audit_id, fingerprint, envelope_json, state, updated_at
        ) VALUES (?, ?, ?, 'prepared', ?)
        ON CONFLICT(audit_id) DO NOTHING
      `).run(
        envelope.auditId,
        envelope.fingerprint,
        JSON.stringify(envelope),
        new Date().toISOString(),
      );

      const stored = get(envelope.auditId);
      if (stored.fingerprint !== envelope.fingerprint) throw conflict();
      return stored;
    },

    claimAttempt(id) {
      const stored = get(id);
      if (!stored) throw conflict();

      const result = db.prepare(`
        UPDATE audit_receipts
        SET state = 'attempted', updated_at = ?
        WHERE audit_id = ? AND state = 'prepared' AND fingerprint = ?
      `).run(
        new Date().toISOString(),
        id,
        stored.fingerprint,
      );

      return result.changes === 1;
    },

    transition(id, nextState) {
      const stored = get(id);
      if (!stored) throw conflict();
      if (stored.state === nextState) return stored;

      if (!transitions[stored.state].has(nextState)) throw conflict();

      const result = db.prepare(`
        UPDATE audit_receipts
        SET state = ?, updated_at = ?
        WHERE audit_id = ? AND state = ? AND fingerprint = ?
      `).run(
        nextState,
        new Date().toISOString(),
        id,
        stored.state,
        stored.fingerprint,
      );

      if (result.changes !== 1) throw conflict();
      return get(id);
    },

    listAttention({ limit = 20, after = '' } = {}) {
      if (
        !Number.isInteger(limit)
        || limit < 1
        || limit > 100
        || typeof after !== 'string'
        || after.length > 200
      ) {
        throw conflict();
      }

      const records = db.prepare(`
        SELECT audit_id
        FROM audit_receipts
        WHERE state <> 'confirmed' AND audit_id > ?
        ORDER BY audit_id
        LIMIT ?
      `).all(after, limit + 1);

      const hasMore = records.length > limit;
      const items = records.slice(0, limit).map(record => {
        const stored = get(record.audit_id);
        if (!stored) throw conflict();

        return {
          auditId: stored.auditId,
          state: stored.state,
          updatedAt: stored.updatedAt,
        };
      });

      return {
        items,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].auditId : null,
      };
    },

    summary() {
      const counts = {
        prepared: 0,
        attempted: 0,
        unconfirmed: 0,
        confirmed: 0,
      };

      for (const row of db.prepare(
        'SELECT state, COUNT(*) AS count FROM audit_receipts GROUP BY state',
      ).all()) {
        if (!Object.hasOwn(counts, row.state)) throw conflict();
        counts[row.state] = row.count;
      }

      return counts;
    },

    close() {
      db.close();
    },
  };
}