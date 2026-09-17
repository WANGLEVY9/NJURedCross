import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Base } from 'seatable-api';
import { ACCOUNT_TABLE, ACCOUNT_COLUMNS, CODE_TABLE, CODE_COLUMNS, hashPassword, generateMemberCode, identifier } from '../lib/identity/store.js';
import { MAIL_TABLE, MAIL_COLUMNS } from '../lib/mailer.js';

/**
 * 创建身份层的三张新表，并从 .platform-accounts.json 播种现有账号（密码改 scrypt 哈希）：
 *   · 平台账号表 / 邮箱验证码表 / 邮件发件记录表
 *
 * 安全模型（与 apply-state-schema.mjs 一致）：
 *   · 不带 --apply 只打印计划并退出
 *   · 写操作需要 --confirm=APPLY-NJU-RC-ACCOUNT-TABLES
 *   · 任意目标表已存在则拒绝建表；已存在且非空则拒绝播种
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'APPLY-NJU-RC-ACCOUNT-TABLES';
const accountsFile = process.env.PLATFORM_ACCOUNTS_FILE || '.platform-accounts.json';

const definitions = [
  { name: ACCOUNT_TABLE, columns: ACCOUNT_COLUMNS, purpose: '平台账号（scrypt 哈希、角色、身份码、状态）' },
  { name: CODE_TABLE, columns: CODE_COLUMNS, purpose: '邮箱验证码（只存哈希，一次性，限次）' },
  { name: MAIL_TABLE, columns: MAIL_COLUMNS, purpose: '通用发信留痕（幂等键去重）' },
];

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const base = new Base({ server, APIToken: token });
await base.auth();
const metadata = await base.getMetadata();
const current = new Map((metadata?.tables || []).map((table) => [table.name, table]));
const existing = definitions.filter((definition) => current.has(definition.name));
const missing = definitions.filter((definition) => !current.has(definition.name));

// 播种源：现有的本地账号文件（含明文口令），播种后即转为哈希。
let seedAccounts = [];
try {
  const raw = JSON.parse(await readFile(join(root, accountsFile), 'utf8'));
  if (Array.isArray(raw) && raw.length) seedAccounts = raw;
} catch {
  seedAccounts = [];
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  writes: apply,
  requiredConfirmation,
  planned: definitions.map((item) => ({ name: item.name, columns: item.columns.length })),
  existing: existing.map((item) => item.name),
  toCreate: missing.map((item) => item.name),
  seedSource: accountsFile,
  seedAccounts: seedAccounts.length,
}, null, 2));

if (!apply) process.exit(0);
if (missing.length === 0 && existing.length > 0) {
  console.log('All tables already exist; skipping creation.');
}
if (existing.length && missing.length) {
  throw new Error(`Refusing to write because some target tables already exist: ${existing.map((item) => item.name).join('、')}. Resolve manually before re-running.`);
}

const created = [];
const failed = [];
for (const definition of missing) {
  const columns = definition.columns.map((name, index) => ({
    column_name: name,
    column_type: 'text',
    anchor_column: index === 0 ? '' : definition.columns[index - 1],
  }));
  try {
    await base.addTable(definition.name, 'zh-cn', columns);
    created.push(`${definition.name} (${definition.columns.length} 列)`);
    console.log(`Created table: ${definition.name}`);
  } catch (error) {
    const detail = error?.response?.data?.error_msg || error?.response?.data?.detail || error.message;
    failed.push(`${definition.name}: ${detail}`);
    console.error(`Failed to create ${definition.name}: ${detail}`);
  }
}

// 播种：仅当账号表为空时执行，避免重复播种。
let seeded = 0;
if (!failed.length) {
  const accountRows = await base.listRows(ACCOUNT_TABLE, '', '', false, '', 500);
  if (accountRows.length === 0 && seedAccounts.length) {
    const nowIso = new Date().toISOString();
    for (const account of seedAccounts) {
      try {
        await base.appendRow(ACCOUNT_TABLE, {
          账号ID: identifier('ACC'),
          登录名: String(account.username || '').trim(),
          邮箱: String(account.email || '').trim(),
          密码哈希: hashPassword(account.password),
          角色: account.role || 'member',
          显示名: String(account.label || account.username || '').trim(),
          身份码: account.role === 'platform_admin' ? '' : generateMemberCode(),
          状态: '启用',
          邮箱已验证: '已验证', // 播种账号是运维侧建好的，视为可信
          注册时间: nowIso,
          最近登录: '',
          失败次数: '0',
          锁定至: '',
          备注: '自 .platform-accounts.json 播种',
        });
        seeded += 1;
      } catch (error) {
        failed.push(`seed ${account.username}: ${error.message}`);
      }
    }
    console.log(`Seeded ${seeded} account(s) with scrypt hashes.`);
  } else if (accountRows.length > 0) {
    console.log(`Account table already has ${accountRows.length} row(s); skipping seeding.`);
  } else {
    console.log('No seed source found; skipping seeding.');
  }
}

const verify = await base.getMetadata();
const nowPresent = new Set((verify?.tables || []).map((table) => table.name));
console.log(JSON.stringify({
  created,
  seeded,
  failed,
  verifiedPresent: definitions.filter((item) => nowPresent.has(item.name)).map((item) => item.name),
}, null, 2));

if (failed.length) process.exitCode = 1;
