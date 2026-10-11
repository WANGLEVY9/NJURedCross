/**
 * v3.1/v3.2 存储三级结构端到端验证（真实测试 Base + 真实 NJU Box）
 *
 * 覆盖：
 *   A. 槽位前置校验：缺部门 / 非法部门 / 缺活动 / 活动不在项目表 → 400，且不落行
 *   B. 投稿附件落点：/<部门>/<活动名>/<附件ID>/<文件名>，云端目录真实建出
 *   C. 同部门同活动下，其他文件直接落二级活动目录（不另建子目录）
 *   D. 删除：文件与附件专属目录一并清理，二级活动目录不被误删
 *
 * v3.2 变更：活动名白名单化（禁手填）后，本脚本改用**活动项目表里的真实活动名**，
 * 并只清理自己创建的附件专属目录，绝不删除真实活动目录（那是他人/历史数据）。
 *
 * 用法：node --env-file=.env scripts/smoke-v31-storage.mjs
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

const PDF_BYTES = Buffer.from('%PDF-1.4\n% e2e attachment\n%%EOF\n');

async function main() {
  console.log(`\n=== v3.1 存储结构 e2e @ ${BASE} ===\n`);
  const member = await login('user1', 'smoke1234');
  assert.ok(member.cookie, '成员登录失败');

  const box = await import('../lib/attachment/box.js');
  const cfg = {
    njuboxServerUrl: process.env.NJUBOX_SERVER_URL,
    njuboxToken: process.env.NJUBOX_MAIN_TOKEN,
  };
  const center = '博爱中心';
  let activity = '';
  let attachmentId = '';

  await step('准备：取「博爱中心」在活动项目表里的真实活动名（v3.2 活动禁手填）', async () => {
    const { status, payload } = await api(member, `/api/public/media/activities?center=${encodeURIComponent(center)}`);
    assert.equal(status, 200, `活动候选接口异常：${status}`);
    const names = (payload?.activities || []).map((item) => item.name).filter(Boolean);
    assert.ok(names.length, `「${center}」在活动项目表里没有候选活动，无法验证落点`);
    activity = names[0];
    ok(`使用真实活动：${activity}`);
  });

  if (!activity) {
    console.log(results.join('\n'));
    console.error('\n前置失败：没有可用的真实活动名，后续用例无法执行。');
    process.exitCode = 1;
    return;
  }

  await step('槽位：缺部门 → 400 attachment_center_invalid', async () => {
    const { status, payload } = await api(member, '/api/public/attachments', {
      method: 'POST', body: { filename: 'a.pdf', mimeType: 'application/pdf', size: PDF_BYTES.length, activity },
    });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'attachment_center_invalid');
  });

  await step('槽位：部门不在五中心白名单 → 400', async () => {
    const { status, payload } = await api(member, '/api/public/attachments', {
      method: 'POST', body: { filename: 'a.pdf', mimeType: 'application/pdf', size: PDF_BYTES.length, center: '第九中心', activity },
    });
    assert.equal(status, 400);
    assert.equal(payload.code, 'attachment_center_invalid');
  });

  await step('槽位：缺活动 → 400 attachment_activity_missing', async () => {
    const { status, payload } = await api(member, '/api/public/attachments', {
      method: 'POST', body: { filename: 'a.pdf', mimeType: 'application/pdf', size: PDF_BYTES.length, center },
    });
    assert.equal(status, 400);
    assert.equal(payload.code, 'attachment_activity_missing');
  });

  await step('槽位：活动不在活动项目表候选内 → 400 attachment_activity_not_allowed（禁手填）', async () => {
    const { status, payload } = await api(member, '/api/public/attachments', {
      method: 'POST',
      body: { filename: 'a.pdf', mimeType: 'application/pdf', size: PDF_BYTES.length, center, activity: `E2E未登记活动_${Date.now()}` },
    });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'attachment_activity_not_allowed');
  });

  await step('槽位：部门 + 活动齐全（表内活动）→ 201', async () => {
    const { status, payload } = await api(member, '/api/public/attachments', {
      method: 'POST',
      body: { filename: `e2e附件_${Date.now()}.pdf`, mimeType: 'application/pdf', size: PDF_BYTES.length, center, activity },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    attachmentId = payload.attachment.id;
    assert.match(attachmentId, /^ATT-/);
    console.log(`     槽位附件ID：${attachmentId}`);
  });

  await step('上传：multipart → 200 已上传', async () => {
    const form = new FormData();
    form.append('file', new Blob([PDF_BYTES], { type: 'application/pdf' }), `e2e附件_${Date.now()}.pdf`);
    const res = await fetch(`${BASE}/api/public/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'POST', headers: { cookie: member.cookie, 'X-CSRF-Token': member.csrf }, body: form,
    });
    const payload = await res.json().catch(() => ({}));
    assert.equal(res.status, 200, `期望 200 实得 ${res.status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.attachment.status, '已上传');
  });

  await step('云端核对：/<部门>/<活动名>/<附件ID>/ 真实建出且含文件', async () => {
    const targetDir = `/${center}/${activity}/${attachmentId}`;
    const entries = await box.listDir(cfg, targetDir);
    assert.ok(entries, `云端目录不存在：${targetDir}`);
    const files = entries.filter((e) => e.type === 'file');
    assert.equal(files.length, 1, `${targetDir} 应有 1 个文件，实得 ${files.length}`);
    assert.match(files[0].name, /^e2e附件_\d+\.pdf$/, `文件名不符：${files[0].name}`);
    console.log(`     云端核对：${targetDir}/${files[0].name}`);
  });

  await step('云端核对：二级活动目录不含「其他文件/其他资料」子目录（其他文件直接落二级）', async () => {
    const level2 = (await box.listDir(cfg, `/${center}/${activity}`)) || [];
    const dirs = level2.filter((e) => e.type === 'dir').map((e) => e.name);
    assert.ok(dirs.includes(attachmentId), `二级目录下应有本次附件专属目录，实得 ${JSON.stringify(dirs)}`);
    assert.ok(!dirs.includes('其他资料') && !dirs.includes('其他文件'), '不应再建「其他文件/其他资料」子目录');
  });

  await step('删除附件 → 文件与专属目录一并清理，活动目录保留', async () => {
    const { status } = await api(member, `/api/public/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    const gone = await box.listDir(cfg, `/${center}/${activity}/${attachmentId}`);
    assert.equal(gone, null, '附件专属目录应已删除');
    const still = await box.listDir(cfg, `/${center}/${activity}`);
    assert.ok(still, '二级活动目录必须保留（不得误删）');
  });

  await step('清理：只兜底移除本次的附件专属目录（真实活动目录一律不动）', async () => {
    const dir = `/${center}/${activity}/${attachmentId}`;
    if (await box.listDir(cfg, dir) === null) { ok(`已经没有残留：${dir}`); return; }
    await box.deleteDir(cfg, dir);
    assert.equal(await box.listDir(cfg, dir), null, `目录应已删除：${dir}`);
    ok(`已删除残留目录 ${dir}`);
  });

  console.log(`\n=== 结果：${pass} passed / ${fail} failed ===`);
  console.log(results.join('\n'));
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => { console.error('e2e fatal:', error); process.exitCode = 1; });
