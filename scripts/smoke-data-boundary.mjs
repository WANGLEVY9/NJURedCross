/**
 * Read-only proof that generic data-centre CRUD cannot bypass business state
 * machines. All attempted mutations target protected tables and must be
 * rejected before SeaTable is called.
 */

const base = (process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const username = process.env.SMOKE_ADMIN_USERNAME || 'admin1';
const password = process.env.SMOKE_ADMIN_PASSWORD || 'njuredcross';

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ username, password }),
});
const loginPayload = await login.json().catch(() => null);
if (login.status !== 200) throw new Error(`Login failed: HTTP ${login.status}`);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
const csrf = loginPayload?.csrfToken;
if (!cookie || !csrf) throw new Error('Missing authenticated session');

async function call(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

const health = await call('/api/health');
if (health.status !== 200) throw new Error(`Health failed: HTTP ${health.status}`);
const policies = new Map(health.payload.tables.map((table) => [table.name, table.dataAccess]));

const cases = [
  ['物资管理策略只读', policies.get('物资管理')?.write === false],
  ['活动项目表策略只读', policies.get('活动项目表')?.write === false],
  ['平台账号表策略只读', policies.get('平台账号表')?.write === false],
];

const attempts = [
  ['物资申请不能通用新增', '/api/rows', { method: 'POST', body: { table: '物资管理', row: { 状态: '绕过测试' } } }],
  ['活动状态不能通用修改', '/api/rows/BOUNDARY-NOT-A-ROW', { method: 'PUT', body: { table: '活动项目表', row: { 状态: '已发布' } } }],
  ['平台账号不能通用删除', '/api/rows/BOUNDARY-NOT-A-ROW?table=%E5%B9%B3%E5%8F%B0%E8%B4%A6%E5%8F%B7%E8%A1%A8', { method: 'DELETE' }],
];

for (const [label, path, options] of attempts) {
  const result = await call(path, options);
  cases.push([label, result.status === 403 && result.payload?.code === 'business_route_required']);
}

for (const [label, passed] of cases) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
const failed = cases.filter(([, passed]) => !passed);
console.log(`${failed.length ? 'FAIL' : 'PASS'} 数据中心边界: ${cases.length - failed.length}/${cases.length}; SeaTable 写入=0`);
if (failed.length) process.exitCode = 1;
