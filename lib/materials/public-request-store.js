import { DatabaseSync } from 'node:sqlite';

function validate(receipt) {
  if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.key) || !/^[a-f0-9]{64}$/.test(receipt.fingerprint)
    || !['attempted', 'link_pending', 'completed'].includes(receipt.state)
    || typeof receipt.materialId !== 'string' || !receipt.materialId || !receipt.row
    || typeof receipt.automatic !== 'boolean'
    || (receipt.state !== 'attempted' && (typeof receipt.rowId !== 'string' || !receipt.rowId))
    || (receipt.state === 'completed' && receipt.result?.request?.code !== `REQ-${receipt.rowId}`)) {
    throw Object.assign(new Error('申请凭证不完整，请联系管理员核查，勿重复提交。'), { statusCode: 409 });
  }
  return receipt;
}

// A durable receipt is required before the first remote mutation. An uncertain
// append must never be repeated automatically, including after a server restart.
export function openPublicMaterialRequestStore(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS material_requests (
        request_key TEXT PRIMARY KEY, document TEXT NOT NULL
      );`);
  } catch (error) { db.close(); throw error; }
  const select = db.prepare('SELECT document FROM material_requests WHERE request_key=?');
  return {
    get(key) { const row = select.get(key); return row ? validate(JSON.parse(row.document)) : null; },
    create(receipt) {
      validate(receipt);
      const result = db.prepare('INSERT INTO material_requests VALUES (?, ?) ON CONFLICT DO NOTHING')
        .run(receipt.key, JSON.stringify(receipt));
      return result.changes === 1;
    },
    save(receipt, previous) {
      validate(receipt); validate(previous);
      const result = db.prepare('UPDATE material_requests SET document=? WHERE request_key=? AND document=?')
        .run(JSON.stringify(receipt), receipt.key, JSON.stringify(previous));
      if (result.changes !== 1) throw Object.assign(new Error('申请正在处理，请稍后使用原申请重试。'), { statusCode: 409 });
    },
    close() { db.close(); },
  };
}
