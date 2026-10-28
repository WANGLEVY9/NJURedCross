import { writeFile } from 'node:fs/promises';
import { reimbursementConfiguration, reimbursementConnection, configuredReimbursementStorage } from '../lib/reimbursements/config.js';
import { inspectReimbursementSchema, REIMBURSEMENT_SCHEMA } from '../lib/reimbursements/table-schema.js';

// Read-only by construction: no row reads, schema writes, Box requests or account-store access.
try {
  const config = reimbursementConfiguration(), client = await reimbursementConnection(config.table)();
  const metadata = await client.getMetadata();
  const report = { writes: false, ...configuredReimbursementStorage(config), schema: inspectReimbursementSchema(metadata),
    existing: metadata.tables.filter(table => ['财务审核表', '报销记录表'].includes(table.name))
      .map(table => ({ name: table.name, columns: table.columns.map(({ name, type }) => ({ name, type })) })),
    proposed: REIMBURSEMENT_SCHEMA };
  const output = process.argv.indexOf('--output');
  if (output >= 0 && process.argv[output + 1]) {
    await writeFile(process.argv[output + 1], JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ writes: false, schemaReady: report.schema.ready, boxConfigured: report.boxConfigured,
      missing: report.schema.missing.length, mismatched: report.schema.mismatched.length }));
  } else console.log(JSON.stringify(report, null, 2));
} catch { console.error('报销存储只读检查未完成；凭据及原始网络错误已隐藏。'); process.exitCode = 1; }
