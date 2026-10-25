import { STATE_SCHEMA } from '../production-schema.js';
import { BIRTHDAY_TABLE_NAMES } from './birthday-rollout.js';

export const PRODUCTION_MANAGEMENT_BASE = '076b49ed-6f04-4ea6-8799-1b9ad71dba88';
const existingRequired = new Set(['温暖连接参加表', '温暖连接投稿表']);
const submissionExtensions = new Set(['署名昵称', '投递方式', '目标学号', '投递条件', '附件']);

/** Additive and limited to the birthday module. Existing column types are never changed. */
export function planBirthdaySchema(metadata) {
  const current = new Map((metadata?.tables || []).map(table => [table.name, table]));
  return BIRTHDAY_TABLE_NAMES.map(name => {
    const definition = STATE_SCHEMA.find(table => table.name === name);
    const table = current.get(name);
    if (!table && existingRequired.has(name)) throw new Error('birthday_existing_table_missing');
    const missing = [];
    for (const columnName of definition.columns) {
      const column = table?.columns.find(item => item.name === columnName);
      if (column && column.type !== 'text') throw new Error('birthday_column_type_mismatch');
      if (!column) missing.push(columnName);
    }
    if (name === '温暖连接参加表' && missing.length) throw new Error('birthday_participation_schema_incomplete');
    if (name === '温暖连接投稿表' && missing.some(column => !submissionExtensions.has(column))) {
      throw new Error('birthday_legacy_submission_schema_incomplete');
    }
    return { name, create: !table, columns: missing };
  });
}
