/**
 * 身份与信任（Mainline A）端到端冒烟。
 *
 * 覆盖：非 smail 邮箱被拒、smail 注册成功（console 通道回传 devCode）、
 * 错误验证码被拒、验证码一次性（重复使用失败）、正确验证码建立会话并发身份码、
 * 注册后可直接用邮箱+密码登录（运行时账号动态查找）、同邮箱重复注册被拒、
 * 短密码被拒、账号档案不含密码哈希、发码限频（60 秒冷却 → 429），
 * 以及收尾清理（账号 / 验证码 / 发件记录 / 审计，残留 0 行）。
 *
 * 用法：BASE_URL=http://localhost:3200 node scripts/smoke-identity.mjs
 * 前提：账号表已播种（npm run accounts:apply），SMTP 未配置（走 console 通道）。
 */

const BASE = (process.env.BASE_URL || 'http://localhost:3200').replace(/\/$/, '');
const SUFFIX = `SMOKE-${Date.now().toString(36).toUpperCase()}`;
const EMAIL = `${SUFFIX.toLowerCase()}@smail.nju.edu.cn`;
const PASSWORD = 'smoke-Pass-2026';

const results = [];
function log(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
}

/** 带 cookie + csrf 的最小客户端。 */
class Client {
  constructor() {
    this.cookie = '';
    this.csrf = '';
  }

