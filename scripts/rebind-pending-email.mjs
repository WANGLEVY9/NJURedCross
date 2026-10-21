import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
assertCoordinatedMaintenance({ write: process.argv.includes('--apply') });
/** Operator-only pending-signup email rebind; tokens stay in the server environment. */
import { Base } from 'seatable-api';
import { ACCOUNT_TABLE, listIdentityRows } from '../lib/identity/store.js';

// Keep in sync with server.js `smailDomains`.
const CAMPUS_DOMAINS = ['smail.nju.edu.cn', 'nju.edu.cn'];
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const target = arg('account');
const nextEmail = String(arg('email') || '').trim().toLowerCase();
const apply = process.argv.includes('--apply');

if (!target || !nextEmail) throw Error('Specify --account=<现有登录名或邮箱> and --email=<完整新校园邮箱>');
if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(nextEmail)) throw Error('新邮箱格式无效');
const domain = nextEmail.split('@')[1];
if (!CAMPUS_DOMAINS.includes(domain)) throw Error(`新邮箱后缀必须是 ${CAMPUS_DOMAINS.join(' 或 ')}`);
if (String(target).trim().toLowerCase() === nextEmail) throw Error('新邮箱不能与现有邮箱相同');

const token = process.env.SEATABLE_IDENTITY_API_TOKEN;
const uuid = process.env.SEATABLE_IDENTITY_BASE_UUID;
if (!token || !uuid) throw Error('Separate identity Base required');
const base = new Base({ server: process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn', APIToken: token });
await base.auth();
if (base.dtableUuid !== uuid) throw Error('Identity Base mismatch');

const rows = await listIdentityRows(base, ACCOUNT_TABLE);
const key = String(target).trim().toLowerCase();
const matches = rows.filter((row) => (
  String(row['登录名'] || '').trim().toLowerCase() === key
  || String(row['邮箱'] || '').trim().toLowerCase() === key
));
if (matches.length !== 1) throw Error('Account match must be unique');
const row = matches[0];

if (row['角色'] !== 'member') throw Error('Only pending member signups can be rebound here');
if (row['状态'] !== '启用') throw Error('账号已停用，不能换绑邮箱');
if (String(row['邮箱已验证'] || '').trim() === '已验证') throw Error('账号邮箱已验证，不能通过本脚本换绑；请走既有管理员流程');
if (String(row['学号'] || '').trim() && String(row['学号']).trim() !== nextEmail.split('@')[0]) {
  throw Error('新邮箱前缀与账号学号不一致，拒绝换绑');
}

const occupied = rows.some((other) => other._id !== row._id && (
  String(other['登录名'] || '').trim().toLowerCase() === nextEmail
  || String(other['邮箱'] || '').trim().toLowerCase() === nextEmail
));
if (occupied) throw Error('新邮箱已被其他账号使用');

const note = `${String(row['备注'] || '')}\n[邮箱换绑 ${new Date().toISOString()}] ${row['登录名']} → ${nextEmail}（服务器操作员）`.trim();

if (apply) {
  await base.updateRow(ACCOUNT_TABLE, row._id, { 登录名: nextEmail, 邮箱: nextEmail, 备注: note });
  const fresh = (await listIdentityRows(base, ACCOUNT_TABLE)).find((item) => item._id === row._id);
  if (fresh?.['登录名'] !== nextEmail || fresh?.['邮箱'] !== nextEmail) throw Error('Email rebind verification failed');
}

console.log(JSON.stringify({
  account: row['登录名'],
  nextEmail,
  applied: apply,
  changed: apply,
  studentId: String(row['学号'] || '').trim(),
  previousEmailVerified: String(row['邮箱已验证'] || '').trim(),
}));
