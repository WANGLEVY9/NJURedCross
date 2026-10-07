#!/usr/bin/env node
/*
 * Birthday-wishes end-to-end cycle checker.
 *
 * Safety: this script refuses to run against a non-local SeaTable base.
 * It starts the local mock + app when they are not already listening, runs
 * one or more full cycles, removes its own test rows, and stops only the
 * processes it started.
 *
 * Usage:
 *   node scripts/smoke-birthday.mjs
 *   node scripts/smoke-birthday.mjs --rounds 3
 *   node scripts/smoke-birthday.mjs --keep
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appBase = 'http://127.0.0.1:3000';
const mockHost = '127.0.0.1';
const mockPort = 3301;
const smokePrefix = '[自动冒烟测试]';
const started = [];

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  const parsed = Number(index >= 0 ? process.argv[index + 1] : NaN);
  return Number.isFinite(parsed) ? parsed : fallback;
}
const rounds = Math.max(1, Math.min(3, readFlag('--rounds', 1)));
const keepRows = process.argv.includes('--keep');

function parseEnv() {
  const file = path.join(root, '.env');
  if (!existsSync(file)) throw new Error('缺少 .env，无法运行本地生日祝福循环检查。');
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
function parseAccounts() {
  const file = path.join(root, '.platform-accounts.json');
  if (!existsSync(file)) throw new Error('缺少 .platform-accounts.json，无法取得本地测试账号。');
  return JSON.parse(readFileSync(file, 'utf8'));
}
function assertLocalSeatable(env) {
  let url;
  try { url = new URL(env.SEATABLE_SERVER_URL || ''); } catch { throw new Error('SEATABLE_SERVER_URL 无效。'); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`拒绝在非本地 SeaTable 上运行循环检查：${url.hostname}`);
  }
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(600);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}
async function waitForPort(port, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} 未在 ${timeoutMs}ms 内监听 127.0.0.1:${port}`);
}
async function ensureLocalServices() {
  if (!(await portOpen(mockPort))) {
    const serverFile = path.join(root, '.cache', 'local-seatable', 'server.mjs');
    if (!existsSync(serverFile)) throw new Error('缺少本地模拟 SeaTable，请先运行 .cache/local-seatable/start.ps1。');
    started.push(spawn(process.execPath, [serverFile], { cwd: root, stdio: 'ignore', windowsHide: true }));
    await waitForPort(mockPort, 10000, '本地模拟 SeaTable');
  }
  if (!(await portOpen(3000))) {
    started.push(spawn(process.execPath, ['--env-file=.env', 'server.js'], { cwd: root, stdio: 'ignore', windowsHide: true }));
    await waitForPort(3000, 15000, '应用服务');
  }
}
function stopStartedServices() {
  for (const child of started.reverse()) {
    try { child.kill(); } catch { /* already gone */ }
  }
}
async function login(username, password) {
  const res = await fetch(`${appBase}/api/auth/login`, {
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
function makeRecorder() {
  const results = [];
  return {
    results,
    check(name, ok, detail = '') {
      results.push({ name, ok: Boolean(ok) });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
    },
  };
}

async function cleanupSmokeRows(env) {
  if (keepRows) { console.log(`${smokePrefix} --keep：跳过清理`); return 0; }
  const authRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: `Token ${env.SEATABLE_API_TOKEN}` } });
  const auth = await authRes.json();
  if (!auth.access_token) throw new Error('本地模拟 SeaTable 鉴权失败，无法清理测试行。');
  const headers = { Authorization: `Token ${auth.access_token}`, 'content-type': 'application/json' };
  const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
  let removed = 0;
  const submissionIds = new Set();
  // 投稿表与审核通过入库后的祝福库表都要清理，否则测试数据会残留在本地模拟库。
  for (const table of ['温暖连接投稿表', '温暖祝福库表']) {
    const listRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(table)}&limit=500`, { headers });
    const list = await listRes.json();
    const targets = (list.rows || []).filter((row) => String(row['内容'] || '').startsWith(smokePrefix));
    for (const row of targets) {
      await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, { method: 'DELETE', headers, body: JSON.stringify({ table_name: table, row_id: row._id }) });
    }
    for (const row of targets) if (row['投稿ID']) submissionIds.add(String(row['投稿ID']));
    removed += targets.length;
  }
  // 投递记录按投稿ID 关联清理，避免本地模拟库残留
  try {
    const deliveryTable = '温暖祝福投递表';
    const deliveryRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(deliveryTable)}&limit=500`, { headers });
    const deliveryList = await deliveryRes.json();
    const deliveryTargets = (deliveryList.rows || []).filter((row) => submissionIds.has(String(row['投稿ID'] || '')));
    for (const row of deliveryTargets) {
      await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, { method: 'DELETE', headers, body: JSON.stringify({ table_name: deliveryTable, row_id: row._id }) });
    }
    removed += deliveryTargets.length;
  } catch { /* 投递表缺失时忽略清理 */ }
  try {
    const reportTable = '温暖祝福举报表';
    const reportRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(reportTable)}&limit=500`, { headers });
    const reportList = await reportRes.json();
    const reportTargets = (reportList.rows || []).filter((row) => submissionIds.has(String(row['投稿ID'] || '')));
    for (const row of reportTargets) {
      await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, { method: 'DELETE', headers, body: JSON.stringify({ table_name: reportTable, row_id: row._id }) });
    }
    removed += reportTargets.length;
  } catch { /* 举报表缺失时忽略清理 */ }
  try {
    const mailTable = '邮件发件记录表';
    const mailRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(mailTable)}&limit=500`, { headers });
    const mailList = await mailRes.json();
    const mailTargets = (mailList.rows || []).filter((row) => {
      const key = String(row['幂等键'] || '');
      return key.startsWith('WARMTH-REPORT:') || key.startsWith('WARMTH-BLACKLIST:') || [...submissionIds].some((id) => key.includes(id));
    });
    for (const row of mailTargets) {
      await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, { method: 'DELETE', headers, body: JSON.stringify({ table_name: mailTable, row_id: row._id }) });
    }
    removed += mailTargets.length;
  } catch { /* 邮件表缺失时忽略清理 */ }
  return removed;
}

