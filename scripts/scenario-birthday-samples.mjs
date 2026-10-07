/* ==========================================================================
   scripts/scenario-birthday-samples.mjs
   样例数据 + 端到端场景：普通用户投稿 → 管理端审核通过 → 生日当天两条线投递。
   阶段A：管理员没写过祝福 → 线1（指定）+ 线2（仓库抽取）
   阶段B：管理员写入一对一池后 → 成员（写过祝福）按条数随机匹配（排除自己写的）
   默认保留样例数据（--clean 可在结束时清理）；只在本地模拟 SeaTable 上运行。
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appBase = 'http://127.0.0.1:3000';
const prefix = '[样例]';
const cleanAtEnd = process.argv.includes('--clean');

function parseEnv() {
  const file = path.join(root, '.env');
  if (!existsSync(file)) throw new Error('缺少 .env');
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
function parseAccounts() {
  const file = path.join(root, '.platform-accounts.json');
  if (!existsSync(file)) throw new Error('缺少 .platform-accounts.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}
async function login(username, password) {
  const res = await fetch(`${appBase}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ username, password }) });
  const data = await res.json();
  if (!res.ok) throw new Error(`登录 ${username} 失败：${res.status}`);
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookie = (setCookies.length ? setCookies : [res.headers.get('set-cookie') || '']).map((v) => v.split(';')[0]).filter(Boolean).join('; ');
  return { cookie, csrf: data.csrfToken };
}
function makeClient(session) {
  return async function api(pathname, { method = 'GET', body } = {}) {
    const headers = { accept: 'application/json' };
    if (session.cookie) headers.cookie = session.cookie;
    if (method !== 'GET' && session.csrf) headers['x-csrf-token'] = session.csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(appBase + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  };
}
function todayMonthDay() {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'month').value}-${parts.find((p) => p.type === 'day').value}`;
}
let env;
let headers;
async function seatableHeaders() {
  if (headers) return headers;
  const authRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: `Token ${env.SEATABLE_API_TOKEN}` } });
  const auth = await authRes.json();
  if (!auth.access_token) throw new Error('本地模拟 SeaTable 鉴权失败');
  headers = { Authorization: `Token ${auth.access_token}`, 'content-type': 'application/json' };
  return headers;
}
async function readTable(table) {
  const h = await seatableHeaders();
  const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
  const res = await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(table)}&limit=500`, { headers: h });
  const data = await res.json();
  return data.rows || [];
}
async function deleteRows(table, rows) {
  const h = await seatableHeaders();
  const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
  for (const row of rows) {
    await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, { method: 'DELETE', headers: h, body: JSON.stringify({ table_name: table, row_id: row._id }) });
  }
}
async function cleanSamples() {
  let removed = 0;
  const ids = new Set();
  for (const table of ['温暖连接投稿表', '温暖祝福库表']) {
    const rows = (await readTable(table)).filter((row) => String(row['内容'] || '').startsWith(prefix));
    for (const row of rows) if (row['投稿ID']) ids.add(String(row['投稿ID']));
    await deleteRows(table, rows);
    removed += rows.length;
  }
  const deliveryRows = (await readTable('温暖祝福投递表')).filter((row) => ids.has(String(row['投稿ID'] || '')));
  await deleteRows('温暖祝福投递表', deliveryRows);
  // 同时清掉「今天」的投递记录，保证线2 每天只有一次匹配/抽取，场景可重复执行
  const today = todayMonthDay();
  const todayRows = (await readTable('温暖祝福投递表')).filter((row) => String(row['触发日期'] || '') === today);
  await deleteRows('温暖祝福投递表', todayRows);
  return removed + deliveryRows.length + todayRows.length;
}
async function ensureBirthdayEnrollment(client, today) {
  const me = await client('/api/portal/me');
  // 只有仍生效的登记才算活跃；已退出/已踢出都要重新加入（重新加入会复用原登记行）
  const active = (me.data?.enrollments || []).find((item) => item.program === 'birthday' && ['已确认', '待人工确认'].includes(item.status));
  if (active) {
    await client(`/api/public/warmth/interests/${encodeURIComponent(active.id)}/update`, { method: 'POST', body: { birthdayMonthDay: today, campus: '仙林' } });
    return active.id;
  }
  const joined = await client('/api/public/warmth/interest', { method: 'POST', body: { program: 'birthday', birthdayMonthDay: today, campus: '仙林', consent: true } });
  return joined.data?.interest?.id;
}
async function writeBlessing(client, { nickname, content, delivery, targetStudentId }) {
  const body = delivery === 'specific' ? { nickname, content, delivery, targetStudentId, consent: true } : { nickname, content, delivery, consent: true };
  const res = await client('/api/public/warmth/blessings', { method: 'POST', body });
  if (res.status !== 201) console.log(`  (投稿失败 ${res.status}: ${JSON.stringify(res.data)})`);
  return res.data?.blessing?.id;
}
const approve = (client, id) => client(`/api/community/submissions/${encodeURIComponent(id)}/review`, { method: 'POST', body: { decision: 'approve', note: '样例审核通过' } });

async function main() {
  env = parseEnv();
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(env.SEATABLE_SERVER_URL).hostname)) throw new Error('拒绝在非本地 SeaTable 上运行');
  const accounts = parseAccounts();
  const member = accounts.find((x) => x.username === 'local-member');
  const admin = accounts.find((x) => x.username === 'local-admin');
  const m = makeClient(await login(member.username, member.password));
  const a = makeClient(await login(admin.username, admin.password));
  const today = todayMonthDay();
  const t0 = Date.now();
  const checks = [];
  const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

  console.log(`\n=== 生日祝福样例场景（生日基准：${today}）===`);
  console.log(`清掉上次样例：${await cleanSamples()} 行`);
  const memberInterest = await ensureBirthdayEnrollment(m, today);
  const adminInterest = await ensureBirthdayEnrollment(a, today);

  // ---- 普通用户（local-member）创建 3 份样例文稿（每人上限 3 条）----
  const memberDocs = [
    ['小明', '生日快乐！愿你新的一岁被温柔以待，期末顺利，事事如愿。', 'specific', '999990001'],
    ['小刚', '愿你被这个世界温柔相待，生日快乐！', 'random', ''],
    ['小美', '生日快乐，愿你眼里有光，心中有暖，未来可期。', 'repository', ''],
  ];
  const memberIds = [];
  for (const [nickname, content, delivery, targetStudentId] of memberDocs) memberIds.push(await writeBlessing(m, { nickname, content: `${prefix}${content}`, delivery, targetStudentId }));
  let approved = 0;
  for (const id of memberIds) { const res = await approve(a, id); if (res.data?.submission?.status === '已通过') approved += 1; }
  console.log(`普通用户样例 ${memberIds.length} 份，管理端审核通过 ${approved} 份`);

  // ---- 阶段A：管理员（没写过祝福）→ 线1 指定 + 线2 仓库抽取 ----
  const runA = await a('/api/community/blessing-delivery/run', { method: 'POST', body: { day: today } });
  console.log(`阶段A 投递：${JSON.stringify(runA.data?.summary)}`);
  const afterA = await readTable('温暖祝福投递表');
  const adminA = afterA.filter((row) => String(row['收件人学号'] || '') === '999990001' && String(row['触发日期'] || '') === today);
  check('审核全部通过', approved === memberIds.length, `${approved}/${memberIds.length}`);
  check('线1：指定祝福发给管理员', adminA.filter((r) => String(r['来源'] || '') === '指定').length === 1, `指定=${adminA.filter((r) => String(r['来源'] || '') === '指定').length}`);
  // 线2 的分支取决于该账号累计「已通过投稿」条数（仓库抽取=没写过；一对一匹配=写过），共享本地数据下按两种结果之一断言
  const adminLine2 = adminA.filter((r) => ['仓库抽取', '一对一匹配'].includes(String(r['来源'] || '')));
  check('线2：管理员按规则产出投递（仓库抽取或一对一匹配）', adminLine2.length >= 1, `line2=${adminLine2.length} 来源=${[...new Set(adminLine2.map((r) => r['来源']))].join(',')}`);

  // ---- 管理员写 3 条随机祝福入池（作为成员可匹配的"他人祝福"）并审核通过 ----
  const poolIds = [];
  for (const content of ['愿你笑口常开，生日这天被满满的祝福包围。', '生日快乐！新的一岁请继续做闪闪发光的自己。', '把温柔和好运都送给你，生日快乐。']) {
    poolIds.push(await writeBlessing(a, { nickname: '管理员', content: `${prefix}${content}`, delivery: 'random' }));
  }
  let poolApproved = 0;
  for (const id of poolIds) { const res = await approve(a, id); if (res.data?.submission?.status === '已通过') poolApproved += 1; }
  console.log(`一对一池样例 ${poolIds.length} 份，审核通过 ${poolApproved} 份`);

  // ---- 阶段B：成员写过「随机 + 仓库」各 1 条 → 从一对一池匹配 2 条（排除自己写的；指定不计入） ----
  const runB = await a('/api/community/blessing-delivery/run', { method: 'POST', body: { day: today } });
  console.log(`阶段B 投递：${JSON.stringify(runB.data?.summary)}`);
  const afterB = await readTable('温暖祝福投递表');
  const libraryRows = await readTable('温暖祝福库表');
  const authorOf = (id) => String((libraryRows.find((row) => String(row['投稿ID'] || '') === id) || {})['来源投稿人'] || '');
  const memberDeliveries = afterB.filter((row) => String(row['收件人学号'] || '') === '999990002' && String(row['触发日期'] || '') === today);
  const matched = memberDeliveries.filter((row) => String(row['来源'] || '') === '一对一匹配');
  check('审核：一对一池样例全部通过', poolApproved === poolIds.length, `${poolApproved}/${poolIds.length}`);
  check('线2：成员写过随机+仓库 → 一对一匹配池内他人祝福', matched.length >= 2, `匹配=${matched.length}`);
  check('匹配不包含自己写的', matched.every((r) => authorOf(String(r['投稿ID'] || '')) !== 'local-member'), JSON.stringify(matched.map((r) => authorOf(String(r['投稿ID'] || '')))));

  // ---- 幂等 + 站内可见 ----
  const rerun = await a('/api/community/blessing-delivery/run', { method: 'POST', body: { day: today } });
  check('重复执行不重复投递', (rerun.data?.summary?.delivered || 0) === 0, JSON.stringify(rerun.data?.summary));
  const memberView = await m('/api/public/warmth/blessings/delivered');
  const memberItems = memberView.data?.blessings || [];
  check('成员站内可见已投递祝福', memberView.status === 200 && memberItems.length >= 2, `member=${memberItems.length}`);
  check('站内不暴露祝福库', (await m('/api/public/warmth/repository')).status === 404, 'public library read must stay closed');
  const adminLibrary = await a('/api/community/blessing-library');
  check('管理端可浏览祝福库', adminLibrary.status === 200 && Array.isArray(adminLibrary.data?.items) && adminLibrary.data.items.length >= 1, `status=${adminLibrary.status} items=${adminLibrary.data?.items?.length}`);
  check('邮件状态均为已发送', afterB.filter((r) => String(r['收件人学号'] || '') === '999990001' || String(r['收件人学号'] || '') === '999990002').every((r) => String(r['邮件状态'] || '') === '已发送'), JSON.stringify([...new Set(afterB.map((r) => r['邮件状态']))]));

  console.log('\n--- 场景校验汇总 ---');
  const failed = checks.filter((c) => !c.ok);
  console.log(`成员登记=${memberInterest} 管理员登记=${adminInterest} 用时=${Date.now() - t0}ms`);
  console.log(`${checks.length - failed.length}/${checks.length} 通过`);
  if (cleanAtEnd) console.log(`--clean：已清理 ${await cleanSamples()} 行样例数据`);
  else console.log(`样例数据已保留（前缀 ${prefix}）；清理：node scripts/scenario-birthday-samples.mjs --clean`);
  if (failed.length) process.exitCode = 1;
}
main().catch((error) => { console.error('样例场景失败：', error); process.exitCode = 1; });
