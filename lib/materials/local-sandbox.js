import { randomUUID } from 'node:crypto';
import { MATERIAL_SOURCE_TABLES } from './source-reader.js';

/** Accepts data only, never a reader, SDK, credential or remote write callback. */
export function createMaterialsSandbox(snapshot) {
  const metadata = { tables: structuredClone(snapshot.tables) };
  let rows = structuredClone(snapshot.rows);
  for (const name of MATERIAL_SOURCE_TABLES) {
    if (!metadata.tables.some(table => table.name === name) || !Array.isArray(rows[name])) throw new Error('本地开发副本缺少物资表');
    const ids = rows[name].map(row => row._id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('本地开发副本的记录编号不完整');
  }
  const tableRows = table => {
    if (!MATERIAL_SOURCE_TABLES.includes(table)) throw new Error('仅支持本地物资表');
    return rows[table];
  };
  const client = Object.freeze({
    getMetadata: async () => structuredClone(metadata),
    listRows: async (table, _view, _order, _convert, start = 0, limit = 500) => structuredClone(tableRows(table).slice(start, start + limit)),
    appendRow: async (table, row) => {
      const id = `local-${randomUUID()}`;
      tableRows(table).push({ ...structuredClone(row), _id: id, _mtime: new Date().toISOString() });
      return { _id: id };
    },
    updateRow: async (table, id, patch) => {
      const row = tableRows(table).find(item => item._id === id);
      if (!row) throw new Error('本地记录不存在');
      Object.assign(row, structuredClone(patch)); return { _id: id };
    },
  });
  return { client, listRows: async table => {
    const result = structuredClone(tableRows(table));
    Object.defineProperty(result, 'readMeta', { value: { total: result.length, truncated: false, maxRows: null } });
    return result;
  }, snapshot: () => structuredClone(rows), restore: value => { rows = structuredClone(value); } };
}
