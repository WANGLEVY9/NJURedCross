/** Read-only recipient check; never sends mail or writes SeaTable rows. */
import { Base } from 'seatable-api';
import { createSeaTableAccess } from '../lib/seatable-auth.js';
import { MORNING_PRODUCTION_BASE } from '../lib/morning/rollout.js';
import { MORNING_COORDINATORS, MORNING_COORDINATOR_TABLE, readMorningInviteCoordinators } from '../lib/morning/coordinators.js';

try {
  const server = process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn';
  if (new URL(server).origin !== 'https://table.nju.edu.cn'
    || process.env.SEATABLE_BUSINESS_BASE_UUID !== MORNING_PRODUCTION_BASE) throw Error('production_management_configuration_mismatch');
  if (!process.env.SEATABLE_API_TOKEN) throw Error('api_token_missing');
  const client = await createSeaTableAccess(new Base({ server, APIToken: process.env.SEATABLE_API_TOKEN }))();
  if (client.dtableUuid !== MORNING_PRODUCTION_BASE) throw Error('authenticated_base_mismatch');
  const groups = [];
  for (const [region, campus] of [['nanjing', '仙林'], ['suzhou', '苏州']]) {
    const emails = await readMorningInviteCoordinators(client, campus);
    groups.push({ region, names: MORNING_COORDINATORS[region].map(person => person.name), count: emails.length,
      emails: emails.map(email => { const [local, domain] = email.split('@'); return `${local.slice(0, 2)}***@${domain}`; }) });
  }
  console.log(JSON.stringify({ ok: true, baseUuid: client.dtableUuid, table: MORNING_COORDINATOR_TABLE,
    emailColumn: '邮箱', groups, rowWrites: 0, mailsSent: 0 }));
} catch {
  console.error(JSON.stringify({ ok: false, code: 'morning_coordinators_preview_failed',
    message: '请核对业务库配置、API 读取权限，以及固定名册记录的姓名和校园邮箱。', rowWrites: 0, mailsSent: 0 }));
  process.exitCode = 1;
}
