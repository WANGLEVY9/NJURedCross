/**
 * 平台账号存储层（主线 A · 身份与信任）。
 *
 * 职责：
 *   · scrypt 密码哈希与校验（自描述格式，便于参数升级）
 *   · 平台账号表 / 邮箱验证码表的行级读写
 *   · 会员身份码生成（RC-M-XXXXXXXX，字母表去掉易混字符）
 *
 * 上位约束：只在新建表中读写，绝不触碰既有业务表。
 * 布尔语义一律用文本（已验证/未验证），不用 checkbox —— 本项目已有
 * checkbox 列恒为 false 的教训（见 PLATFORM_ARCHITECTURE §5.4）。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ACCOUNT_TABLE = '平台账号表';
export const ACCOUNT_COLUMNS = [
  '账号ID', '登录名', '邮箱', '密码哈希', '角色', '显示名', '身份码',
  '状态', '邮箱已验证', '注册时间', '最近登录', '失败次数', '锁定至', '备注',
];

export const CODE_TABLE = '邮箱验证码表';
export const CODE_COLUMNS = [
  '验证码ID', '邮箱', '用途', '验证码哈希', '状态', '过期时间',
  '尝试次数', '创建时间', '消费时间', 'IP',
];

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

/** 生成业务 ID（与 server.js 的 eventIdentifier 同格式，供离线脚本使用）。 */
export function identifier(prefix = 'ACC') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** scrypt 哈希，自描述格式：scrypt$N$r$p$<saltB64>$<hashB64>。 */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** 校验密码；stored 非本格式时返回 false（明文兜底由 server.js 处理）。 */
export function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(String(password || ''), salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 会员身份码：RC-M-XXXXXXXX（8 位，字母表去掉 0/O/1/I）。 */
export function generateMemberCode() {
  const bytes = randomBytes(8);
  let body = '';
  for (let i = 0; i < 8; i += 1) body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `RC-M-${body}`;
}

/** SeaTable 行 → 账号对象。登录名为空或无密码哈希的行视为无效。 */
export function accountFromRow(row) {
  if (!row) return null;
  const login = String(row['登录名'] || '').trim();
  const passwordHash = String(row['密码哈希'] || '').trim();
  if (!login || !passwordHash) return null;
  return {
    rowId: row._id || null,
    username: login,
    email: String(row['邮箱'] || '').trim(),
    passwordHash,
    role: String(row['角色'] || 'member').trim(),
    label: String(row['显示名'] || login).trim(),
    memberCode: String(row['身份码'] || '').trim(),
    status: String(row['状态'] || '启用').trim(),
    emailVerified: String(row['邮箱已验证'] || '').trim() === '已验证',
    registeredAt: row['注册时间'] || null,
    lastLoginAt: row['最近登录'] || null,
  };
}

/** 全量加载账号表（服务启动时用）。表不存在时抛错，由调用方兜底。 */
export async function loadAccountsFromTable(client) {
  const rows = await client.listRows(ACCOUNT_TABLE, '', '', false, '', 500);
  const map = new Map();
  for (const row of rows) {
    const account = accountFromRow(row);
    if (account) map.set(account.username, account);
  }
  return map;
}

async function listAccounts(client) {
  return client.listRows(ACCOUNT_TABLE, '', '', false, '', 500);
}

/** 按登录名（或邮箱）查找账号；找不到返回 null。 */
export async function findAccountByLogin(client, login) {
  const key = String(login || '').trim().toLowerCase();
  if (!key) return null;
  const rows = await listAccounts(client);
  const row = rows.find((item) => {
    const name = String(item['登录名'] || '').trim().toLowerCase();
    const email = String(item['邮箱'] || '').trim().toLowerCase();
    return name === key || email === key;
  });
  return accountFromRow(row);
}

/** 新建账号行。email 冲突由调用方先行检查。 */
export async function createAccountRow(client, { login, email, passwordHash, role, displayName, memberCode = '', remark = '' }) {
  const accountId = identifier('ACC');
  const row = {
    账号ID: accountId,
    登录名: String(login || '').trim(),
    邮箱: String(email || '').trim(),
    密码哈希: passwordHash,
    角色: role,
    显示名: String(displayName || login || '').trim(),
    身份码: memberCode,
    状态: '启用',
    邮箱已验证: '未验证',
    注册时间: new Date().toISOString(),
    最近登录: '',
    失败次数: '0',
    锁定至: '',
    备注: remark,
  };
  const result = await client.appendRow(ACCOUNT_TABLE, row);
  return { rowId: result?._id || null, accountId, row };
}

/** 局部更新账号行。 */
export async function updateAccountFields(client, rowId, patch) {
  return client.updateRow(ACCOUNT_TABLE, rowId, patch);
}
