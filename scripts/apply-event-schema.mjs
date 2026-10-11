import { EVENT_SCHEMA } from '../lib/production-schema.js';
import { Base } from 'seatable-api';

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-NJU-RC-EVENT-TABLES';
const definitions = EVENT_SCHEMA;

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);

const base = new Base({ server, APIToken: token });
await base.auth();
const metadata = await base.getMetadata();
const current = new Map((metadata?.tables || []).map((table) => [table.name, table]));
const existing = definitions.filter((definition) => current.has(definition.name));
const missing = definitions.filter((definition) => !current.has(definition.name));

console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', writes: apply, requiredConfirmation, existing: existing.map((item) => item.name), toCreate: missing.map((item) => ({ name: item.name, columns: item.columns })) }, null, 2));

if (!apply) process.exit(0);
if (existing.length) throw new Error(`Refusing to write because target tables already exist: ${existing.map((item) => item.name).join('、')}`);

for (const definition of missing) {
  const columns = definition.columns.map((name, index) => ({ column_name: name, column_type: 'text', anchor_column: index === 0 ? '' : definition.columns[index - 1] }));
  await base.addTable(definition.name, 'zh-cn', columns);
  console.log(`Created table: ${definition.name}`);
}
