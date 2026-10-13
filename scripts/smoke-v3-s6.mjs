/**
 * v3 S6 端到端验证（真实测试 Base）
 *
 * 覆盖（对应阶段进入条件）：
 *   A. 中心-活动联动：活动项目表带「中心」列；按中心过滤候选；跨中心错配 → 400 禁手填
 *   B. 展示墙双板：/api/public/showcase 返回 boards.posts（按展示分类分节）+ boards.designs（按文创类别）
 *   C. 文创封面上限：/api/public/showcase/design-cover/:id 对未过审投稿返回 404
 *   D. 投稿栏目字典：/api/public/writing-types 下发 11 栏目 + 7 文创类型 + 3 展示分类
 *   E. 文字稿件缺栏目 → 400 article_category_required；非法栏目 → 400 article_category_invalid
 *
 * 用法：node --env-file=.env scripts/smoke-v3-s6.mjs
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
  console.log(`\n=== v3 S6 e2e @ ${BASE} ===\n`);
  const member = await login('user1', 'smoke1234');
  const admin = await login('admin1', 'njuredcross');
  assert.ok(member.cookie, '成员登录失败');
  assert.ok(admin.cookie, '管理员登录失败');

  const { Base } = await import('seatable-api');
  const base = new Base({ server: process.env.SEATABLE_SERVER_URL, APIToken: process.env.SEATABLE_API_TOKEN });
  await base.auth();

  const stamp = Date.now();
  const marker = `S6活动_${stamp}`;
  const createdProjectRows = [];

  // --- A. 中心-活动联动 ---
  await step('活动项目表已含「中心」列（v3 第 16 项 schema）', async () => {
    const cols = await base.listColumns('活动项目表');
    assert.ok(cols.some((c) => c.name === '中心'), '活动项目表应新增「中心」列');
  });

  await step('准备：写入两个不同中心的活动项目', async () => {
    const r1 = await base.appendRow('活动项目表', { 活动ID: `EVT-${stamp}-A`, 活动名称: marker, 状态: '报名中', 中心: '生命中心' });
    const r2 = await base.appendRow('活动项目表', { 活动ID: `EVT-${stamp}-B`, 活动名称: `${marker}_博爱`, 状态: '报名中', 中心: '博爱中心' });
    createdProjectRows.push(r1._id, r2._id);
    assert.ok(r1._id && r2._id);
  });

  await step('GET activities?center=生命中心 → 只含生命中心活动', async () => {
    const { status, payload } = await api(member, `/api/public/media/activities?center=${encodeURIComponent('生命中心')}`);
    assert.equal(status, 200);
    const names = payload.activities.map((a) => a.name);
    assert.ok(names.includes(marker), '应包含生命中心活动');
    assert.ok(!names.includes(`${marker}_博爱`), '不应包含博爱中心活动');
  });

  await step('GET activities?center=博爱中心 → 只含博爱中心活动', async () => {
    const { payload } = await api(member, `/api/public/media/activities?center=${encodeURIComponent('博爱中心')}`);
    const names = payload.activities.map((a) => a.name);
    assert.ok(names.includes(`${marker}_博爱`), '应包含博爱中心活动');
    assert.ok(!names.includes(marker), '不应包含生命中心活动');
  });

  await step('上传：跨中心错配（博爱活动放生命中心）→ 400 media_activity_not_allowed（禁手填）', async () => {
    const form = new FormData();
    form.set('center', '生命中心');
    form.set('activity', `${marker}_博爱`);
    form.set('files', new Blob([Buffer.from('png')], { type: 'image/png' }), 'a.png');
    const res = await fetch(`${BASE}/api/public/media`, { method: 'POST', headers: { cookie: member.cookie, 'X-CSRF-Token': member.csrf }, body: form });
    const payload = await res.json().catch(() => ({}));
    assert.equal(res.status, 400, `期望 400 实得 ${res.status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.code, 'media_activity_not_allowed');
  });

  // --- D. 类型字典 ---
  await step('GET /api/public/writing-types → 11 栏目 + 7 文创类型 + 3 展示分类', async () => {
    const { status, payload } = await api(member, '/api/public/writing-types');
    assert.equal(status, 200);
    assert.equal(payload.articleCategories.length, 11, '11 个推文栏目');
    assert.equal(payload.categories.length, 7, '7 个文创类型');
    assert.deepEqual(payload.showcaseGroups, ['活动总结', '暑期专项', '新闻']);
  });

  // --- E. 文字稿件栏目校验 ---
  await step('文字稿件缺栏目 → 400 article_category_required', async () => {
    const { status, payload } = await api(member, '/api/public/submissions/article', {
      method: 'POST', body: { title: 'e2e 缺栏目', content: '这是一段足够长的正文内容用于通过最小长度校验。', originalConfirm: true, consent: true },
    });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'article_category_required');
  });

  await step('文字稿件非法栏目 → 400 article_category_invalid', async () => {
    const { status, payload } = await api(member, '/api/public/submissions/article', {
      method: 'POST', body: { title: 'e2e 非法栏目', content: '这是一段足够长的正文内容用于通过最小长度校验。', articleCategory: '不存在的栏目', originalConfirm: true, consent: true },
    });
    assert.equal(status, 400);
    assert.equal(payload.code, 'article_category_invalid');
  });

  // --- B / C. 展示墙双板 ---
  await step('GET /api/public/showcase → 返回 boards.posts + boards.designs 双板结构', async () => {
    const { status, payload } = await api(member, '/api/public/showcase');
    assert.equal(status, 200);
    assert.ok(payload.boards, '应返回 boards 结构');
    assert.ok(payload.boards.posts, '应有公众号推文板');
    assert.ok(payload.boards.designs, '应有文创展示板');
    assert.equal(typeof payload.boards.posts.total, 'number');
    assert.equal(typeof payload.boards.designs.total, 'number');
    // 兼容字段：groups 等同 posts 分节
    assert.ok(Array.isArray(payload.groups), 'groups 兼容字段应保留');
  });

  await step('文创封面：未过审/不存在投稿 → 404', async () => {
    const res = await fetch(`${BASE}/api/public/showcase/design-cover/NOPE-${stamp}`, { headers: { cookie: member.cookie } });
    assert.equal(res.status, 404, `期望 404 实得 ${res.status}`);
  });

  // --- 清理 ---
  await step('清理：删除本次写入的活动项目行', async () => {
    for (const rowId of createdProjectRows) {
      await base.deleteRow('活动项目表', rowId).catch(() => {});
    }
    ok('已清理测试活动项目行');
  });

  console.log(`\n=== 结果：${pass} passed / ${fail} failed ===`);
  console.log(results.join('\n'));
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => { console.error('e2e fatal:', error); process.exitCode = 1; });