async function readSmokeTable(env, table) {
  const authRes = await fetch(`${env.SEATABLE_SERVER_URL}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: `Token ${env.SEATABLE_API_TOKEN}` } });
  const auth = await authRes.json();
  if (!auth.access_token) throw new Error('本地模拟 SeaTable 鉴权失败。');
  const headers = { Authorization: `Token ${auth.access_token}`, 'content-type': 'application/json' };
  const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
  const res = await fetch(`${env.SEATABLE_SERVER_URL}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(table)}&limit=500`, { headers });
  const data = await res.json();
  return data.rows || [];
}

async function runRound(round, accounts, env) {
  const tag = `${smokePrefix}[第${round}轮]`;
  const member = accounts.find((item) => item.username === 'local-member');
  const admin = accounts.find((item) => item.username === 'local-admin');
  if (!member || !admin) throw new Error('缺少 local-member / local-admin 测试账号。');
  const m = makeClient(await login(member.username, member.password));
  const a = makeClient(await login(admin.username, admin.password));
  const { check, results } = makeRecorder();

  let r = await m('/api/portal/me');
  const memberInterests = r.data?.enrollments || [];
  const activeMember = memberInterests.find((item) => item.program === 'birthday' && item.status !== '已退出');
  if (activeMember) await m(`/api/public/warmth/interests/${encodeURIComponent(activeMember.id)}/withdraw`, { method: 'POST', body: {} });

  r = await m('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '冒烟', content: `${tag} before join`, delivery: 'random', consent: true } });
  check('未加入不能投稿', r.status === 403, `status=${r.status}`);

  r = await m('/api/public/warmth/interest', { method: 'POST', body: { program: 'birthday', birthdayMonthDay: '03-18', campus: '仙林', consent: true } });
  const memberInterestId = r.data?.interest?.id;
  check('加入生日祝福报名', (r.status === 200 || r.status === 201) && Boolean(memberInterestId), `status=${r.status} id=${memberInterestId}`);

  r = await m('/api/public/warmth/interest', { method: 'POST', body: { program: 'birthday', birthdayMonthDay: '03-18', campus: '仙林', consent: true } });
  check('不可重复报名', r.status === 409, `status=${r.status} message=${r.data?.message || ''}`);

  r = await m('/api/public/warmth/blessings/mine');
  check('会员中心可读审核进度', r.status === 200 && Array.isArray(r.data?.blessings), `status=${r.status}`);

  r = await m('/api/portal/me');
  const memberInterestAfterJoin = (r.data?.enrollments || []).find((item) => item.id === memberInterestId);
  check('加入生日祝福计划即生效', memberInterestAfterJoin?.status === '已确认', memberInterestAfterJoin?.status);

  r = await a('/api/community/interests');
  const memberInterestBeforeWrite = r.data?.interests?.find((item) => item.id === memberInterestId);
  check('审核端看到已加入成员', Boolean(memberInterestBeforeWrite) && memberInterestBeforeWrite.status === '已确认', memberInterestBeforeWrite?.status);
  check('审核端可见成员完整信息', Boolean(memberInterestBeforeWrite?.realName && memberInterestBeforeWrite?.studentId && memberInterestBeforeWrite?.contactEmail), JSON.stringify({ name: memberInterestBeforeWrite?.realName, studentId: memberInterestBeforeWrite?.studentId, email: memberInterestBeforeWrite?.contactEmail }));
  r = await a(`/api/community/interests/${encodeURIComponent(memberInterestId)}/confirm`, { method: 'POST', body: {} });
  check('已确认登记的确认接口幂等', r.status === 200 && r.data?.interest?.status === '已确认', `status=${r.status}`);

  r = await m(`/api/public/warmth/interests/${encodeURIComponent(memberInterestId)}/update`, { method: 'POST', body: { birthdayMonthDay: '04-20', campus: '鼓楼' } });
  check('会员中心可修改生日资料', r.status === 200, `status=${r.status}`);
  r = await m('/api/portal/me');
  const updatedInterestBeforeWrite = (r.data?.enrollments || []).find((item) => item.id === memberInterestId);
  check('修改后的资料已保存', updatedInterestBeforeWrite?.birthdayMonthDay === '04-20' && updatedInterestBeforeWrite?.campus === '鼓楼', `${updatedInterestBeforeWrite?.birthdayMonthDay} / ${updatedInterestBeforeWrite?.campus}`);

  r = await m('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '冒烟', content: `${tag} random`, delivery: 'random', consent: true } });
  const randomId = r.data?.blessing?.id;
  check('已加入可投稿(random)', r.status === 201 && r.data?.blessing?.status === '待审核', `status=${r.status} blessingStatus=${r.data?.blessing?.status}`);


  r = await a('/api/community/submissions');
  check('管理端看到待审核投稿', r.data?.submissions?.find((item) => item.id === randomId)?.status === '待审核');
  r = await a(`/api/community/submissions/${encodeURIComponent(randomId)}/review`, { method: 'POST', body: { decision: 'reject', note: `${tag} 请补充` } });
  check('管理端直接拒绝', r.status === 200 && r.data?.submission?.status === '已拒绝', `status=${r.status}`);
  r = await m('/api/public/warmth/blessings/mine');
  const rejected = r.data?.blessings?.find((item) => item.id === randomId);
  check('成员看到已拒绝与理由', rejected?.status === '已拒绝' && String(rejected?.reviewNote || '').includes(tag), `status=${rejected?.status}`);
  r = await a(`/api/community/submissions/${encodeURIComponent(randomId)}/review`, { method: 'POST', body: { decision: 'reopen' } });
  check('管理端撤销拒绝', r.status === 200 && r.data?.submission?.status === '待审核', `status=${r.status}`);
  r = await a(`/api/community/submissions/${encodeURIComponent(randomId)}/review`, { method: 'POST', body: { decision: 'approve', note: `${tag} 通过` } });
  check('管理端审核通过', r.status === 200 && r.data?.submission?.status === '已通过', `status=${r.status}`);
  r = await m('/api/public/warmth/blessings/mine');
  check('成员看到已通过', r.data?.blessings?.find((item) => item.id === randomId)?.status === '已通过');

  r = await m('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '冒烟', content: `${tag} returned`, delivery: 'random', consent: true } });
  const returnedId = r.data?.blessing?.id;
  check('再次投稿用于退回流程', r.status === 201 && Boolean(returnedId), `status=${r.status}`);
  r = await a(`/api/community/submissions/${encodeURIComponent(returnedId)}/review`, { method: 'POST', body: { decision: 'return', note: `${tag} 请补充` } });
  check('管理端退回修改', r.status === 200 && r.data?.submission?.status === '需修改', `status=${r.status} ${r.data?.submission?.status}`);
  r = await m(`/api/public/warmth/blessings/${encodeURIComponent(returnedId)}/resubmit`, { method: 'POST', body: { nickname: '冒烟改', content: `${tag} returned v2`, delivery: 'random', consent: true } });
  check('成员可修改并重新提交', r.status === 200 && r.data?.blessing?.status === '待审核', `status=${r.status} ${r.data?.blessing?.status}`);

  r = await a('/api/community/interests');
  let adminInterest = r.data?.interests?.find((item) => item.studentId === '999990001');
  if (!adminInterest) {
    await a('/api/public/warmth/interest', { method: 'POST', body: { program: 'birthday', birthdayMonthDay: '01-01', campus: '仙林', consent: true } });
    r = await a('/api/community/interests');
    adminInterest = r.data?.interests?.find((item) => item.studentId === '999990001');
  }
  check('管理端看到自己的登记', Boolean(adminInterest), adminInterest?.id);
  if (adminInterest && adminInterest.status !== '已退出') {
    await a(`/api/community/interests/${encodeURIComponent(adminInterest.id)}/withdraw`, { method: 'POST', body: {} });
  }
  r = await m('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '冒烟', content: `${tag} specific waiting`, delivery: 'specific', targetStudentId: '999990001', consent: true } });
  const specificId = r.data?.blessing?.id;
  check('目标未确认进入等待', r.status === 201 && r.data?.blessing?.status === '等待对方加入', `status=${r.status} blessingStatus=${r.data?.blessing?.status}`);
  r = await a('/api/community/submissions');
  check('等待投稿不在待审核队列', r.data?.submissions?.find((item) => item.id === specificId)?.status === '等待对方加入');
  r = await a(`/api/community/interests/${encodeURIComponent(adminInterest.id)}/confirm`, { method: 'POST', body: {} });
  check('目标确认', r.status === 200, `status=${r.status}`);
  r = await a('/api/community/submissions');
  check('目标确认后进入待审核', r.data?.submissions?.find((item) => item.id === specificId)?.status === '待审核');
  r = await a(`/api/community/submissions/${encodeURIComponent(specificId)}/review`, { method: 'POST', body: { decision: 'approve', note: `${tag} 等待通过` } });
  check('等待投稿审核通过', r.status === 200 && r.data?.submission?.status === '已通过', `status=${r.status}`);

  r = await a('/api/community/matching-preview');
  check('匹配预览包含公众端确认候选', r.status === 200 && Number(r.data?.candidateCount) >= 1, `candidateCount=${r.data?.candidateCount}`);

  r = await m(`/api/public/warmth/interests/${encodeURIComponent(memberInterestId)}/withdraw`, { method: 'POST', body: {} });
  check('公众端可自助退出', r.status === 200, `status=${r.status}`);
  r = await m('/api/public/warmth/interest', { method: 'POST', body: { program: 'birthday', birthdayMonthDay: '03-18', campus: '仙林', consent: true } });
  check('退出后可重新加入', r.status === 200 || r.status === 201, `status=${r.status}`);
  r = await a('/api/community/interests');
  const rejoined = r.data?.interests?.find((item) => item.id === memberInterestId);
  check('重新加入后自动生效', rejoined?.status === '已确认', rejoined?.status);

  // 审核通过入库：按投递方式分类进入祝福库
  r = await m('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '冒烟', content: `${tag} lib specific`, delivery: 'specific', targetStudentId: '999990001', consent: true } });
  const libSpecificId = r.data?.blessing?.id;
  check('入库用：指定个体投稿', r.status === 201 && r.data?.blessing?.status === '待审核', `status=${r.status}`);
  r = await a(`/api/community/submissions/${encodeURIComponent(libSpecificId)}/review`, { method: 'POST', body: { decision: 'approve', note: `${tag} 通过` } });
  check('入库用：指定个体审核通过', r.status === 200 && r.data?.submission?.status === '已通过', `status=${r.status}`);

  r = await m('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '冒烟', content: `${tag} lib repo`, delivery: 'repository', consent: true } });
  const libRepoId = r.data?.blessing?.id;
  r = await a(`/api/community/submissions/${encodeURIComponent(libRepoId)}/review`, { method: 'POST', body: { decision: 'approve', note: `${tag} 通过` } });
  check('入库用：祝福仓库审核通过', r.status === 200 && r.data?.submission?.status === '已通过', `status=${r.status}`);

  const libraryRows = await readSmokeTable(env, '温暖祝福库表');
  const findLib = (id) => libraryRows.find((row) => String(row['投稿ID'] || '') === id);
  const libView = (row) => (row ? { category: row['分类'], targetStudentId: row['目标学号'], status: row['状态'] } : null);
  check('祝福库仅存于 SeaTable', libraryRows.length > 0, `rows=${libraryRows.length}`);
  check('指定个体入库并分类', findLib(libSpecificId)?.['分类'] === '指定个体' && findLib(libSpecificId)?.['目标学号'] === '999990001', JSON.stringify(libView(findLib(libSpecificId))));
  check('祝福仓库入库并分类', findLib(libRepoId)?.['分类'] === '祝福仓库', JSON.stringify(libView(findLib(libRepoId))));
  check('一对一随机入库并分类', findLib(randomId)?.['分类'] === '一对一随机', JSON.stringify(libView(findLib(randomId))));
  check('管理端暂未开放祝福库读取', (await a('/api/community/blessing-library')).status === 404, 'admin library read must stay closed');
  check('公众端不暴露祝福库', (await m('/api/public/warmth/repository')).status === 404, 'public library read must stay closed');

  // 固定两位成员的生日，避免被样例脚本等其它操作改动影响（管理员 01-01 / 成员 03-18）
  await m(`/api/public/warmth/interests/${encodeURIComponent(memberInterestId)}/update`, { method: 'POST', body: { birthdayMonthDay: '03-18', campus: '仙林' } });
  await a(`/api/public/warmth/interests/${encodeURIComponent(adminInterest.id)}/update`, { method: 'POST', body: { birthdayMonthDay: '01-01', campus: '仙林' } });

  // 线1（独立）：指定给本人的祝福 → 邮件 + 站内；管理员没写过祝福 → 线2 走仓库抽取
  r = await a('/api/community/blessing-delivery/run', { method: 'POST', body: { day: '01-01' } });
  const adminSummary = r.data?.summary;
  check('生日投递任务可执行', r.status === 200 && Boolean(adminSummary), `status=${r.status}`);
  check('指定祝福被投递（线1）', (adminSummary?.specific || 0) >= 1, JSON.stringify(adminSummary));
  // 线2 的分支（没写过→仓库抽取 / 写过→一对一匹配）由受控数据的场景脚本 scripts/scenario-birthday-samples.mjs 覆盖；
  // 冒烟这里不再断言，因为共享本地数据会让「当天是否已匹配」随历史变化。
  r = await a('/api/public/warmth/blessings/delivered');
  check('收件人站内可见已投递祝福', r.status === 200 && (r.data?.blessings || []).some((item) => item.submissionId === libSpecificId), `status=${r.status}`);
  r = await m('/api/public/warmth/blessings/delivered');
  check('非收件人看不到投递祝福', r.status === 200 && !(r.data?.blessings || []).some((item) => item.submissionId === libSpecificId), `status=${r.status}`);
  r = await a('/api/community/blessing-delivery/run', { method: 'POST', body: { day: '01-01' } });
  check('重复执行不重复投递', (r.data?.summary?.delivered || 0) === 0, JSON.stringify(r.data?.summary));

  // 线2分支：先由管理员写一条随机祝福并入池（否则池里只剩成员自己写的，会被正确排除）
  r = await a('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '管理员', content: `${tag} pool random`, delivery: 'random', consent: true } });
  const poolId = r.data?.blessing?.id;
  check('管理员投稿进一对一池', r.status === 201 && Boolean(poolId), `status=${r.status}`);
  r = await a(`/api/community/submissions/${encodeURIComponent(poolId)}/review`, { method: 'POST', body: { decision: 'approve', note: `${tag} 通过` } });
  check('一对一池祝福审核通过', r.status === 200 && r.data?.submission?.status === '已通过', `status=${r.status}`);
  // 站外成员（写过祝福）按其已通过条数从一对一池匹配，且不能是自己写的
  r = await a('/api/community/blessing-delivery/run', { method: 'POST', body: { day: '03-18' } });
  const memberSummary = r.data?.summary;
  check('写过祝福者按条数匹配（线2）', (memberSummary?.matched || 0) >= 1, JSON.stringify(memberSummary));
  const deliveryRows = await readSmokeTable(env, '温暖祝福投递表');
  const libraryAll = await readSmokeTable(env, '温暖祝福库表');
  const authorOf = (id) => String((libraryAll.find((row) => String(row['投稿ID'] || '') === id) || {})['来源投稿人'] || '');
  const matchedRows = deliveryRows.filter((row) => String(row['收件人学号'] || '') === '999990002' && String(row['来源'] || '') === '一对一匹配');
  const memberWritten = libraryAll.filter((row) => String(row['来源投稿人'] || '') === 'local-member').length;
  check('匹配数量不超过本人已通过条数', matchedRows.length >= 1 && matchedRows.length <= memberWritten, `matched=${matchedRows.length} written=${memberWritten}`);
  check('不会匹配自己写的祝福', matchedRows.every((row) => authorOf(String(row['投稿ID'] || '')) !== 'local-member'), JSON.stringify(matchedRows.map((row) => authorOf(String(row['投稿ID'] || '')))));

  // 举报：只有收件人可举报，重复举报被拒，管理端可处理并撤下该祝福
  r = await a(`/api/public/warmth/blessings/${encodeURIComponent(libSpecificId)}/report`, { method: 'POST', body: { reason: `${tag} 收到后觉得不合适` } });
  check('收件人可举报收到的祝福', r.status === 201 && r.data?.report?.status === '待处理', `status=${r.status}`);
  r = await a(`/api/public/warmth/blessings/${encodeURIComponent(libSpecificId)}/report`, { method: 'POST', body: { reason: `${tag} 重复举报` } });
  check('重复举报被拒', r.status === 409, `status=${r.status}`);
  r = await m(`/api/public/warmth/blessings/${encodeURIComponent(libSpecificId)}/report`, { method: 'POST', body: { reason: `${tag} 非收件人` } });
  check('非收件人不能举报', r.status === 403, `status=${r.status}`);
  r = await a('/api/community/warmth-reports');
  const pendingReport = (r.data?.reports || []).find((item) => item.submissionId === libSpecificId);
  check('管理端看到举报', r.status === 200 && pendingReport?.status === '待处理', `status=${r.status}`);
  check('举报记录含被举报祝福原文', Boolean(pendingReport?.content), `content=${String(pendingReport?.content || '').slice(0, 24)}`);
  r = await a(`/api/community/warmth-reports/${encodeURIComponent(pendingReport?.id)}/handle`, { method: 'POST', body: { note: `${tag} 已核实并撤下` } });
  check('管理端处理举报', r.status === 200 && r.data?.report?.status === '已处理', `status=${r.status}`);
  const libraryAfterReport = await readSmokeTable(env, '温暖祝福库表');
  check('处理成立后祝福被撤下', String((libraryAfterReport.find((row) => String(row['投稿ID'] || '') === libSpecificId) || {})['状态'] || '') === '已撤下', 'library row must be withdrawn');
  const mailRows = await readSmokeTable(env, '邮件发件记录表');
  check('受理后邮件通知举报人', mailRows.some((row) => String(row['幂等键'] || '') === `WARMTH-REPORT:${pendingReport?.id}:handled` && String(row['状态'] || '') === '已发送'), `keys=${mailRows.map((x) => x['幂等键']).filter(Boolean).length}`);
  r = await a('/api/public/warmth/blessings/delivered');
  const reportedItem = (r.data?.blessings || []).find((item) => item.submissionId === libSpecificId);
  check('举报人站内可见处理结果', reportedItem?.reportStatus === '已处理' && String(reportedItem?.reportResolution || '').includes(tag), JSON.stringify({ status: reportedItem?.reportStatus, note: reportedItem?.reportResolution }));

  // 管理端可查看成员资料（审核/举报/登记等处点击人员即可打开）
  r = await a('/api/community/warmth-members/999990002');
  check('管理端可查看成员资料', r.status === 200 && r.data?.member?.realName === '本地成员' && Boolean(r.data?.member?.warmth), `status=${r.status} name=${r.data?.member?.realName}`);

  // 拉黑 / 踢出：管理员可把成员踢出计划并拉黑，被拉黑者不能重新加入
  r = await a(`/api/community/interests/${encodeURIComponent(memberInterestId)}/kick`, { method: 'POST', body: {} });
  check('管理员可踢出计划', r.status === 200 && r.data?.interest?.status === '已踢出', `status=${r.status} ${r.data?.interest?.status}`);
  r = await m('/api/public/warmth/blessings', { method: 'POST', body: { nickname: '冒烟', content: `${tag} after kick`, delivery: 'random', consent: true } });
  check('被踢出后不能投稿', r.status === 403, `status=${r.status}`);
  r = await a(`/api/community/interests/${encodeURIComponent(memberInterestId)}/blacklist`, { method: 'POST', body: { reason: `${tag} 违规` } });
  check('管理员可拉黑成员', r.status === 200 && r.data?.blacklist?.status === '生效', `status=${r.status} ${r.data?.blacklist?.status}`);
  check('拉黑时邮件通知本人', r.data?.notified === true, `notified=${r.data?.notified}`);
  r = await m('/api/public/warmth/interest', { method: 'POST', body: { program: 'birthday', birthdayMonthDay: '03-18', campus: '仙林', consent: true } });
  check('被拉黑后不能再加入', r.status === 403, `status=${r.status}`);
  r = await a('/api/community/warmth-blacklist');
  const blacklistEntry = (r.data?.entries || []).find((item) => item.studentId === '999990002');
  check('管理端黑名单可见', r.status === 200 && blacklistEntry?.status === '生效', `status=${r.status}`);
  check('黑名单显示姓名', Boolean(blacklistEntry?.realName), `name=${blacklistEntry?.realName}`);
  r = await a(`/api/community/warmth-blacklist/${encodeURIComponent(blacklistEntry?.id)}/release`, { method: 'POST', body: {} });
  check('管理员可解除拉黑', r.status === 200 && r.data?.entry?.status === '已解除', `status=${r.status}`);

  return results;
}

async function main() {
  const env = parseEnv();
  assertLocalSeatable(env);
  const accounts = parseAccounts();
  await ensureLocalServices();
  let failed = 0;
  try {
    for (let round = 1; round <= rounds; round += 1) {
      console.log(`\n=== 生日祝福循环检查 第 ${round}/${rounds} 轮 ===`);
      const results = await runRound(round, accounts, env);
      const roundFailed = results.filter((item) => !item.ok);
      failed += roundFailed.length;
      console.log(`第 ${round} 轮：${results.length - roundFailed.length}/${results.length} 通过`);
      if (roundFailed.length) console.log('失败项：' + roundFailed.map((item) => item.name).join('、'));
      try {
        const deleted = await cleanupSmokeRows(env);
        if (deleted) console.log(`已清理 ${deleted} 条测试投稿`);
      } catch (error) {
        console.warn(`清理测试行失败：${error.message}`);
      }
    }
  } finally {
    stopStartedServices();
  }
  if (failed) {
    console.error(`\n循环检查失败：共 ${failed} 项未通过。`);
    process.exitCode = 1;
  } else {
    console.log(`\n循环检查通过：${rounds} 轮全部通过。`);
  }
}

main().catch((error) => {
  console.error(`循环检查无法启动：${error.message}`);
  stopStartedServices();
  process.exitCode = 1;
});
