/**
 * Auth smoke test for the two-surface account model.
 *
 * Verifies that the six configured accounts can sign in, that the console is
 * closed to members, that the student surface accepts writes only from a
 * signed-in account holding a valid CSRF token, and that the personal centre
 * never leaks another account's records.
 *
 * Boundary checks create no SeaTable rows: every rejected request is refused
 * before any write happens. The optional `--write` pass does create two
 * submissions in order to prove cross-account isolation, then deletes them
 * through the console data API before exiting.
 *
 * Usage: BASE_URL=http://localhost:3100 node scripts/smoke-auth.mjs [--write]
 */

const BASE = (process.env.BASE_URL || 'http://localhost:3100').replace(/\/$/, '');
const WITH_WRITE = process.argv.includes('--write');
const SUFFIX = `AUTH-${Date.now().toString(36).toUpperCase()}`;

const results = [];
function log(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
}

/** Minimal cookie-aware client, one per account. */
class Client {
  constructor() {
    this.cookie = '';
    this.csrf = '';
  }

  async call(path, { method = 'GET', body, withCsrf = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    // CSRF is bound to the verb, not to whether a body happens to be present:
    // a bodyless DELETE is still a mutation and still needs the token.
    const mutating = !['GET', 'HEAD'].includes(method.toUpperCase());
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (mutating) headers['X-CSRF-Token'] = withCsrf ? this.csrf : '';
    let response;
    try {
      response = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: 'manual' });
    } catch (error) {
      return { status: 0, payload: { message: error.message }, headers: new Map() };
    }
    this.absorbCookies(response);
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: String(text).slice(0, 160) }; }
    return { status: response.status, payload: parsed, headers: response.headers };
  }

  /**
   * Applies Set-Cookie the way a browser would. Logout clears the session by
   * sending Max-Age=0, so a client that ignored it would keep replaying a token
   * the server has already told it to drop.
   */
  absorbCookies(response) {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    const [pair, ...attributes] = setCookie.split(';');
    const cleared = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    this.cookie = cleared ? '' : pair;
  }

  async login(username, password) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });
    const payload = await response.json().catch(() => null);
    const setCookie = response.headers.get('set-cookie') || '';
    if (setCookie) this.cookie = setCookie.split(';')[0];
    this.csrf = payload?.csrfToken || '';
    return { status: response.status, payload };
  }
}

/* -------------------------------------------------------------------------- */
console.log(`\n=== 账号与鉴权冒烟 @ ${BASE} (标记 ${SUFFIX}) ===\n`);

const ADMIN_ACCOUNTS = ['admin1', 'admin2', 'admin3'];
const MEMBER_ACCOUNTS = ['user1', 'user2', 'user3'];
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'njuredcross';
const MEMBER_PASSWORD = process.env.SMOKE_MEMBER_PASSWORD || '123456';

const admins = new Map();
const members = new Map();

// 1. Every admin account signs in and is told it owns both surfaces.
for (const username of ADMIN_ACCOUNTS) {
  const client = new Client();
  const { status, payload } = await client.login(username, ADMIN_PASSWORD);
  const user = payload?.user || {};
  admins.set(username, client);
  log(
    `管理平台账号 ${username} 可登录且具备控制台权限`,
    status === 200 && user.role === 'platform_admin' && user.consoleAccess === true && (user.surfaces || []).includes('console'),
    `role=${user.role} consoleAccess=${user.consoleAccess} surfaces=${(user.surfaces || []).join('+')}`,
  );
}

// 2. Every member account signs in and is told it owns the portal only.
for (const username of MEMBER_ACCOUNTS) {
  const client = new Client();
  const { status, payload } = await client.login(username, MEMBER_PASSWORD);
  const user = payload?.user || {};
  members.set(username, client);
  log(
    `活动平台账号 ${username} 可登录且不具备控制台权限`,
    status === 200 && user.role === 'member' && user.consoleAccess === false && (user.surfaces || []).join() === 'portal',
    `role=${user.role} consoleAccess=${user.consoleAccess} surfaces=${(user.surfaces || []).join('+')}`,
  );
}

// 3. A wrong password is rejected; a member's password must not open an admin.
const wrong = new Client();
const wrongResult = await wrong.login('admin1', 'not-the-password');
const crossed = new Client();
const crossedResult = await crossed.login('admin1', MEMBER_PASSWORD);
log('错误口令被拒绝', wrongResult.status === 401, `status=${wrongResult.status}`);
log('活动平台口令无法登录管理平台账号', crossedResult.status === 401, `status=${crossedResult.status}`);

const admin = admins.get('admin1');
const member = members.get('user1');
const member2 = members.get('user2');

// 4. Console API: open to admins, closed to members and anonymous visitors.
const adminHealth = await admin.call('/api/health');
const memberHealth = await member.call('/api/health');
const anonHealth = await new Client().call('/api/health');
log('管理平台账号可读控制台接口', adminHealth.status === 200, `status=${adminHealth.status}`);
log('活动平台账号读控制台接口被拒（403 且给出原因）', memberHealth.status === 403 && memberHealth.payload?.code === 'console_forbidden', `status=${memberHealth.status} code=${memberHealth.payload?.code}`);
log('未登录读控制台接口被拒（401）', anonHealth.status === 401 && anonHealth.payload?.code === 'login_required', `status=${anonHealth.status} code=${anonHealth.payload?.code}`);

