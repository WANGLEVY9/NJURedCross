/** Production morning schema only; no row writes, deletes, copies or feature activation. */
import { Base } from 'seatable-api';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { planMorningSchema, MORNING_PRODUCTION_BASE } from '../lib/morning/rollout.js';

const apply = process.argv.includes('--apply');
const confirmation = process.argv.includes('--confirm=CREATE-NJU-RC-MORNING-SCHEMA');
try {
  if (process.env.SEATABLE_BUSINESS_BASE_UUID !== MORNING_PRODUCTION_BASE) throw new Error('production_management_configuration_mismatch');
  if (apply && !confirmation) throw new Error('morning_schema_confirmation_missing');
  if (!process.env.SEATABLE_API_TOKEN) throw new Error('api_token_missing');
  const server = process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn';
  if (new URL(server).origin !== 'https://table.nju.edu.cn') throw new Error('production_server_mismatch');
  const base = new Base({ server, APIToken: process.env.SEATABLE_API_TOKEN });
  await base.auth();
  if (base.dtableUuid !== MORNING_PRODUCTION_BASE) throw new Error('authenticated_base_mismatch');
  const before = await base.getMetadata();
  const plan = planMorningSchema(before);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', baseUuid: base.dtableUuid, plan, rowWrites: 0 }));
  if (apply) {
    const directory = resolve('.private-identity-schema-backups');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    await writeFile(resolve(directory, `morning-before-${stamp}.json`), JSON.stringify(before), { mode: 0o600, flag: 'wx' });
    for (const planned of plan) {
      // Reread before each operation: an interrupted run can be safely resumed.
      const latest = planMorningSchema(await base.getMetadata()).find(item => item.name === planned.name);
      if (latest.create) {
        await base.addTable(latest.name, 'zh-cn', latest.columns.map((name, index) => ({
          column_name: name, column_type: 'text', anchor_column: index ? latest.columns[index - 1] : '',
        })));
      } else {
        for (const column of latest.columns) await base.insertColumn(latest.name, column, 'text', '');
      }
    }
    const after = await base.getMetadata();
    const remaining = planMorningSchema(after).filter(item => item.create || item.columns.length);
    if (remaining.length) throw new Error('morning_schema_verification_failed');
    await writeFile(resolve(directory, `morning-after-${stamp}.json`), JSON.stringify(after), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ok: true, verified: true, tablesBefore: before.tables.length, tablesAfter: after.tables.length, rowWrites: 0, featureActivation: false }));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.response ? 'njutable_request_failed' : error.message, status: error.response?.status || null }));
  process.exitCode = 1;
}