  async call(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    const mutating = !['GET', 'HEAD'].includes(method.toUpperCase());
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    // CSRF 与动词绑定：无 body 的变更请求也要带令牌。
    if (mutating) headers['X-CSRF-Token'] = this.csrf;
    let response;
    try {
      response = await fetch(`${BASE}${path}`, { method, headers, body, redirect: 'manual' });
    } catch (error) {
      return { status: 0, payload: { message: error.message } };
    }
    this.absorbCookies(response);
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: String(text).slice(0, 160) }; }
    return { status: response.status, payload: parsed };
  }

  absorbCookies(response) {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    const [pair, ...attributes] = setCookie.split(';');
    const cleared = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    this.cookie = cleared ? '' : pair;
  }

  async login(username, password) {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
console.log(`\n=== 身份与信任冒烟 @ ${BASE} (邮箱 ${EMAIL}) ===\n`);

const ADMIN_USERNAME = process.env.SMOKE_ADMIN_USERNAME || 'admin1';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'njuredcross';

// 1. 非 smail 邮箱注册被拒
const badDomain = await new Client().call('/api/auth/register', { method: 'POST', body: { email: `${SUFFIX}@gmail.com`, password: PASSWORD, displayName: '外部邮箱' } });
log('非校园邮箱注册被拒（400）', badDomain.status === 400 && /smail|nju/.test(badDomain.payload?.message || ''), `status=${badDomain.status} msg=${(badDomain.payload?.message || '').slice(0, 40)}`);

// 2. 短密码被拒
const shortPwd = await new Client().call('/api/auth/register', { method: 'POST', body: { email: `${SUFFIX}b@smail.nju.edu.cn`, password: '123', displayName: '短密码' } });
log('短密码注册被拒（400）', shortPwd.status === 400, `status=${shortPwd.status}`);

// 3. smail 注册成功并拿到 devCode（console 通道）
const registrar = new Client();
const reg = await registrar.call('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD, displayName: '身份冒烟' } });
const devCode = reg.payload?.devCode || '';
log('smail 邮箱注册成功（201）', reg.status === 201 && Boolean(devCode), `status=${reg.status} devCode=${devCode ? '有' : '无'}`);

// 4. 同邮箱重复注册被拒（409）
const dup = await new Client().call('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
log('同邮箱重复注册被拒（409）', dup.status === 409, `status=${dup.status}`);

// 5. 错误验证码被拒
const verifier = new Client();
const wrong = await verifier.call('/api/auth/verify-email', { method: 'POST', body: { email: EMAIL, code: '000000' } });
log('错误验证码被拒（401）', wrong.status === 401, `status=${wrong.status}`);

// 6. 正确验证码 → 会话 + 身份码
const verify = await verifier.call('/api/auth/verify-email', { method: 'POST', body: { email: EMAIL, code: devCode } });
const memberCode = verify.payload?.memberCode || '';
const codeFormatOk = /^RC-M-[A-HJ-KM-NP-Z2-9]{8}$/.test(memberCode);
log(
  '正确验证码建立会话并签发身份码',
  verify.status === 200 && Boolean(verify.payload?.csrfToken) && codeFormatOk && verify.payload?.user?.role === 'member',
  `status=${verify.status} memberCode=${memberCode}`,
);

// 7. 验证码一次性：同一码再用失败
const reuse = await new Client().call('/api/auth/verify-email', { method: 'POST', body: { email: EMAIL, code: devCode } });
log('验证码用后即失效（重复使用被拒）', reuse.status === 400 || reuse.status === 401, `status=${reuse.status}`);

// 8. 未登录读档案被拒
const anon = await new Client().call('/api/auth/account');
log('未登录读账号档案被拒（401）', anon.status === 401, `status=${anon.status}`);

// 9. 登录后档案正确且不含密码哈希
const profile = await verifier.call('/api/auth/account');
const profileJson = JSON.stringify(profile.payload || {});
log(
  '账号档案正确且不含密码哈希',
  profile.status === 200 && profile.payload?.account?.email === EMAIL && profile.payload?.account?.memberCode === memberCode && !profileJson.includes('密码哈希') && !profileJson.toLowerCase().includes('passwordhash'),
  `status=${profile.status} memberCode=${profile.payload?.account?.memberCode}`,
);

// 10. 注册后可直接邮箱+密码登录（运行时动态查找，无需重启）
const relogin = new Client();
const loginAgain = await relogin.login(EMAIL, PASSWORD);
log(
  '注册账号可用邮箱+密码直接登录',
  loginAgain.status === 200 && loginAgain.payload?.user?.memberCode === memberCode,
  `status=${loginAgain.status} memberCode=${loginAgain.payload?.user?.memberCode}`,
);

// 11. 发码限频：用第二个「未验证」邮箱验证 60 秒冷却（已验证邮箱会被 400 短路）
const EMAIL2 = `b${SUFFIX.toLowerCase()}@smail.nju.edu.cn`;
const cooldownClient = new Client();
await cooldownClient.call('/api/auth/register', { method: 'POST', body: { email: EMAIL2, password: PASSWORD, displayName: '冷却测试' } });
const resend = await cooldownClient.call('/api/auth/email-codes', { method: 'POST', body: { email: EMAIL2, purpose: 'register' } });
log('发码限频：冷却期内重发被拒（429）', resend.status === 429, `status=${resend.status}`);

/* -------------------------------------------------------------------------- *
 * 收尾：回收全部测试行（账号 / 验证码 / 发件记录 / 审计）
 * -------------------------------------------------------------------------- */
const admin = new Client();
const adminLogin = await admin.login(ADMIN_USERNAME, ADMIN_PASSWORD);
log('管理员登录（回收用）', adminLogin.status === 200, `status=${adminLogin.status}`);

const stamp = SUFFIX.toLowerCase();
const cleanupTables = ['平台账号表', '邮箱验证码表', '邮件发件记录表', '操作审计表'];
let removed = 0;
let expected = 0;
for (const table of cleanupTables) {
  const listed = await admin.call(`/api/rows?table=${encodeURIComponent(table)}`);
  const rows = listed.payload?.rows || [];
  const matched = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(stamp));
  expected += matched.length;
  for (const row of matched) {
    const del = await admin.call(`/api/rows/${encodeURIComponent(row._id)}?table=${encodeURIComponent(table)}`, { method: 'DELETE' });
    if (del.status === 200) removed += 1;
  }
}

let residualRows = 0;
for (const table of cleanupTables) {
  const listed = await admin.call(`/api/rows?table=${encodeURIComponent(table)}`);
  const rows = listed.payload?.rows || [];
  residualRows += rows.filter((row) => JSON.stringify(row).toLowerCase().includes(stamp)).length;
}
log('回收全部测试行且残留 0 行', removed === expected && residualRows === 0, `删除 ${removed}/${expected}，残留 ${residualRows}`);

/* -------------------------------------------------------------------------- */
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 结果：${passed}/${results.length} 通过 · 残留 ${residualRows} 行 ===`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('失败项：');
  for (const item of failed) console.log(`  · ${item.step}${item.detail ? ` (${item.detail})` : ''}`);
  process.exitCode = 1;
}
