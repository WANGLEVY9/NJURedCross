import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateMessageSchema } from '../scripts/migrate-message-schema.mjs';
import { MESSAGE_COLUMNS } from '../lib/community/messages.js';

function fixture() {
  const table = { _id: 'wall', name: '红会语录墙', columns: MESSAGE_COLUMNS.map((name, i) => ({ key: `c${i}`, name: i ? name : '语录ID', type: 'text' })) };
  const tables = [table];
  const writes = [];
  const base = { dtableUuid: 'fixture', getMetadata: async () => ({ tables: structuredClone(tables) }),
    renameTable: async (old, name) => { assert.equal(old, table.name); table.name = name; writes.push('table'); },
    renameColumn: async (name, key, label) => { assert.equal(name, table.name); table.columns.find(c => c.key === key).name = label; writes.push('column'); } };
  return { base, tables, writes, table };
}
test('wall migration previews, renames in place and is idempotent', async () => {
  const f = fixture(); const options = { expectedUuid: 'fixture' };
  assert.equal((await migrateMessageSchema(f.base, options)).write, false);
  assert.deepEqual(f.writes, []);
  await assert.rejects(migrateMessageSchema(f.base, { ...options, apply: true }), /confirmation/);
  assert.equal((await migrateMessageSchema(f.base, { ...options, apply: true, confirm: 'RENAME-MESSAGE-WALL' })).verified, true);
  assert.equal(f.table._id, 'wall'); assert.equal(f.table.columns[0].key, 'c0');
  await migrateMessageSchema(f.base, { ...options, apply: true });
  assert.deepEqual(f.writes, ['table', 'column']);
});
test('wall migration refuses wrong Base, parallel tables and schema conflicts', async () => {
  const f = fixture();
  await assert.rejects(migrateMessageSchema(f.base, { expectedUuid: 'wrong', apply: true }), /mismatch/);
  f.tables.push({ name: '红会留言墙' });
  await assert.rejects(migrateMessageSchema(f.base, { expectedUuid: 'fixture' }), /Both tables/);
  f.tables.pop(); f.table.columns[0].type = 'number';
  await assert.rejects(migrateMessageSchema(f.base, { expectedUuid: 'fixture' }), /schema/);
  assert.deepEqual(f.writes, []);
});
test('wall migration resumes after only table rename completed', async () => {
  const f = fixture(); f.table.name = '红会留言墙';
  await migrateMessageSchema(f.base, { expectedUuid: 'fixture', apply: true, confirm: 'RENAME-MESSAGE-WALL' });
  assert.deepEqual(f.writes, ['column']);
});
