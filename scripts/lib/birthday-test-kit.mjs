/* ==========================================================================
   scripts/lib/birthday-test-kit.mjs
   生日祝福专项测试的共享套件：本地环境、测试账号、应用 API 客户端、
   本地模拟 SeaTable 的表读写，以及统一的断言记录器。
   冒烟（smoke-birthday）与样例（scenario-birthday-samples）都基于它，
   避免各脚本各自维护一份登录 / 表操作 / 断言实现而漂移。
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetTestAccountData } from './test-account-reset.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const APP_BASE = 'http://127.0.0.1:3000';
export const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
export { resetTestAccountData };

export function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) throw new Error('缺少 .env');
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

export function loadAccounts() {
  const file = path.join(ROOT, '.platform-accounts.json');
  if (!existsSync(file)) throw new Error('缺少 .platform-accounts.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function assertLocalSeatable(env) {
  let url;
  try { url = new URL(env.SEATABLE_SERVER_URL || ''); } catch { throw new Error('SEATABLE_SERVER_URL 无效。'); }
  if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error(`拒绝在非本地 SeaTable 上运行：${url.hostname}`);
}

/** 登录应用，返回 { cookie, csrf }。 */
export async function login(username, password) {
  const res = await fetch(`${APP_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`登录 ${username} 失败：${res.status} ${JSON.stringify(data)}`);
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookie = (setCookies.length ? setCookies : [res.headers.get('set-cookie') || ''])
    .map((value) => value.split(';')[0]).filter(Boolean).join('; ');
  return { cookie, csrf: data.csrfToken };
}

/** 生成带会话与 CSRF 的 api(path, { method, body }) → { status, ok, data }。 */
export function makeClient(session) {
  return async function api(pathname, { method = 'GET', body } = {}) {
    const headers = { accept: 'application/json' };
    if (session.cookie) headers.cookie = session.cookie;
    if (method !== 'GET' && session.csrf) headers['x-csrf-token'] = session.csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(APP_BASE + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  };
}

/** Asia/Shanghai 的今天（MM-DD）。 */
export function shanghaiMonthDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find((p) => p.type === 'month')?.value || ''}-${parts.find((p) => p.type === 'day')?.value || ''}`;
}

/** PASS/FAIL 记录器。 */
export function makeRecorder() {
  const results = [];
  return {
    results,
    check(name, ok, detail = '') {
      results.push({ name, ok: Boolean(ok) });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
    },
  };
}

/* --- 本地模拟 SeaTable 表读写（直连，绕过应用层） --- */

export async function seatableHeaders(env) {
  const authRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: `Token ${env.SEATABLE_API_TOKEN}` } });
  const auth = await authRes.json();
  if (!auth.access_token) throw new Error('本地模拟 SeaTable 鉴权失败。');
  return { Authorization: `Token ${auth.access_token}`, 'content-type': 'application/json' };
}

export async function readTable(env, table, limit = 1000) {
  const headers = await seatableHeaders(env);
  const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
  const res = await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(table)}&limit=${limit}`, { headers });
  const data = await res.json();
  return data.rows || [];
}

export async function deleteRows(env, table, rows) {
  const headers = await seatableHeaders(env);
  const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
  for (const row of rows) {
    await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, {
      method: 'DELETE', headers, body: JSON.stringify({ table_name: table, row_id: row._id }),
    });
  }
}

export async function deleteTableRows(env, table, predicate) {
  const targets = (await readTable(env, table)).filter(predicate);
  await deleteRows(env, table, targets);
  return targets.length;
}
