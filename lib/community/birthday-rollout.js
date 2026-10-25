import { STATE_SCHEMA } from '../production-schema.js';
import { FRIEND_BLESSING_COLUMNS } from './friend-blessings.js';

export const BIRTHDAY_TABLE_NAMES = Object.freeze([
  '温暖连接参加表', '温暖连接投稿表', '温暖祝福库表', '温暖祝福投递表',
  '温暖祝福举报表', '温暖连接黑名单表', '温暖连接操作锁表',
]);

/** Deployment is inert until deliberately enabled; importing never contacts NJUTable. */
export function birthdayRolloutConfig(env = {}) {
  const enabled = env.WARMTH_BIRTHDAY_ENABLED === 'true';
  return Object.freeze({ enabled, automaticDelivery: enabled && env.WARMTH_DELIVERY_ENABLED === 'true' });
}

export function inspectBirthdaySchema(metadata) {
  const tables = new Map((metadata?.tables || []).map(table => [table.name, table]));
  const checks = BIRTHDAY_TABLE_NAMES.map(name => {
    const original = STATE_SCHEMA.find(item => item.name === name);
    // The new optional delivery mode must not take existing birthday features offline.
    const definition = name === '温暖连接投稿表'
      ? { ...original, columns: original.columns.filter(column => !FRIEND_BLESSING_COLUMNS.includes(column)) } : original;
    const table = tables.get(name);
    const columns = new Map((table?.columns || []).map(column => [column.name, column]));
    const invalidColumns = definition.columns.filter(name => columns.has(name) && columns.get(name).type !== 'text')
      .map(name => ({ name, expected: 'text', actual: columns.get(name).type ?? null }));
    return { name, exists: Boolean(table), missingColumns: definition.columns.filter(column => !columns.has(column)), invalidColumns };
  });
  return { ready: checks.every(check => check.exists && !check.missingColumns.length && !check.invalidColumns.length), checks };
}
