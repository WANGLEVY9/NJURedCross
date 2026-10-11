import { STATE_SCHEMA } from '../production-schema.js';

export const BIRTHDAY_TABLE_NAMES = Object.freeze([
  '温暖连接参加表', '温暖连接投稿表', '温暖祝福库表', '温暖祝福投递表',
  '温暖祝福举报表', '温暖连接黑名单表', '温暖连接操作锁表',
]);

/** Deployment is inert until deliberately enabled; importing never contacts NJUTable. */
export function birthdayRolloutConfig(env = {}) {
  const enabled = env.WARMTH_BIRTHDAY_ENABLED === 'true';
  return Object.freeze({ enabled, automaticDelivery: enabled && env.WARMTH_DELIVERY_ENABLED === 'true' });
}

/** Metadata only. Existing columns and rows are never altered by this checker. */
export function inspectBirthdaySchema(metadata) {
  const tables = new Map((metadata?.tables || []).map(table => [table.name, table]));
  const checks = BIRTHDAY_TABLE_NAMES.map(name => {
    const definition = STATE_SCHEMA.find(item => item.name === name);
    const table = tables.get(name);
    const columns = new Set((table?.columns || []).map(column => column.name));
    return { name, exists: Boolean(table), missingColumns: definition.columns.filter(column => !columns.has(column)) };
  });
  return { ready: checks.every(check => check.exists && !check.missingColumns.length), checks };
}
