// Defaults to metadata-only preview. No automatic business migration on deployment.
import { Base } from 'seatable-api';
import { createSeaTableAccess } from '../lib/seatable-auth.js';
import { ensureMaterialWorkflowSchema } from '../lib/materials/workflow-schema.js';
try {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--confirm=ADD-MATERIALS-WORKFLOW'].includes(arg))) throw Error();
  const token = process.env.SEATABLE_API_TOKEN, uuid = process.env.SEATABLE_BUSINESS_BASE_UUID;
  if (!token || !uuid) throw Error();
  const server = process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn';
  if (new URL(server).origin !== 'https://table.nju.edu.cn') throw Error();
  const client = await createSeaTableAccess(new Base({ server, APIToken: token }))();
  const report = await ensureMaterialWorkflowSchema(client, { expectedUuid: uuid, apply: args.includes('--apply'), confirmation: args.includes('--confirm=ADD-MATERIALS-WORKFLOW') ? 'ADD-MATERIALS-WORKFLOW' : '' });
  console.log(JSON.stringify(report));
} catch { console.error('物资登记表检查未完成；请核对目标 Base、凭据、字段类型与确认参数。'); process.exitCode = 1; }
