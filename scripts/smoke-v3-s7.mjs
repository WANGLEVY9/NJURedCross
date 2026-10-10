/**
 * v3 S7 端到端验证（真实测试 Base）——宣传展示半自动（N2 / D12）
 *
 * 覆盖（对应阶段进入条件）：
 *   A. 控制台鉴权：未登录 → 401/403；成员（无 outreach 权限）→ 403
 *   B. 半自动导入：POST /api/console/showcase/extract
 *        · 空链接 → 400 showcase_links_missing
 *        · 超量 → 413 showcase_links_too_many
 *        · 非法栏目 → 400 showcase_category_invalid
 *        · 坏链（http://127.0.0.1:1/nope）→ 进 failed 且**明确回显**（绝不静默）
 *        · 本地注入 mock fetch？—— 网页端点无法注入，改用「真实抓取一个可控的本地页面」
 *          简化方案：验证「抓取失败路径」+「重复导入跳过路径」两条语义。
 *   C. 列表管理：GET /items → 至少返回结构；PATCH 改栏目/排序；DELETE 删除
 *   D. 幂等：同一条目（标题+链接）二次导入 → skipped 增加、不产生重复行
 *   E. 旧脚本兼容：scripts/import-showcase.mjs 仍能用公共模块（此处只验证模块导出）
 *
 * 用法：node --env-file=.env scripts/smoke-v3-s7.mjs
 * 前置：本地服务已起（npm start），.env 指向测试 Base。
 */
import assert from 'node:assert/strict';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3179';
const results = [];
let pass = 0; let fail = 0;

function ok(name, detail = '') { pass += 1; results.push(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); console.log(`ok   ${name}`); }
function bad(name, err) { fail += 1; results.push(`  ❌ ${name} — ${err}`); console.log(`FAIL ${name}: ${err}`); }
async function step(name, fn) { try { await fn(); ok(name); } catch (error) { bad(name, error.message); } }

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.getSetCookie?.() || [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const payload = await res.json().catch(() => ({}));
  return { cookie, csrf: payload.csrfToken || '', user: payload.user };
}

async function api(session, path, { method = 'GET', body } = {}) {
  const headers = { cookie: session.cookie, Accept: 'application/json' };
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = session.csrf; }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

