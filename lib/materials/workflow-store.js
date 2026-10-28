import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { assertCompleteRows, createMutationQueue } from '../events/safety.js';
import { assertRequestActive } from '../http/request-budget.js';

export const MATERIAL_WORKFLOW_TABLE = '平台物资登记表';
export const MATERIAL_WORKFLOW_COLUMNS = Object.freeze({ '登记ID': 'text', '登记类型': 'text', '版本': 'number', '内容': 'long-text', '摘要': 'text' });
export const materialDigest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function materialFailure(statusCode, message, code = 'materials_workflow_invalid') {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Table owns business records. SQLite stores only write intents/recovery receipts,
 * like the existing material-receipts.sqlite, never an alternative inventory. */
export function openMaterialWorkflowStore({ file, getClient, listRows }) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS commands (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT)');
  const queue = createMutationQueue();
  const select = db.prepare('SELECT fingerprint, result FROM commands WHERE key=?');
  async function once(key, fingerprint, task, reconcile = async () => null) {
    assertRequestActive();
    const previous = select.get(key);
    if (previous && previous.fingerprint !== fingerprint) throw materialFailure(409, '操作标识已用于不同内容，请核对原记录。');
    if (previous?.result !== null && previous?.result !== undefined) return JSON.parse(previous.result);
    if (previous) {
      const found = await reconcile();
      if (!found) throw materialFailure(409, '原操作的保存结果待核查，请联系管理员，勿重复新增。', 'materials_write_uncertain');
      db.prepare('UPDATE commands SET result=? WHERE key=?').run(JSON.stringify(found), key);
      return found;
    }
    assertRequestActive();
    db.prepare('INSERT INTO commands VALUES (?, ?, NULL)').run(key, fingerprint);
    let result;
    try { result = await task(); }
    catch {
      result = await reconcile();
      if (!result) throw materialFailure(503, '操作保存结果尚未确认，请保留原内容重试或联系管理员核查。', 'materials_write_uncertain');
    }
    if (!result || typeof result !== 'object') throw materialFailure(503, '数据服务未确认保存结果。', 'materials_write_uncertain');
    db.prepare('UPDATE commands SET result=? WHERE key=?').run(JSON.stringify(result), key);
    return result;
  }
  async function inspect() {
    const metadata = await (await getClient()).getMetadata();
    const matches = (metadata?.metadata || metadata)?.tables?.filter(table => table.name === MATERIAL_WORKFLOW_TABLE) || [];
    const ready = matches.length === 1 && Object.entries(MATERIAL_WORKFLOW_COLUMNS).every(([name, type]) => matches[0].columns?.filter(c => c.name === name && c.type === type).length === 1);
    return { ready, code: ready ? '' : 'materials_schema_pending' };
  }
  async function entries(required = true) {
    if (!(await inspect()).ready) {
      if (required) throw materialFailure(503, '物资登记存储尚未就绪，请联系管理员完成配置。', 'materials_schema_pending');
      return { ready: false, records: [] };
    }
    const rows = await listRows(await getClient(), MATERIAL_WORKFLOW_TABLE); assertCompleteRows(rows);
    const seen = new Set();
    const records = rows.map(row => {
      if (!row._id || seen.has(row['登记ID']) || !Number.isSafeInteger(row['版本']) || row['版本'] < 1 || typeof row['内容'] !== 'string' || row['内容'].length > 48000 || materialDigest(row['内容']) !== row['摘要'])
        throw materialFailure(503, '物资登记记录不完整或冲突，请联系管理员核对。', 'materials_record_conflict');
      seen.add(row['登记ID']);
      let document; try { document = JSON.parse(row['内容']); } catch { throw materialFailure(503, '物资登记记录无法读取。', 'materials_record_conflict'); }
      if (!document || document.id !== row['登记ID'] || document.kind !== row['登记类型']) throw materialFailure(503, '物资登记标识不一致。', 'materials_record_conflict');
      return { rowId: row._id, version: row['版本'], document };
    });
    return { ready: true, records };
  }
  async function get(id) { return (await entries()).records.find(entry => entry.document.id === id) || null; }
  function save(document, version = 0) {
    return queue(async () => {
      if (!document || typeof document.id !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(document.id) || !['return', 'inbound', 'asset', 'create'].includes(document.kind)) throw materialFailure(400, '物资登记格式不正确。');
      const raw = JSON.stringify(document); if (raw.length > 48000) throw materialFailure(413, '该物资登记记录已达容量上限。');
      const digest = materialDigest(raw), current = await get(document.id);
      if (current?.version === version + 1 && materialDigest(JSON.stringify(current.document)) === digest) return current;
      if ((current?.version || 0) !== version) throw materialFailure(409, '记录已变化，请刷新后重试。');
      const row = { '登记ID': document.id, '登记类型': document.kind, '版本': version + 1, '内容': raw, '摘要': digest };
      const client = await getClient();
      const confirm = async () => { const saved = await get(document.id); return saved?.version === version + 1 && materialDigest(JSON.stringify(saved.document)) === digest ? saved : null; };
      const task = async () => {
        assertRequestActive();
        if (current) await client.updateRow(MATERIAL_WORKFLOW_TABLE, current.rowId, row);
        else await client.appendRow(MATERIAL_WORKFLOW_TABLE, row);
        return confirm();
      };
      // Setting an exact, known row is idempotent. An unknown append is never blindly repeated.
      return current ? (await task() || Promise.reject(materialFailure(503, '保存结果待核对。')))
        : once(`record:${document.id}`, digest, task, confirm);
    });
  }
  return { inspect, entries, get, save, once, close: () => db.close() };
}
