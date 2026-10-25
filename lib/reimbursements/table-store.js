import { randomUUID } from 'node:crypto';
import { readFinanceMatches, readFinanceJournal } from './table-query.js';
import { assertRequestActive } from '../http/request-budget.js';
import { STATE_MAPS } from './state.js';
import { checksum, emptyDocument, storageFailure } from './material-codec.js';
import { FINANCE_TABLES, requireReimbursementSchema, inspectReimbursementSchema } from './table-schema.js';
import { projectFinancialRows, affectedFinancialRows } from './table-projection.js';

const CHUNK_LENGTH = 48000, MAX_CHUNKS = 128;
const eventHash = row => checksum(JSON.stringify([row['事务ID'], row['序号'], row['前序摘要'], row['内容']]));
function applyDelta(document, delta, maps) {
  if (delta?.format !== 1 || !Number.isSafeInteger(delta.storedBytes) || delta.storedBytes < 0 || !Array.isArray(delta.changes)) throw storageFailure();
  document.storedBytes = delta.storedBytes;
  for (const change of delta.changes) {
    if (!STATE_MAPS.includes(change.map) || typeof change.key !== 'string') throw storageFailure();
    const map = maps[change.map];
    if (change.deleted === true) map.delete(change.key); else map.set(change.key, change.value);
  }
}
function changesBetween(before, after) {
  const changes = [];
  for (const name of STATE_MAPS) {
    const previous = new Map(before.maps[name]), current = new Map(after.maps[name]);
    for (const [key, value] of current) if (JSON.stringify(previous.get(key)) !== JSON.stringify(value)) changes.push({ map: name, key, value });
    for (const key of previous.keys()) if (!current.has(key)) changes.push({ map: name, key, deleted: true });
  }
  return { format: 1, storedBytes: after.storedBytes, changes };
}

/** Append-only metadata commit. Never relies on a nonexistent cross-table
 * transaction in NJUTable. Unpublished data chunks are not business records. */
