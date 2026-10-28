import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureReimbursementSchema } from '../lib/reimbursements/schema-setup.js';
import { REIMBURSEMENT_SCHEMA } from '../lib/reimbursements/table-schema.js';
const options = { expectedUuid: 'synthetic-base', apply: true, confirmation: 'ADD-REIMBURSEMENT-SCHEMA' };
function fixture() {
  const newColumns = new Set(['平台申请ID', '平台版本', '平台状态', '平台投影摘要', '原件引用', '合并件引用', '平台汇总ID', '材料引用']);
  const metadata = { tables: REIMBURSEMENT_SCHEMA.slice(2).map(table => ({ name: table.name,
    columns: Object.entries(table.columns).filter(([name]) => !newColumns.has(name)).map(([name, type]) => ({ name, type, key: `synthetic-${name}` })) })) };
  metadata.tables.push({ name: '其他业务表', columns: [{ name: '不要改动', type: 'text', key: 'synthetic-other' }] });
  const calls = [], state = { loseAck: false, reject: false };
  const client = { dtableUuid: options.expectedUuid, async getMetadata() { return structuredClone(metadata); },
    async addTable(name, _lang, columns) {
      calls.push(['table', name]); if (state.reject) throw new Error();
      metadata.tables.push({ name, columns: columns.map(column => ({ name: column.column_name, type: column.column_type })) });
      if (state.loseAck) throw new Error();
    }, async insertColumn(table, name, type) {
      calls.push(['column', table, name]); if (state.reject) throw new Error();
      metadata.tables.find(item => item.name === table).columns.push({ name, type }); if (state.loseAck) throw new Error();
    }, async appendRow() { throw new Error('row writes forbidden'); }, async updateRow() { throw new Error('row writes forbidden'); } };
  return { metadata, calls, state, client };
}
test('schema preview is additive and apply preserves existing columns and becomes idempotent', async () => {
  const f = fixture(), other = structuredClone(f.metadata.tables.at(-1));
  const preview = await ensureReimbursementSchema(f.client, { expectedUuid: options.expectedUuid });
  assert.equal(preview.plan.filter(item => item.action === 'add-table').length, 2);
  assert.equal(preview.plan.filter(item => item.action === 'add-column').length, 9); assert.equal(f.calls.length, 0);
  const result = await ensureReimbursementSchema(f.client, options); assert.equal(result.ready, true); assert.equal(result.rowWrites, 0);
  assert.deepEqual(f.metadata.tables.find(table => table.name === other.name), other); assert.equal(f.calls.length, 11);
  assert.equal((await ensureReimbursementSchema(f.client, options)).performed.length, 0); assert.equal(f.calls.length, 11);
});
test('wrong base, missing confirmation, duplicate names and incompatible types stop before writes', async () => {
  for (const setup of ['base', 'confirmation', 'duplicate', 'type']) {
    const f = fixture(), input = { ...options };
    if (setup === 'base') input.expectedUuid = 'other-base';
    if (setup === 'confirmation') input.confirmation = '';
    if (setup === 'duplicate') f.metadata.tables.push(structuredClone(f.metadata.tables[0]));
    if (setup === 'type') f.metadata.tables[0].columns[0].type = 'number';
    await assert.rejects(ensureReimbursementSchema(f.client, input)); assert.equal(f.calls.length, 0);
  }
});
test('lost schema acknowledgement reconciles without duplicate writes; failed creation stops', async () => {
  const accepted = fixture(); accepted.state.loseAck = true;
  assert.equal((await ensureReimbursementSchema(accepted.client, options)).ready, true); assert.equal(accepted.calls.length, 11);
  const rejected = fixture(); rejected.state.reject = true;
  await assert.rejects(ensureReimbursementSchema(rejected.client, options), { code: 'reimbursement_schema_addition_unconfirmed' });
  assert.equal(rejected.calls.length, 1);
});
