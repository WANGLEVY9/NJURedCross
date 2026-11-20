import { Base } from 'seatable-api';
import { ACCOUNT_TABLE } from '../lib/identity/store.js';
import { CONSOLE_PERMISSION_SCOPES } from '../lib/permissions.js';

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_IDENTITY_API_TOKEN?.trim();
const uuid = process.env.SEATABLE_IDENTITY_BASE_UUID?.trim();
if (!token || !uuid) throw new Error('Separate identity Base required');

const base = new Base({ server, APIToken: token });
await base.auth();
if (base.dtableUuid !== uuid) throw new Error('Identity Base mismatch');
const metadata = await base.getMetadata();
const table = (metadata?.tables || []).find((item) => item.name === ACCOUNT_TABLE);
if (!table) throw new Error(`${ACCOUNT_TABLE} does not exist`);
const existing = new Set((table.columns || []).map((column) => column.name));

console.log(JSON.stringify({
  mode: 'preview',
  writes: false,
  table: ACCOUNT_TABLE,
  proposedColumn: '权限范围',
  exists: existing.has('权限范围'),
  type: 'text',
  vocabulary: CONSOLE_PERMISSION_SCOPES,
  compatibility: '空值默认无业务模块；仅兼容开关为 true 时沿用旧默认值。none 为显式无模块。',
  nextStep: existing.has('权限范围') ? '无需变更' : '待人工确认后新增列，当前不执行写入',
}, null, 2));