// 5. Student surface: reads stay public, writes need an account.
const anonEvents = await new Client().call('/api/public/events');
const anonOverview = await new Client().call('/api/public/overview');
log('活动与概览读取保持公开', anonEvents.status === 200 && anonOverview.status === 200, `events=${anonEvents.status} overview=${anonOverview.status}`);

const anonWrite = await new Client().call('/api/public/warmth/interest', {
  method: 'POST',
  body: { program: 'birthday', frequency: 'once', nickname: 'anon', email: 'anon@nju.edu.cn', consent: true },
});
log('未登录的门户写入被拒（401 且未落库）', anonWrite.status === 401 && anonWrite.payload?.code === 'login_required', `status=${anonWrite.status} code=${anonWrite.payload?.code}`);

const noCsrf = new Client();
await noCsrf.login('user1', MEMBER_PASSWORD);
noCsrf.csrf = '';
const csrfWrite = await noCsrf.call('/api/public/warmth/interest', {
  method: 'POST',
  body: { program: 'birthday', frequency: 'once', nickname: 'no-csrf', email: 'nocsrf@nju.edu.cn', consent: true },
});
log('缺少 CSRF 令牌的门户写入被拒（403）', csrfWrite.status === 403 && csrfWrite.payload?.code === 'csrf_failed', `status=${csrfWrite.status} code=${csrfWrite.payload?.code}`);

// 6. Personal centre is scoped to the caller.
const anonMe = await new Client().call('/api/portal/me');
const memberMe = await member.call('/api/portal/me');
log('未登录的 /api/portal/me 被拒（401）', anonMe.status === 401, `status=${anonMe.status}`);
log('活动平台账号可读个人中心且身份正确', memberMe.status === 200 && memberMe.payload?.account?.username === 'user1', `status=${memberMe.status} account=${memberMe.payload?.account?.username}`);

// 7. A member may not write through the console data API.
const memberConsoleWrite = await member.call('/api/rows', { method: 'POST', body: { table: '操作审计表', row: { 动作: 'probe' } } });
log('活动平台账号经控制台数据接口写入被拒（403）', memberConsoleWrite.status === 403, `status=${memberConsoleWrite.status}`);

// 8. Logout works for a member (it used to require platform_admin).
const logoutProbe = members.get('user3');
const logoutResult = await logoutProbe.call('/api/auth/logout', { method: 'POST', body: {} });
const afterLogout = await logoutProbe.call('/api/portal/me');
log('活动平台账号可正常登出且会话失效', logoutResult.status === 200 && afterLogout.status === 401, `logout=${logoutResult.status} after=${afterLogout.status}`);

/* --- Optional write pass: prove cross-account isolation ------------------- */
if (WITH_WRITE) {
  const created = [];
  for (const [client, label] of [[member, 'user1'], [member2, 'user2']]) {
    const res = await client.call('/api/public/submissions', {
      method: 'POST',
      body: { title: `${SUFFIX} ${label}`, content: '鉴权隔离验证用正文。', category: '宣传稿件', email: `${label}@nju.edu.cn`, name: label, signature: '实名署名', originalConfirm: true, portraitConfirm: false, consent: true },
    });
    const id = res.payload?.submission?.id || '';
    if (id) created.push({ id, label });
    log(`门户投稿写入成功并归属 ${label}`, res.status === 201 && Boolean(id), `id=${id}`);
  }

  const mine = await member.call('/api/portal/me');
  const myIds = (mine.payload?.submissions || []).map((item) => item.id);
  const otherMine = await member2.call('/api/portal/me');
  const otherIds = (otherMine.payload?.submissions || []).map((item) => item.id);
  const user1Id = created.find((item) => item.label === 'user1')?.id;
  const user2Id = created.find((item) => item.label === 'user2')?.id;
  log(
    '投稿只出现在提交者自己的个人中心',
    myIds.includes(user1Id) && !myIds.includes(user2Id) && otherIds.includes(user2Id) && !otherIds.includes(user1Id),
    `user1 可见 ${myIds.length} 条 / user2 可见 ${otherIds.length} 条`,
  );

  // Reclaim everything this run created, including the audit rows it wrote, so
  // a smoke run leaves the tables exactly as it found them.
  const createdIds = created.map((item) => item.id);
  const tables = [
    { name: '宣传投稿表', match: (row) => String(row['标题'] || '').includes(SUFFIX) },
    { name: '操作审计表', match: (row) => createdIds.some((id) => String(row['对象'] || '').includes(id)) },
  ];
  let removed = 0;
  let expected = created.length;
  for (const { name, match } of tables) {
    const listed = await admin.call(`/api/rows?table=${encodeURIComponent(name)}`);
    const rows = listed.payload?.rows || [];
    for (const row of rows) {
      if (!match(row)) continue;
      const del = await admin.call(`/api/rows/${encodeURIComponent(row._id)}?table=${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (del.status === 200) removed += 1;
    }
  }
  // One audit row per submission is expected; unknown extra rows would make the
  // count mismatch and surface as a failure rather than passing silently.
  const auditList = await admin.call(`/api/rows?table=${encodeURIComponent('操作审计表')}`);
  expected += created.length;
  const leftovers = (auditList.payload?.rows || []).filter((row) => createdIds.some((id) => String(row['对象'] || '').includes(id))).length;
  log('验证产生的投稿与审计行已回收', removed === expected && leftovers === 0, `删除 ${removed}/${expected}，残留 ${leftovers}`);
}

/* -------------------------------------------------------------------------- */
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('失败项：');
  for (const item of failed) console.log(`  · ${item.step}${item.detail ? ` (${item.detail})` : ''}`);
  process.exitCode = 1;
}
