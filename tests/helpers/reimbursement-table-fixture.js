import { Buffer } from 'node:buffer';
import { REIMBURSEMENT_SCHEMA, FINANCE_TABLES } from '../../lib/reimbursements/table-schema.js';
import { createReimbursementTableStore } from '../../lib/reimbursements/table-store.js';
import { createTableReimbursementService } from '../../lib/reimbursements/table-service.js';
import { processPdfs } from '../../lib/reimbursements/pdf.js';
import { generateItemPackets } from '../../lib/reimbursements/item-packets.js';
import { reimbursementBoxFixture } from './reimbursement-box-fixture.js';

const clone = value => JSON.parse(JSON.stringify(value));
export function reimbursementTableFixture() {
  const rows = new Map(REIMBURSEMENT_SCHEMA.map(table => [table.name, []])), objects = new Map(), calls = [], queries = [];
  const state = { boxReady: true, failFiles: false, beforeTable: null, afterTable: null, hideTable: null, reads: 0, pending: null };
  const metadata = { tables: REIMBURSEMENT_SCHEMA.map(table => ({ name: table.name,
    columns: Object.entries(table.columns).map(([name, type]) => ({ name, type })) })) };
  const client = {
    async query(sql) {
      const match = sql.match(/^SELECT (.+) FROM `([^`]+)` WHERE (.+?)(?: ORDER BY `序号` (ASC|DESC))? LIMIT (\d+)$/);
      if (!match || !rows.has(match[2])) throw Error('Unexpected synthetic finance query');
      const [, columns, table, where, order, rawLimit] = match, limit = Number(rawLimit);
      let result = state.hideTable === table ? [] : [...rows.get(table)];
      const after = where.match(/^`序号` > (\d+)$/), keys = where.match(/^`([^`]+)` IN \((.*)\)$/);
      if (after) result = result.filter(row => row['序号'] > Number(after[1]));
      else if (keys) {
        const wanted = [...keys[2].matchAll(/'([A-Za-z0-9:_-]+)'/g)].map(match => match[1]);
        result = result.filter(row => wanted.includes(row[keys[1]]));
      } else throw Error('Missing targeted synthetic predicate');
      if (order) result.sort((a, b) => (a['序号'] - b['序号']) * (order === 'DESC' ? -1 : 1));
      const selected = result.slice(0, limit), fields = columns.split(', ').map(name => name.slice(1, -1));
      queries.push({ table, sql, limit, matched: result.length, returned: selected.length });
      return clone(selected.map(row => Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field]]))));
    },
    async getMetadata() { return clone(metadata); },
    async listRows() { throw Error('Synthetic finance forbids full-table listRows'); },
    async appendRow(table, data) {
      calls.push({ table, operation: 'append' });
      if (state.beforeTable === table) throw Error('synthetic failure before write');
      const row = { _id: `synthetic-${table}-${rows.get(table).length}`, ...clone(data) }; rows.get(table).push(row);
      if (state.afterTable === table) throw Error('synthetic acknowledgement lost');
      return { _id: row._id };
    },
    async updateRow(table, id, data) {
      calls.push({ table, operation: 'update' });
      if (state.beforeTable === table) throw Error('synthetic failure before write');
      Object.assign(rows.get(table).find(row => row._id === id), clone(data));
      if (state.afterTable === table) throw Error('synthetic acknowledgement lost');
      return { success: true };
    },
  };
  const box = reimbursementBoxFixture({ objects, state }), files = box.makeFiles();
  const fence = { async read() { return state.pending; }, async save(value) { if (state.pending) throw Error('synthetic fence exists'); state.pending = value; },
    async clear(id) { if (state.pending?.id === id) state.pending = null; } };
  const makeStore = (allowWrites = true) => createReimbursementTableStore({ getClient: async () => client, allowWrites, fence });
  const makeService = (options = {}) => createTableReimbursementService({ store: makeStore(), files: box.makeFiles(), workflowVersion: 2, processFiles: processPdfs,
    generatePackets: generateItemPackets, now: () => '2026-10-22T00:00:00Z', analyzePage: async () => ({ buyer: { state: 'unknown', message: '合成未识别' }, seal: { state: 'unknown', regions: [], message: '合成未识别' } }),
    generateSummary: async () => ({ formPdf: Buffer.from('synthetic-form'), packetPdf: Buffer.from('synthetic-packet'), formPages: 1, packetPages: 1, attachments: [] }), ...options });
  return { rows, objects, calls, queries, state, metadata, client, files, box, makeStore, makeService, tables: FINANCE_TABLES };
}
