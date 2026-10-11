import { MESSAGE_TABLE, MESSAGE_COLUMNS } from '../lib/community/messages.js';

// Rename in place: keep table/column keys, rows, links and views intact.
export async function migrateMessageSchema(base, { expectedUuid, apply = false, confirm = '' } = {}) {
  if (!expectedUuid || base.dtableUuid !== expectedUuid) throw Error('Business Base mismatch');
  const tables = (await base.getMetadata()).tables || [];
  const old = tables.find(t => t.name === '红会语录墙');
  const current = tables.find(t => t.name === MESSAGE_TABLE);
  if (old && current) throw Error('Both tables exist; manual reconciliation required');
  const table = old || current;
  if (!table) throw Error('No wall table exists');
  const id = table.columns.find(c => c.name === '语录ID');
  if (!table._id || (id && !id.key)) throw Error('Missing stable schema keys');
  if (id && table.columns.some(c => c.name === '留言ID')) throw Error('Both ID columns exist');
  for (const name of MESSAGE_COLUMNS) {
    const column = table.columns.find(c => c.name === name || (name === '留言ID' && c.name === '语录ID'));
    if (!column || column.type !== 'text') throw Error('Unexpected wall schema');
  }
  const plan = { baseUuid: expectedUuid, tableId: table._id, renameTable: !!old, renameId: !!id, write: false };
  if (!apply || (!old && !id)) return plan;
  if (confirm !== 'RENAME-MESSAGE-WALL') throw Error('Missing migration confirmation');
  if (old) await base.renameTable(old.name, MESSAGE_TABLE);
  if (id) await base.renameColumn(MESSAGE_TABLE, id.key, '留言ID');
  const updated = (await base.getMetadata()).tables.find(t => t.name === MESSAGE_TABLE);
  if (!updated || updated._id !== table._id || !MESSAGE_COLUMNS.every(name => updated.columns.some(c => c.name === name && c.type === 'text'))) throw Error('Migration verification failed');
  return { ...plan, write: true, verified: true, rowsModified: false };
}