export function createReimbursementTableStore({ getClient, allowWrites = false, fence, readCacheMs = 1500, now = Date.now }) {
  let cached = null, cachedAt = 0, pendingRead = null, schemaAt = null;
  const dirty = { requests: new Set(), summaries: new Set() };
  function markDirty(document, changes) {
    const affected = affectedFinancialRows(document, changes);
    for (const name of ['requests', 'summaries']) for (const id of affected[name]) dirty[name].add(id);
  }
  async function syncMirrors(client, document) {
    await projectFinancialRows(client, document, fence, dirty);
    dirty.requests.clear(); dirty.summaries.clear();
  }
  const assertWritable = () => { if (allowWrites !== true) throw storageFailure('reimbursement_writes_disabled'); };
  async function inspect() { return inspectReimbursementSchema(await (await getClient()).getMetadata()); }
  async function load({ fresh = true } = {}) {
    if (!fresh && cached && now() - cachedAt < readCacheMs) return structuredClone(cached);
    if (pendingRead) { await pendingRead; return fresh ? load({ fresh: true }) : structuredClone(cached); }
    pendingRead = readIncremental(fresh);
    try { return structuredClone(await pendingRead); } finally { pendingRead = null; }
  }
  async function readIncremental(fresh) {
    const client = await getClient();
    if (fresh || schemaAt === null || now() - schemaAt >= 60_000) {
      requireReimbursementSchema(await client.getMetadata()); schemaAt = now();
    }
    const head = await readFinanceJournal(client, { head: true });
    if (head.length === 2 && head[0]['序号'] === head[1]['序号']) throw storageFailure('reimbursement_journal_conflict');
    const version = cached?.version || 0, latest = head[0]?.['序号'] || 0;
    if (latest - version > 50_000) throw storageFailure('reimbursement_replay_capacity');
    if (latest < version) throw storageFailure('reimbursement_journal_conflict');
    if (latest === version && cached) {
      if (latest && (head[0]['摘要'] !== cached.digest || head[0]['事务ID'] !== cached.eventIds.at(-1)
        || head[0]['摘要'] !== eventHash(head[0]))) throw storageFailure('reimbursement_journal_conflict');
      cachedAt = now(); return cached;
    }
    const document = cached ? structuredClone(cached.document) : emptyDocument();
    const maps = Object.fromEntries(STATE_MAPS.map(name => [name, new Map(document.maps[name])]));
    const ids = new Set(cached?.eventIds || []), events = [...(cached?.events || [])], changed = [];
    let cursor = version, digest = cached?.digest || '';
    while (cursor < latest) {
      const fetched = await readFinanceJournal(client, { after: cursor }), batch = [];
      if (!fetched.length) throw storageFailure('reimbursement_journal_conflict');
      const manifests = new Map(), blockKeys = new Set();
      let chunkCount = 0;
      for (const row of fetched) {
        if (row['序号'] > latest) break;
        let manifest;
        try {
          manifest = JSON.parse(row['内容']);
          if (manifest.format !== 1 || !Array.isArray(manifest.chunks) || !manifest.chunks.length || manifest.chunks.length > MAX_CHUNKS
            || manifest.chunks.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) throw new Error();
        } catch { throw storageFailure('reimbursement_chunk_corrupt'); }
        if (batch.length && chunkCount + manifest.chunks.length > 256) break;
        batch.push(row); chunkCount += manifest.chunks.length;
        manifests.set(row._id, manifest); manifest.chunks.forEach(key => blockKeys.add(key));
      }
      const blocks = new Map();
      for (const block of await readFinanceMatches(client, FINANCE_TABLES.chunks, '块ID', [...blockKeys])) {
        const key = block['块ID'];
        if (!blocks.has(key)) blocks.set(key, []); blocks.get(key).push(block);
      }
      for (const row of batch) {
        if (row['序号'] !== cursor + 1 || row['前序摘要'] !== digest || typeof row['事务ID'] !== 'string'
          || ids.has(row['事务ID']) || row['摘要'] !== eventHash(row)) throw storageFailure('reimbursement_journal_conflict');
        let delta;
        try {
          const manifest = manifests.get(row._id), contents = manifest.chunks.map(key => {
            const candidates = blocks.get(key);
            if (!candidates?.length || candidates.some(block => typeof block['内容'] !== 'string' || block['内容'].length > CHUNK_LENGTH
              || checksum(block['内容']) !== key || block['摘要'] !== key || block['内容'] !== candidates[0]['内容'])) throw new Error();
            return candidates[0]['内容'];
          });
          const bytes = Buffer.from(contents.join(''), 'base64');
          if (checksum(bytes) !== manifest.hash) throw new Error(); delta = JSON.parse(bytes.toString('utf8'));
        } catch { throw storageFailure('reimbursement_chunk_corrupt'); }
        applyDelta(document, delta, maps); changed.push(...delta.changes);
        cursor++; digest = row['摘要']; ids.add(row['事务ID']);
        events.push({ id: row['事务ID'], version: cursor, digest });
        if (cursor >= latest) break;
      }
    }
    // Independently checked head anchors the upper bound, including a concurrent read.
    if (latest && (cursor !== latest || digest !== head[0]['摘要'] || events.at(-1)?.id !== head[0]['事务ID']))
      throw storageFailure('reimbursement_journal_conflict');
    document.maps = Object.fromEntries(STATE_MAPS.map(name => [name, [...maps[name]]]));
    markDirty(document, changed);
    cached = { document, version: cursor, digest, eventIds: [...ids], events }; cachedAt = now();
    return cached;
  }

  async function prepareWrite() {
    assertWritable();
    if (!fence?.read || !fence?.save || !fence?.clear) throw storageFailure('reimbursement_fence_required');
    const previous = await load(), pending = await fence.read();
    if (pending) {
      if (pending.projection) {
        const { table, idField } = pending.projection;
        if (!(table === FINANCE_TABLES.requests && idField === '平台申请ID' || table === FINANCE_TABLES.summaries && idField === '平台汇总ID')) throw storageFailure('reimbursement_fence_invalid');
        const matches = await readFinanceMatches(await getClient(), table, idField, [pending.id]);
        if (matches.length !== 1 || matches[0]['平台投影摘要'] !== pending.digest) throw storageFailure('reimbursement_projection_pending');
      } else if (!previous.events?.some(event => event.id === pending.id && event.version === pending.version && event.digest === pending.digest)) throw storageFailure('reimbursement_commit_unknown');
      await fence.clear(pending.id);
    }
    return previous;
  }
  async function commit(document, previous) {
    assertWritable(); assertRequestActive();
    const client = await getClient(), fresh = await prepareWrite();
    if (fresh.version !== previous.version || fresh.digest !== previous.digest) throw Object.assign(new Error('报销记录已变化，请刷新后重试。'), { statusCode: 409 });
    const delta = changesBetween(previous.document, document);
    if (!delta.changes.length && delta.storedBytes === previous.document.storedBytes) {
      await syncMirrors(client, document); return;
    }
    const bytes = Buffer.from(JSON.stringify(delta)), encoded = bytes.toString('base64');
    if (encoded.length > CHUNK_LENGTH * MAX_CHUNKS) throw Object.assign(new Error('本次报销元数据过大，请分批处理。'), { statusCode: 413 });
    const blocks = encoded.match(/.{1,48000}/g), known = new Set();
    const matching = await readFinanceMatches(client, FINANCE_TABLES.chunks, '块ID', blocks.map(checksum));
    for (const block of matching) {
      if (block['摘要'] !== block['块ID'] || checksum(block['内容'] || '') !== block['块ID']) throw storageFailure('reimbursement_chunk_corrupt');
      known.add(block['块ID']);
    }
    const now = new Date().toISOString(), keys = [];
    for (const content of blocks) {
      const key = checksum(content); keys.push(key);
      if (known.has(key)) continue;
      assertRequestActive();
      try { await client.appendRow(FINANCE_TABLES.chunks, { '块ID': key, '摘要': key, '内容': content, '写入时间': now }, false); known.add(key); }
      catch { throw storageFailure('reimbursement_chunk_save_failed'); }
    }
    assertRequestActive();
    const event = { '事务ID': randomUUID(), '序号': previous.version + 1, '前序摘要': previous.digest,
      '内容': JSON.stringify({ format: 1, hash: checksum(bytes), chunks: keys }), '写入时间': now };
    event['摘要'] = eventHash(event);
    await fence.save({ id: event['事务ID'], version: event['序号'], digest: event['摘要'] });
    try { await client.appendRow(FINANCE_TABLES.journal, event, false); } catch { /* Reconcile the same ID; never blindly append again. */ }
    const accepted = await load();
    if (!accepted.eventIds.includes(event['事务ID']) || accepted.version !== event['序号'] || accepted.digest !== event['摘要']) throw storageFailure('reimbursement_commit_unconfirmed');
    await fence.clear(event['事务ID']);
    // A projection failure is reported, but the accepted journal is retained.
    // Submission/payment receipts restore after restart and make retries safe.
    await syncMirrors(client, accepted.document);
  }
  return { load, commit, inspect, assertWritable, prepareWrite };
}
