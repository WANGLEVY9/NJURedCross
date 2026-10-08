import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  materialOperationIdentity,
  assertSameMaterialOperation,
} from './operation.js';

const states = [
  'prepared',
  'flow_attempted',
  'flow_confirmed',
  'application_attempted',
  'completed',
];

function invalid(message) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'material_receipt_conflict',
  });
}

function validate(receipt) {
  const identity = materialOperationIdentity({
    ...receipt.identity.payload,
    idempotencyKey: receipt.identity.key,
  });
  assertSameMaterialOperation(identity, receipt.identity);

  if (
    !states.includes(receipt.state)
    || !receipt.flow
    || !receipt.before
    || !receipt.after
    || !Object.keys(receipt.before).length
    || !Object.keys(receipt.after).length
    || receipt.flow['幂等键'] !== identity.key
    || receipt.flow['申请单ID'] !== identity.payload.applicationId
    || receipt.flow['资产编码'] !== identity.payload.assetCode
  ) {
    throw invalid('操作凭证结构不完整或不一致。');
  }
}

function planHash(receipt) {
  return createHash('sha256').update(JSON.stringify({
    identity: receipt.identity,
    flow: receipt.flow,
    before: receipt.before,
    after: receipt.after,
  })).digest('hex');
}

export async function openMaterialReceiptStore(file) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);

  try {
    db.exec(`
      PRAGMA busy_timeout = 1000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS material_receipts (
        operation_key TEXT PRIMARY KEY,
        plan_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        document TEXT NOT NULL
      );
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  const select = db.prepare(
    'SELECT plan_hash, state, document FROM material_receipts WHERE operation_key = ?',
  );

  function get(key) {
    const row = select.get(key);
    if (!row) return null;

    const receipt = JSON.parse(row.document);
    validate(receipt);
    if (receipt.state !== row.state || planHash(receipt) !== row.plan_hash) {
      throw invalid('已保存的操作凭证校验失败，必须停止恢复。');
    }
    return receipt;
  }

  return {
    get,
    pendingForAsset(assetCode) {
      return db.prepare(`
        SELECT operation_key FROM material_receipts
        WHERE state <> 'completed'
          AND json_extract(
            document, '$.identity.payload.assetCode'
          ) = ?
      `).all(assetCode).map(row => get(row.operation_key));
    },
    pendingForApplication(applicationId) {
      return db.prepare(`
        SELECT operation_key FROM material_receipts
        WHERE state <> 'completed'
          AND json_extract(
            document, '$.identity.payload.applicationId'
          ) = ?
      `).all(applicationId).map(row => get(row.operation_key));
    },

    create(receipt) {
      validate(receipt);
      if (receipt.state !== 'prepared') {
        throw invalid('新操作凭证必须从 prepared 开始。');
      }

      db.prepare(`
        INSERT INTO material_receipts
          (operation_key, plan_hash, state, document)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(operation_key) DO NOTHING
      `).run(
        receipt.identity.key,
        planHash(receipt),
        receipt.state,
        JSON.stringify(receipt),
      );

      const stored = get(receipt.identity.key);
      assertSameMaterialOperation(stored.identity, receipt.identity);
      if (planHash(stored) !== planHash(receipt)) {
        throw invalid('已有操作凭证的执行计划不能更改。');
      }
      return stored;
    },

    save(receipt) {
      validate(receipt);
      const allowedPrevious = states.slice(
        0,
        states.indexOf(receipt.state) + 1,
      );
      const placeholders = allowedPrevious.map(() => '?').join(',');

      const result = db.prepare(`
        UPDATE material_receipts
        SET state = ?, document = ?
        WHERE operation_key = ?
          AND plan_hash = ?
          AND state IN (${placeholders})
      `).run(
        receipt.state,
        JSON.stringify(receipt),
        receipt.identity.key,
        planHash(receipt),
        ...allowedPrevious,
      );

      if (result.changes !== 1) {
        throw invalid('操作凭证缺失、计划冲突或阶段已被其他执行者推进。');
      }
      return get(receipt.identity.key);
    },

    close() {
      db.close();
    },
  };
}