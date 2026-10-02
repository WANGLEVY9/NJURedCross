import { Base } from 'seatable-api';
import { ACCOUNT_TABLE } from '../lib/identity/store.js';
import { CONSOLE_PERMISSION_SCOPES } from '../lib/permissions.js';

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN?.trim();
if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');

const base = new Base({ server, APIToken: token });
await base.auth();
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
  compatibility: '空值视为全权管理员；设置后采用显式最小权限',
  nextStep: existing.has('权限范围') ? '无需变更' : '待人工确认后新增列，当前不执行写入',
}, null, 2));
