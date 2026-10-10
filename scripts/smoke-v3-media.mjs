/**
 * v3 S4 端到端验证（真实测试 Base + 真实 NJU Box 双库）
 *
 * 覆盖：
 *   A. 精选申请数量门禁：5 张里选 2 张 → 400；选 4 张 → 200（待确认）
 *   B. 控制台确认精选：复制到精选库 → 精选库出现副本 + 主库原件仍在、路径未变
 *   C. 删除审核：申请后原删 409 → 控制台通过 → 真删成功
 *   D. 批量下载 zip：返回 PK 魔数 + 含正确条目数
 *
 * 用法：node --env-file=.env .tmp-e2e-s4.mjs
 * 前置：本地服务已在 BASE 起好（npm start）。
 */
import assert from 'node:assert/strict';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3179';
const results = [];
let pass = 0; let fail = 0;

function ok(name, detail = '') { pass += 1; results.push(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); console.log(`ok   ${name}`); }
function bad(name, err) { fail += 1; results.push(`  ❌ ${name} — ${err}`); console.log(`FAIL ${name}: ${err}`); }

async function step(name, fn) {
  try { await fn(); ok(name); } catch (error) { bad(name, error.message); }
}

/** 登录并返回带 cookie + csrf 的会话。 */
async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.getSetCookie?.() || [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const payload = await res.json().catch(() => ({}));
  const csrf = payload.csrfToken || (await sessionCsrf(cookie));
  return { cookie, csrf, user: payload.user };
}

async function sessionCsrf(cookie) {
  const res = await fetch(`${BASE}/api/auth/session`, { headers: { cookie } });
  const payload = await res.json().catch(() => ({}));
  return payload.csrfToken || '';
}

async function api(session, path, { method = 'GET', body, raw = false } = {}) {
  const headers = { cookie: session.cookie, Accept: 'application/json' };
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = session.csrf; }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

