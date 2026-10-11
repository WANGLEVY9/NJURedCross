import { Base } from 'seatable-api';
import { pathToFileURL } from 'node:url';
import { createSeaTableAccess } from '../lib/seatable-auth.js';
import { MESSAGE_TABLE, MESSAGE_COLUMNS, messageSchemaReady } from '../lib/community/messages.js';

/** Additive only: never rename/drop a table, migrate rows, or insert fixtures. */
export async function ensureMessageSchema(base, { expectedUuid, apply = false, confirm = '' } = {}) {
  if (!expectedUuid || base.dtableUuid !== expectedUuid) throw Error('Business Base mismatch; no changes made');
  const tables = (await base.getMetadata()).tables || [];
  if (tables.some(table => table.name === '红会语录墙')) {
    throw Error('Legacy quote table exists; review migration before creating a parallel message table');
  }
  if (tables.some(table => table.name === MESSAGE_TABLE)) {
    if (!await messageSchemaReady(base)) throw Error('Existing message schema is incomplete; no changes made');
    return { table: MESSAGE_TABLE, ready: true, created: false, write: false };
  }
  const plan = { create: MESSAGE_TABLE, columns: MESSAGE_COLUMNS, baseUuid: expectedUuid, write: false };
  if (!apply) return plan;
  if (confirm !== 'CREATE-MESSAGE-WALL') throw Error('Missing schema confirmation');
  await base.addTable(MESSAGE_TABLE, 'zh-cn', MESSAGE_COLUMNS.map((name, index) => ({
    column_name: name, column_type: 'text', anchor_column: index ? MESSAGE_COLUMNS[index - 1] : '',
  })));
  if (!await messageSchemaReady(base)) throw Error('Message schema verification failed; inspect created table');
  return { table: MESSAGE_TABLE, ready: true, created: true, write: true, contentInserted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const flags = process.argv.slice(2);
    if (flags.some(flag => !['--apply', '--confirm=CREATE-MESSAGE-WALL'].includes(flag))) throw Error('Unknown flag');
    const base = new Base({ server: process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn', APIToken: process.env.SEATABLE_API_TOKEN });
    await createSeaTableAccess(base)();
    console.log(JSON.stringify(await ensureMessageSchema(base, {
      expectedUuid: process.env.SEATABLE_BUSINESS_BASE_UUID,
      apply: flags.includes('--apply'),
      confirm: flags.includes('--confirm=CREATE-MESSAGE-WALL') ? 'CREATE-MESSAGE-WALL' : '',
    })));
  } catch (error) {
    // SDK errors can contain Token-bearing request configs. Only local errors are printable.
    const safeMessages = ['Business Base mismatch; no changes made',
      'Legacy quote table exists; review migration before creating a parallel message table',
      'Existing message schema is incomplete; no changes made', 'Missing schema confirmation',
      'Message schema verification failed; inspect created table', 'Unknown flag'];
    const message = safeMessages.includes(error.message) ? error.message : 'SeaTable schema request failed; raw error suppressed';
    console.error(JSON.stringify({ ok: false, status: error.response?.status || null, message }));
    process.exitCode = 1;
  }
}
