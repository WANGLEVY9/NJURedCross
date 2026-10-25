import { writeFile } from 'node:fs/promises';
import { reimbursementConfiguration, reimbursementConnection } from '../lib/reimbursements/config.js';
import { ensureReimbursementSchema } from '../lib/reimbursements/schema-setup.js';

try {
  const flags = process.argv.slice(2);
  if (flags.some(flag => !['--apply', '--confirm=ADD-REIMBURSEMENT-SCHEMA'].includes(flag))) throw new Error();
  const config = reimbursementConfiguration(), client = await reimbursementConnection(config.table)();
  if (new URL(config.table.server).origin !== 'https://table.nju.edu.cn') throw new Error();
  const before = await client.getMetadata();
  const finance = metadata => ({ tables: metadata.tables.filter(table => ['平台报销事务表', '平台报销数据块', '财务审核表', '报销记录表'].includes(table.name)) });
  const apply = flags.includes('--apply');
  if (apply) await writeFile(`reports/materials-ui-qa/reimbursement-schema-before-${new Date().toISOString().replaceAll(':', '-')}.json`, JSON.stringify(finance(before), null, 2), { flag: 'wx', mode: 0o600 });
  const report = await ensureReimbursementSchema(client, { expectedUuid: config.table.uuid, apply,
    confirmation: flags.includes('--confirm=ADD-REIMBURSEMENT-SCHEMA') ? 'ADD-REIMBURSEMENT-SCHEMA' : '' });
  if (apply) await writeFile('reports/materials-ui-qa/reimbursement-schema-after.json', JSON.stringify(finance(await client.getMetadata()), null, 2), { mode: 0o600 });
  await writeFile(`reports/materials-ui-qa/reimbursement-schema-${apply ? 'apply' : 'plan'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const code = /^reimbursement_[a-z_]+$/.test(error.code) ? error.code : 'reimbursement_schema_setup_failed';
  console.error(JSON.stringify({ code, status: error.response?.status || null })); process.exitCode = 1;
}