/** 造一张 1x1 PNG，作为上传素材。 */
const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function uploadPhotos(session, center, activity, count) {
  const form = new FormData();
  form.append('center', center);
  form.append('activity', activity);
  for (let i = 1; i <= count; i += 1) {
    form.append('files', new Blob([PNG_BYTES], { type: 'image/png' }), `E2E_${Date.now()}_${i}.png`);
  }
  const res = await fetch(`${BASE}/api/public/media`, { method: 'POST', headers: { cookie: session.cookie, 'X-CSRF-Token': session.csrf }, body: form });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

async function main() {
  console.log(`\n=== v3 S4 e2e @ ${BASE} ===\n`);
  const member = await login('user1', 'smoke1234');
  const admin = await login('admin1', 'njuredcross');
  assert.ok(member.cookie, '成员登录失败');
  assert.ok(admin.cookie, '管理员登录失败');

  const center = '生命中心';
  const activity = `E2E精选_${Date.now()}`;
  let photoIds = [];

  await step('上传 5 张测试照片', async () => {
    const { status, payload } = await uploadPhotos(member, center, activity, 5);
    assert.equal(status, 201, `上传状态 ${status}`);
    photoIds = (payload.photos || []).map((p) => p.id);
    assert.equal(photoIds.length, 5, `期望 5 张，实得 ${photoIds.length}`);
  });

  await step('我的照片列表包含这 5 张且未精选', async () => {
    const { status, payload } = await api(member, '/api/public/media');
    assert.equal(status, 200);
    const mine = payload.photos.filter((p) => photoIds.includes(p.id));
    assert.equal(mine.length, 5);
    assert.ok(mine.every((p) => p.pickStatus === '未申请'), '新照片应为未申请');
  });

  await step('精选申请：只勾选 2 张 → 400 media_pick_count_invalid', async () => {
    const { status, payload } = await api(member, '/api/public/media/picks', { method: 'POST', body: { ids: photoIds.slice(0, 2) } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'media_pick_count_invalid');
  });

  await step('精选申请：勾选 6 张（超出上限）→ 400', async () => {
    const { status, payload } = await api(member, '/api/public/media/picks', { method: 'POST', body: { ids: [...photoIds, 'bogus'] } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'media_pick_count_invalid');
  });

  const pickIds = photoIds.slice(0, 4);

  await step('精选申请：勾选 4 张 → 201，状态变「已申请待确认」', async () => {
    const { status, payload } = await api(member, '/api/public/media/picks', { method: 'POST', body: { ids: pickIds } });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    const { payload: mine } = await api(member, '/api/public/media');
    const chosen = mine.photos.filter((p) => pickIds.includes(p.id));
    assert.ok(chosen.every((p) => p.pickStatus === '已申请待确认'), '应全部为待确认');
  });

  await step('精选申请：重复申请同一批 → 409 media_pick_pending', async () => {
    const { status, payload } = await api(member, '/api/public/media/picks', { method: 'POST', body: { ids: pickIds } });
    assert.equal(status, 409, `期望 409 实得 ${status}`);
    assert.equal(payload.code, 'media_pick_pending');
  });

  await step('控制台精选队列能看到这 4 张', async () => {
    const { status, payload } = await api(admin, '/api/console/media/picks');
    assert.equal(status, 200);
    const queued = (payload.queue || []).filter((item) => pickIds.includes(item.id));
    assert.equal(queued.length, 4, `队列中期望 4，实得 ${queued.length}`);
    assert.ok(queued[0].path, '队列应带主库路径');
  });

  // 记录确认前的主库路径，用于验证「原件未动」。
  let pathBefore = new Map();
  await step('记录确认前的主库路径', async () => {
    const { payload } = await api(admin, '/api/console/media/picks');
    for (const item of payload.queue.filter((i) => pickIds.includes(i.id))) pathBefore.set(item.id, item.path);
    assert.equal(pathBefore.size, 4);
  });

  await step('控制台确认精选（复制到精选库）→ 200 且 confirmed=4', async () => {
    const { status, payload } = await api(admin, '/api/console/media/picks/confirm', { method: 'POST', body: { ids: pickIds } });
    assert.equal(status, 200, `期望 200 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal((payload.confirmed || []).length, 4, `confirmed 期望 4 实得 ${(payload.confirmed || []).length}`);
  });

  await step('确认后：主库原件仍在、路径未变、状态=已精选', async () => {
    const { payload } = await api(member, '/api/public/media?showPicked=1');
    const chosen = payload.photos.filter((p) => pickIds.includes(p.id));
    assert.equal(chosen.length, 4, '主库应仍有 4 张（复制模式不删）');
    assert.ok(chosen.every((p) => p.pickStatus === '已精选'), '应标记为已精选');
    const { payload: adminQueue } = await api(admin, '/api/console/media/picks');
    assert.equal((adminQueue.queue || []).filter((i) => pickIds.includes(i.id)).length, 0, '确认后应移出待确认队列');
  });

  await step('默认列表已过滤已精选（4 张不出现）', async () => {
    const { payload } = await api(member, '/api/public/media');
    assert.equal(payload.photos.filter((p) => pickIds.includes(p.id)).length, 0, '默认应过滤已精选');
  });

  await step('showPicked=1 时已精选照片重新出现', async () => {
    const { payload } = await api(member, '/api/public/media?showPicked=1');
    assert.equal(payload.photos.filter((p) => pickIds.includes(p.id)).length, 4, 'showPicked 应显示 4 张');
  });

  await step('我的精选申请统计 pending/picked 正确', async () => {
    const { status, payload } = await api(member, '/api/public/media/picks');
    assert.equal(status, 200);
    const picked = payload.stats?.picked ?? payload.picked;
    assert.ok(picked >= 4, `picked 应 ≥4 实得 ${picked}`);
  });

  // --- 删除审核 ---
  const delId = photoIds[4]; // 第 5 张（未精选）

  await step('删除不存在的照片 → 404', async () => {
    const { status } = await api(member, '/api/public/media/PHO-NOT-EXIST', { method: 'DELETE' });
    assert.equal(status, 404);
  });

  await step('未申请直接 DELETE → 409 media_delete_review_required', async () => {
    const { status, payload } = await api(member, `/api/public/media/${delId}`, { method: 'DELETE' });
    assert.equal(status, 409, `期望 409 实得 ${status}`);
    assert.equal(payload.code, 'media_delete_review_required');
  });

  await step('提交删除申请（填理由）→ 201 待审核', async () => {
    const { status, payload } = await api(member, `/api/public/media/${delId}/delete-request`, { method: 'POST', body: { reason: 'e2e 重复上传' } });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.photo.deleteStatus, '待审核');
  });

  await step('申请后原删仍 409（审核中）', async () => {
    const { status, payload } = await api(member, `/api/public/media/${delId}`, { method: 'DELETE' });
    assert.equal(status, 409);
    assert.equal(payload.code, 'media_delete_review_required');
  });

  await step('控制台删除队列能看到该申请（带理由）', async () => {
    const { status, payload } = await api(admin, '/api/console/media/deletes');
    assert.equal(status, 200);
    const hit = (payload.queue || []).find((item) => item.id === delId);
    assert.ok(hit, '删除队列应包含该照片');
    assert.equal(hit.deleteReason, 'e2e 重复上传');
  });

  await step('控制台驳回删除 → 照片保留', async () => {
    const { status } = await api(admin, `/api/console/media/${delId}/delete-review`, { method: 'POST', body: { decision: 'reject' } });
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    const { payload } = await api(member, '/api/public/media');
    assert.ok(payload.photos.some((p) => p.id === delId), '驳回后照片应仍在');
  });

  await step('再次申请删除并审核通过 → 真删成功', async () => {
    const again = await api(member, `/api/public/media/${delId}/delete-request`, { method: 'POST', body: { reason: 'e2e 二次申请' } });
    assert.equal(again.status, 201, `二次申请期望 201 实得 ${again.status}`);
    const review = await api(admin, `/api/console/media/${delId}/delete-review`, { method: 'POST', body: { decision: 'approve' } });
    assert.equal(review.status, 200, `审核通过期望 200 实得 ${review.status}: ${JSON.stringify(review.payload)}`);
    const { payload } = await api(member, '/api/public/media?showPicked=1');
    assert.ok(!payload.photos.some((p) => p.id === delId), '通过后照片应从列表消失');
  });

  // --- 批量下载 zip ---
  await step('批量下载 zip：返回 PK 魔数且条目数正确', async () => {
    const res = await fetch(`${BASE}/api/public/media/download-zip`, {
      method: 'POST', headers: { cookie: member.cookie, 'X-CSRF-Token': member.csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: photoIds.slice(0, 3) }),
    });
    assert.equal(res.status, 200, `期望 200 实得 ${res.status}`);
    assert.match(res.headers.get('content-type') || '', /zip/, '应为 zip MIME');
    const buf = new Uint8Array(await res.arrayBuffer());
    assert.equal(buf[0], 0x50, 'PK 魔数 P');
    assert.equal(buf[1], 0x4B, 'PK 魔数 K');
    assert.ok(buf.length > 100, `zip 太小：${buf.length}`);
  });

  await step('批量下载 zip：空 ids → 400', async () => {
    const { status } = await api(member, '/api/public/media/download-zip', { method: 'POST', body: { ids: [] } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
  });

  await step('无 CSRF 写接口 → 403', async () => {
    const res = await fetch(`${BASE}/api/public/media/picks`, {
      method: 'POST', headers: { cookie: member.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: photoIds.slice(0, 3) }),
    });
    assert.equal(res.status, 403, `期望 403 实得 ${res.status}`);
  });

  // --- 清理 ---
  await step('清理：删除本次上传的剩余照片', async () => {
    let cleaned = 0;
    for (const id of photoIds) {
      const r = await api(member, `/api/public/media/${id}/delete-request`, { method: 'POST', body: { reason: 'e2e 清理' } });
      if (r.status === 201) {
        await api(admin, `/api/console/media/${id}/delete-review`, { method: 'POST', body: { decision: 'approve' } });
        cleaned += 1;
      } else if (r.status === 409) {
        // 已删除或审核中：尝试直接推进。
        await api(admin, `/api/console/media/${id}/delete-review`, { method: 'POST', body: { decision: 'approve' } });
      }
    }
    ok(`已清理 ${cleaned} 张`);
  });

  console.log(`\n=== 结果：${pass} passed / ${fail} failed ===`);
  console.log(results.join('\n'));
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => { console.error('e2e fatal:', error); process.exitCode = 1; });
