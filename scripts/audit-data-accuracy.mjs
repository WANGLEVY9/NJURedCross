import { Base } from 'seatable-api';

/**
 * Read-only reconciliation between SeaTable source rows and the platform APIs.
 *
 * This script deliberately performs no SeaTable append/update/delete calls. It
 * also avoids printing row contents so production data and personal details do
 * not leak into CI logs.
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const mainToken = process.env.SEATABLE_API_TOKEN?.trim();
const volunteerToken = process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
const apiBase = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
// The current account source is SeaTable, not the legacy single-admin env pair.
// Match smoke-auth's explicit test account unless an audit override is supplied.
const adminUsername = process.env.AUDIT_ADMIN_USERNAME || 'admin1';
const adminPassword = process.env.AUDIT_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || 'njuredcross';

if (!mainToken || mainToken === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (!volunteerToken || volunteerToken === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_VOLUNTEER_API_TOKEN');

const main = new Base({ server, APIToken: mainToken });
const volunteer = new Base({ server, APIToken: volunteerToken });
await Promise.all([main.auth(), volunteer.auth()]);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isFlagOn(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return /^(true|是|yes|y|1|开启|成功|通过|已报名|已核对|已录入)$/i.test(String(value).trim());
}

function cellText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) {
    const text = value.map((item) => cellText(item, '')).filter(Boolean).join('、');
    return text || fallback;
  }
  if (typeof value === 'object') {
    const candidate = value.display_value ?? value.name ?? value.title ?? value.label ?? value.value;
    return candidate === value ? fallback : cellText(candidate, fallback);
  }
  return String(value).trim() || fallback;
}

async function listAllRows(client, table, { pageSize = 100, maxRows = 5000 } = {}) {
  const rows = [];
  let start = 0;
  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const batch = await client.listRows(table, '', '', false, start, limit);
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    start += batch.length;
    if (batch.length < limit) return rows;
  }
  const overflow = await client.listRows(table, '', '', false, start, 1);
  if (Array.isArray(overflow) && overflow.length) throw new Error(`${table} exceeds audit limit ${maxRows}`);
  return rows;
}

function deterministicSample(rows, count = 10) {
  if (rows.length <= count) return rows.slice();
  const indexes = new Set();
  for (let index = 0; index < count; index += 1) {
    indexes.add(Math.round((index * (rows.length - 1)) / (count - 1)));
  }
  return [...indexes].map((index) => rows[index]);
}

const checks = [];
function check(scope, label, condition, detail) {
  checks.push({ scope, label, passed: Boolean(condition), detail });
}

function equal(scope, label, actual, expected) {
  check(scope, label, Object.is(actual, expected), `actual=${actual} expected=${expected}`);
}

async function login() {
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    redirect: 'manual',
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 200) throw new Error(`Audit login failed: HTTP ${response.status} ${payload?.message || ''}`.trim());
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Audit login did not return a session cookie');
  return cookie;
}

async function apiJson(path, cookie) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Accept: 'application/json', Cookie: cookie } });
  const payload = await response.json().catch(() => null);
  if (response.status !== 200 || payload?.ok !== true) throw new Error(`${path} failed: HTTP ${response.status}`);
  return payload;
}

const cookie = await login();
const [materialsApi, volunteerApi, outreachApi] = await Promise.all([
  apiJson('/api/materials/overview', cookie),
  apiJson('/api/volunteer/overview', cookie),
  apiJson('/api/outreach/overview', cookie),
]);

// Materials: full source totals plus ten deterministic inventory rows.
const [applications, inventory, configs, flows] = await Promise.all([
  listAllRows(main, '物资管理'),
  listAllRows(main, '工位物资表'),
  listAllRows(main, '物资配置表'),
  listAllRows(main, '物资流水表'),
]);
equal('物资', '申请总数', materialsApi.reads.applications.total, applications.length);
equal('物资', '库存分类总数', materialsApi.reads.inventory.total, inventory.length);
equal('物资', '配置总数', materialsApi.reads.config.total, configs.length);
equal('物资', '流水总数', materialsApi.reads.flows.total, flows.length);
equal('物资', 'API 库存数组完整', materialsApi.inventory.length, inventory.length);
equal('物资', '初始数量汇总', materialsApi.stats.totalInitialQuantity, inventory.reduce((sum, row) => sum + toNumber(row['初始数量']), 0));

const materialDeltas = new Map();
for (const row of flows) {
  const code = String(row['资产编码'] || '');
  const operation = String(row['操作类型'] || '');
  const quantity = toNumber(row['数量']);
  const delta = ['入库', '归还', '盘点增加'].includes(operation) ? quantity : ['出库', '报损', '盘点减少'].includes(operation) ? -quantity : 0;
  if (code) materialDeltas.set(code, (materialDeltas.get(code) || 0) + delta);
}
const expectedCurrent = inventory.reduce((sum, row) => {
  const code = `NJU-RC-${row._id}`;
  return sum + toNumber(row['现有数量']) + (materialDeltas.get(code) || 0);
}, 0);
equal('物资', '当前数量汇总', materialsApi.stats.totalCurrentQuantity, expectedCurrent);

const materialsByCode = new Map(materialsApi.inventory.map((item) => [item.code, item]));
for (const row of deterministicSample(inventory, 10)) {
  const code = `NJU-RC-${row._id}`;
  const actual = materialsByCode.get(code);
  check('物资', `样本 ${code}`, Boolean(actual)
    && actual.initial === toNumber(row['初始数量'])
    && actual.baselineQuantity === toNumber(row['现有数量'])
    && actual.quantity === toNumber(row['现有数量']) + (materialDeltas.get(code) || 0), '初始/基线/流水后数量一致');
}

// Volunteer: five complete tables, top event aggregates, and recent check-ins.
const volunteerTables = {
  registrations: '活动报名总表',
  checkins: '活动签到',
  approvals: '登记审批',
  profiles: '个人主页（编辑版）',
  hours: '活动及时长汇总表',
};
const volunteerRows = Object.fromEntries(await Promise.all(Object.entries(volunteerTables).map(async ([key, table]) => [key, await listAllRows(volunteer, table)])));
for (const [key, rows] of Object.entries(volunteerRows)) equal('志愿', `${key} 总数`, volunteerApi.source.reads[key].total, rows.length);

const rawEvents = new Map();
for (const row of volunteerRows.registrations) {
  const name = cellText(row['活动名称'], '未命名活动');
  const item = rawEvents.get(name) || { registrations: 0, confirmed: 0, checkedIn: 0 };
  item.registrations += 1;
  if (isFlagOn(row['是否报名成功']) || isFlagOn(row['报名结果'])) item.confirmed += 1;
  rawEvents.set(name, item);
}
for (const row of volunteerRows.checkins) {
  const name = cellText(row['活动名称'], '未命名活动');
  const item = rawEvents.get(name);
  if (item) item.checkedIn += 1;
}
for (const event of volunteerApi.events.slice(0, 10)) {
  const expected = rawEvents.get(event.name);
  check('志愿', `活动聚合样本 ${checks.filter((item) => item.scope === '志愿' && item.label.startsWith('活动聚合样本')).length + 1}`,
    Boolean(expected) && event.registrations === expected.registrations && event.confirmed === expected.confirmed && event.checkedIn === expected.checkedIn,
    '报名/确认/签到一致');
}
const expectedRecent = volunteerRows.checkins.slice(-8).reverse();
equal('志愿', '最近签到样本数量', volunteerApi.recentCheckins.length, expectedRecent.length);
expectedRecent.forEach((row, index) => {
  const actual = volunteerApi.recentCheckins[index];
  check('志愿', `签到样本 ${index + 1}`, actual?.activity === cellText(row['活动名称'], '未命名活动') && actual?.verified === isFlagOn(row['已核对并录入']), '活动名称/核对状态一致');
});

// Outreach: legacy source totals and ten projected campaign rows.
// 课程反馈投稿模块已于 v2 移除，只剩策划案与文创两个源表。
const outreachSources = [
  ['planning', '博爱青春策划案 线下答辩', 'planning'],
  ['creative', '博爱青春纪念品大赛', 'creative'],
];
const outreachRows = Object.fromEntries(await Promise.all(outreachSources.map(async ([key, table]) => [key, await listAllRows(main, table)])));
equal('宣传', '策划案总数', outreachApi.stats.planningCount, outreachRows.planning.length);
equal('宣传', '文创投稿总数', outreachApi.stats.creativeCount, outreachRows.creative.length);
equal('宣传', '内容总数', outreachApi.stats.contentCount, Object.values(outreachRows).reduce((sum, rows) => sum + rows.length, 0));

const campaignById = new Map(outreachApi.campaigns.map((item) => [item.id, item]));
const campaignCandidates = outreachSources.flatMap(([key, , prefix]) => outreachRows[key].map((row) => ({ prefix, row })));
for (const { prefix, row } of deterministicSample(campaignCandidates, 10)) {
  const id = `${prefix}:${row._id}`;
  const actual = campaignById.get(id);
  check('宣传', `内容样本 ${id}`, Boolean(actual) && !String(actual.author).includes('[object Object]') && Boolean(actual.authorization), '投影存在且作者/授权字段可读');
}

const failures = checks.filter((item) => !item.passed);
for (const scope of ['物资', '志愿', '宣传']) {
  const scoped = checks.filter((item) => item.scope === scope);
  const passed = scoped.filter((item) => item.passed).length;
  console.log(`${passed === scoped.length ? 'PASS' : 'FAIL'} ${scope}: ${passed}/${scoped.length}`);
  for (const failure of scoped.filter((item) => !item.passed)) console.log(`  - ${failure.label}: ${failure.detail}`);
}
console.log(`${failures.length ? 'FAIL' : 'PASS'} 总计: ${checks.length - failures.length}/${checks.length}; SeaTable 写入=0`);
if (failures.length) process.exitCode = 1;
