import { MORNING_SCHEMA } from '../lib/morning/schema.js';
import { BIRTHDAY_TABLE_NAMES } from '../lib/community/birthday-rollout.js';
import { STATE_SCHEMA } from '../lib/production-schema.js';

// The local SeaTable substitute must use declared types, never infer a date
// from an ISO-looking string. SeaTable's SDK formats date columns to a day
// unless their date format also includes time, which destroys lease expiry.
const textColumns = new Map([
  ...MORNING_SCHEMA,
  ...STATE_SCHEMA.filter(table => BIRTHDAY_TABLE_NAMES.includes(table.name)),
].map(table => [table.name, new Set(table.columns)]));

export function localCommunityColumnType(table, column, fallback = 'text') {
  return textColumns.get(table)?.has(column) ? 'text' : fallback;
}