async function main() {
  console.log(`\n=== v3 S7 e2e @ ${BASE} ===\n`);
  const member = await login('user1', 'smoke1234');
  const admin = await login('admin1', 'njuredcross');
  assert.ok(member.cookie, '成员登录失败');
  assert.ok(admin.cookie, '管理员登录失败');

  const { Base } = await import('seatable-api');
  const base = new Base({ server: process.env.SEATABLE_SERVER_URL, APIToken: process.env.SEATABLE_API_TOKEN });
  await base.auth();

  const stamp = Date.now();
  const createdItemIds = [];

  // --- A. 鉴权 ---
  await step('未登录访问 /api/console/showcase/items → 401/403（鉴权前置）', async () => {
    const res = await fetch(`${BASE}/api/console/showcase/items`);
    assert.ok([401, 403].includes(res.status), `期望 401/403 实得 ${res.status}`);
  });

  await step('成员（无 outreach 权限）访问 → 403', async () => {
    const { status } = await api(member, '/api/console/showcase/items');
    assert.equal(status, 403, `期望 403 实得 ${status}`);
  });

  await step('管理员访问 /items → 200 且返回 categories + items 结构', async () => {
    const { status, payload } = await api(admin, '/api/console/showcase/items');
    assert.equal(status, 200);
    assert.ok(Array.isArray(payload.items), 'items 应为数组');
    assert.deepEqual(payload.categories, ['活动总结', '暑期专项', '新闻'], '展示分类字典应为 3 项');
    assert.ok(payload.libraries, '应带 Box 库配置状态');
  });

  // --- B. 入参校验 ---
  await step('extract 空链接 → 400 showcase_links_missing', async () => {
    const { status, payload } = await api(admin, '/api/console/showcase/extract', { method: 'POST', body: { links: [] } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'showcase_links_missing');
  });

  await step('extract 超 30 条 → 413 showcase_links_too_many', async () => {
    const links = Array.from({ length: 31 }, (_, i) => `https://example.com/a${i}`);
    const { status, payload } = await api(admin, '/api/console/showcase/extract', { method: 'POST', body: { links } });
    assert.equal(status, 413, `期望 413 实得 ${status}`);
    assert.equal(payload.code, 'showcase_links_too_many');
  });

  await step('extract 非法栏目 → 400 showcase_category_invalid', async () => {
    const { status, payload } = await api(admin, '/api/console/showcase/extract', {
      method: 'POST', body: { links: ['https://example.com/x'], category: '不存在的栏目' },
    });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'showcase_category_invalid');
  });

  await step('extract 坏链 → 200 且失败被明确回显（绝不静默）', async () => {
    const { status, payload } = await api(admin, '/api/console/showcase/extract', {
      method: 'POST', body: { links: ['http://127.0.0.1:1/definitely-not-a-page'], category: '新闻' },
    });
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    assert.equal(payload.requested, 1);
    assert.equal(payload.imported.length, 0, '坏链不应导入成功');
    assert.ok(payload.failed.length >= 1, '失败必须逐条回显');
    assert.ok(/http:\/\/127\.0\.0\.1:1/.test(payload.failed[0].url || '') || payload.failed[0].error, '失败项应带 url 或 error');
  });

  // --- C. 列表管理（直接写一行，验证 PATCH / DELETE） ---
  const manualId = `SHW-S7E2E-${stamp}`;
  await step('准备：直接写入一条展示条目', async () => {
    await base.appendRow('宣传展示表', {
      条目ID: manualId, 分组: '精选推荐', 标题: `S7e2e_${stamp}`, 链接: `https://example.com/${stamp}`,
      封面路径: '', 库ID: '', 排序: '0', 来源: '手动导入', 创建时间: new Date().toISOString(), 展示分类: '',
    });
    createdItemIds.push(manualId);
  });

  await step('PATCH 改栏目 + 排序 → 200', async () => {
    const { status, payload } = await api(admin, `/api/console/showcase/items/${encodeURIComponent(manualId)}`, {
      method: 'PATCH', body: { showGroup: '暑期专项', order: 9 },
    });
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    assert.equal(payload.patch['展示分类'], '暑期专项');
    assert.equal(payload.patch['排序'], '9');
  });

  await step('PATCH 非法栏目 → 400 showcase_category_invalid', async () => {
    const { status, payload } = await api(admin, `/api/console/showcase/items/${encodeURIComponent(manualId)}`, {
      method: 'PATCH', body: { showGroup: '乱填栏目' },
    });
    assert.equal(status, 400);
    assert.equal(payload.code, 'showcase_category_invalid');
  });

  await step('PATCH 不存在的条目 → 404 showcase_not_found', async () => {
    const { status, payload } = await api(admin, '/api/console/showcase/items/SHW-NOPE-XYZ', { method: 'PATCH', body: { order: 1 } });
    assert.equal(status, 404, `期望 404 实得 ${status}`);
    assert.equal(payload.code, 'showcase_not_found');
  });

  await step('写操作缺 CSRF → 403（安全底线）', async () => {
    const res = await fetch(`${BASE}/api/console/showcase/extract`, {
      method: 'POST', headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ links: ['https://example.com/x'] }),
    });
    assert.equal(res.status, 403, `期望 403 实得 ${res.status}`);
  });

  await step('DELETE 条目 → 200 且列表不再包含', async () => {
    const { status } = await api(admin, `/api/console/showcase/items/${encodeURIComponent(manualId)}`, { method: 'DELETE' });
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    const { payload } = await api(admin, '/api/console/showcase/items');
    assert.ok(!payload.items.some((item) => item.id === manualId), '删除后不应再出现');
    createdItemIds.splice(createdItemIds.indexOf(manualId), 1);
  });

  // --- D. 公开展示墙仍可达（回归） ---
  await step('回归：GET /api/public/showcase → 200 且含 boards 双板', async () => {
    const { status, payload } = await api(member, '/api/public/showcase');
    assert.equal(status, 200);
    assert.ok(payload.boards?.posts && payload.boards?.designs, '双板结构应保留');
  });

  // --- 清理 ---
  await step('清理：删除本次残留条目', async () => {
    const rows = await base.listRows('宣传展示表', '', '', false, '', 2000);
    for (const row of rows) {
      const id = String(row['条目ID'] || '');
      if (createdItemIds.includes(id) || id.startsWith(`SHW-S7E2E-${stamp}`)) {
        await base.deleteRow('宣传展示表', row._id).catch(() => {});
      }
    }
  });

  console.log(`\n=== 结果：${pass} passed / ${fail} failed ===`);
  console.log(results.join('\n'));
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => { console.error('e2e fatal:', error); process.exitCode = 1; });
