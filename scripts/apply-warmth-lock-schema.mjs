import { STATE_SCHEMA } from '../lib/production-schema.js';
import { Base } from 'seatable-api';

const targetName = '温暖连接操作锁表';
const definition = STATE_SCHEMA.find((item) => item.name === targetName);
if (!definition) throw new Error(`Schema definition missing: ${targetName}`);

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-WARMTH-LOCK-TABLE';

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const base = new Base({ server, APIToken: token });
await base.auth();
const metadata = await base.getMetadata();
const exists = (metadata?.tables || []).some((table) => table.name === targetName);

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  writes: apply && !exists,
  target: targetName,
  columns: definition.columns,
  exists,
  requiredConfirmation,
}, null, 2));

if (!apply || exists) process.exit(0);

const columns = definition.columns.map((name, index) => ({
  column_name: name,
  column_type: 'text',
  anchor_column: index === 0 ? '' : definition.columns[index - 1],
}));
await base.addTable(targetName, 'zh-cn', columns);
const verify = await base.getMetadata();
const created = (verify?.tables || []).some((table) => table.name === targetName);
console.log(JSON.stringify({ created, target: targetName }, null, 2));
if (!created) process.exitCode = 1;
