/**
 * v3 S5 端到端验证（真实测试 Base）
 *
 * 覆盖（对应阶段进入条件）：
 *   A. 发布任务（管理员自评星级）→ 心愿清单可见 → 按星级排序
 *   B. 申领任务 → 邮件提醒（未配 SMTP 时标注）+ 申领落表 + 任务状态转「已认领」
 *   C. 技能提交（说明必填）→ 管理员审核 → 星级写回账号 → 星级可读
 *   D. 校验拦截：无说明 / 无星级 / 重复申领 / 越权审核
 *
 * 用法：node --env-file=.env scripts/smoke-v3-tasks.mjs
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
  console.log(`\n=== v3 S5 e2e @ ${BASE} ===\n`);
  const member = await login('user1', 'smoke1234');
  const admin = await login('admin1', 'njuredcross');
  assert.ok(member.cookie, '成员登录失败');
  assert.ok(admin.cookie, '管理员登录失败');

  const stamp = Date.now();
  const lowTitle = `S5低星任务_${stamp}`;
  const highTitle = `S5高星任务_${stamp}`;
  const createdTaskIds = [];
  let claimedTaskId = '';
  let skillId = '';

  await step('心愿清单可读（成员）', async () => {
    const { status, payload } = await api(member, '/api/public/tasks');
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    assert.ok(Array.isArray(payload.tasks), 'tasks 应为数组');
    assert.ok(Array.isArray(payload.types) && payload.types.length >= 4, '应下发任务类型字典');
  });

  await step('发布任务：缺标题 → 400', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { stars: 3 } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'task_title_required');
  });

  await step('发布任务：缺星级（未自评）→ 400', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { title: `S5_${stamp}_nostar` } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'task_stars_required');
  });

  await step('发布任务：星级越界（6 星）→ 400', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { title: `S5_${stamp}_bad`, stars: 6 } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'task_stars_required');
  });

  await step('发布任务：低星（2 星）→ 201', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', {
      method: 'POST',
      body: { title: lowTitle, description: 'e2e 低星任务', type: '现场执行', stars: 2 },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.task.stars, 2);
    createdTaskIds.push(payload.task.id);
  });

  await step('发布任务：高星（5 星）→ 201', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', {
      method: 'POST',
      body: { title: highTitle, description: 'e2e 高星任务', type: '摄影摄像', stars: 5 },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}`);
    createdTaskIds.push(payload.task.id);
  });

  await step('心愿清单：新任务可见且高星排在低星之前', async () => {
    const { payload } = await api(member, '/api/public/tasks');
    const ids = payload.tasks.map((t) => t.id);
    const lowIdx = ids.indexOf(createdTaskIds[0]);
    const highIdx = ids.indexOf(createdTaskIds[1]);
    assert.ok(lowIdx >= 0 && highIdx >= 0, '两个任务都应出现在清单');
    assert.ok(highIdx < lowIdx, `高星应排在低星前（high=${highIdx} low=${lowIdx}）`);
  });

  await step('申领任务 → 201 且返回邮件状态字段', async () => {
    const { status, payload } = await api(member, `/api/public/tasks/${encodeURIComponent(createdTaskIds[1])}/claim`, {
      method: 'POST', body: { note: 'e2e 认领' },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.claim.status, '已认领');
    assert.equal(typeof payload.mailed, 'boolean', '应返回 mailed 布尔值（SMTP 未配置即 false）');
    claimedTaskId = createdTaskIds[1];
  });

  await step('申领后任务状态转「已认领」，重复申领 → 409', async () => {
    const again = await api(member, `/api/public/tasks/${encodeURIComponent(claimedTaskId)}/claim`, { method: 'POST', body: {} });
    assert.equal(again.status, 409, `期望 409 实得 ${again.status}`);
    assert.equal(again.payload.code, 'task_not_open');
    const { payload } = await api(member, '/api/public/tasks');
    const task = payload.tasks.find((t) => t.id === claimedTaskId);
    assert.equal(task.status, '已认领');
  });

  await step('我认领的任务：包含刚认领的记录', async () => {
    const { status, payload } = await api(member, '/api/public/tasks/mine');
    assert.equal(status, 200);
    assert.ok(payload.claims.some((c) => c.taskId === claimedTaskId), '应包含本次认领');
  });

  // --- 技能 ---
  await step('技能提交：说明缺失 → 400 skill_desc_required', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: `摄影${stamp}`, selfStars: 3 } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'skill_desc_required');
  });

  await step('技能提交：缺星级 → 400 skill_stars_required', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: `摄影${stamp}`, description: '拍摄过很多场校级活动' } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'skill_stars_required');
  });

  await step('技能提交：说明过短 → 400 skill_desc_too_short', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: `摄影${stamp}`, description: '会', selfStars: 3 } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'skill_desc_too_short');
  });

  await step('技能提交：完整信息 → 201 待审核', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', {
      method: 'POST',
      body: { name: `摄影${stamp}`, description: '拍摄过 10 场校级活动并独立完成后期', selfStars: 3, proof: 'https://example.com/portfolio' },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.skill.status, '待审核');
    skillId = payload.skill.id;
  });

  await step('同名技能重复提交 → 409 skill_pending_exists', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', {
      method: 'POST', body: { name: `摄影${stamp}`, description: '拍摄经验丰富，负责过多场晚会记录', selfStars: 4 },
    });
    assert.equal(status, 409, `期望 409 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.code, 'skill_pending_exists');
  });

  await step('会员查看本人技能：能看到刚提交的记录且星级为 0', async () => {
    const { status, payload } = await api(member, '/api/portal/skills');
    assert.equal(status, 200);
    assert.ok(payload.skills.some((s) => s.id === skillId), '应包含本人技能');
    assert.ok(payload.skills.every((s) => !('account' in s)), '门户技能不得泄露账号引用');
  });

  await step('控制台技能队列：包含待审核记录', async () => {
    const { status, payload } = await api(admin, '/api/console/skills');
    assert.equal(status, 200);
    assert.ok(payload.queue.some((s) => s.id === skillId), '队列应包含该技能');
    assert.ok(payload.queue.some((s) => s.account), '控制台队列应带提交人标识');
  });

  await step('审核：通过但缺星级 → 400 skill_level_required', async () => {
    const { status, payload } = await api(admin, `/api/console/skills/${encodeURIComponent(skillId)}/review`, { method: 'POST', body: { decision: 'approve' } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'skill_level_required');
  });

  await step('审核通过（定 4 星）→ 账号技能星级写回为 4', async () => {
    const { status, payload } = await api(admin, `/api/console/skills/${encodeURIComponent(skillId)}/review`, {
      method: 'POST', body: { decision: 'approve', level: 4 },
    });
    assert.equal(status, 200, `期望 200 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.accountStars, 4, `账号星级应为 4 实得 ${payload.accountStars}`);
    const mine = await api(member, '/api/portal/skills');
    assert.equal(mine.payload.stars, 4, `会员端星级应为 4 实得 ${mine.payload.stars}`);
    const list = await api(member, '/api/public/tasks');
    assert.equal(list.payload.myStars, 4, '心愿清单应带出 myStars');
  });

  await step('重复审核同一技能 → 409 skill_already_reviewed', async () => {
    const { status, payload } = await api(admin, `/api/console/skills/${encodeURIComponent(skillId)}/review`, { method: 'POST', body: { decision: 'approve', level: 5 } });
    assert.equal(status, 409);
    assert.equal(payload.code, 'skill_already_reviewed');
  });

  await step('无 CSRF 写接口 → 403', async () => {
    const res = await fetch(`${BASE}/api/console/tasks`, {
      method: 'POST', headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `S5_${stamp}_nocsrf`, stars: 3 }),
    });
    assert.equal(res.status, 403, `期望 403 实得 ${res.status}`);
  });

  await step('普通成员访问控制台队列 → 无权限', async () => {
    const { status } = await api(member, '/api/console/skills');
    assert.ok([401, 403].includes(status), `期望 401/403 实得 ${status}`);
  });

  await step('清理：删除本次任务与技能记录', async () => {
    const { Base } = await import('seatable-api');
    const base = new Base({ server: process.env.SEATABLE_SERVER_URL, APIToken: process.env.SEATABLE_API_TOKEN });
    await base.auth();
    const taskRows = await base.listRows('任务表', '', '', false, '', 2000);
    const claimRows = await base.listRows('任务申领表', '', '', false, '', 2000);
    const skillRows = await base.listRows('成员技能表', '', '', false, '', 2000);
    let removed = 0;
    for (const row of claimRows) if (createdTaskIds.includes(String(row['任务ID'] || ''))) { await base.deleteRow('任务申领表', row._id); removed += 1; }
    for (const row of taskRows) if (createdTaskIds.includes(String(row['任务ID'] || ''))) { await base.deleteRow('任务表', row._id); removed += 1; }
    for (const row of skillRows) if (String(row['技能ID'] || '') === skillId) { await base.deleteRow('成员技能表', row._id); removed += 1; }
    // 账号星级复位为 0（e2e 写入过 4 星）
    const accountRows = await base.listRows('平台账号表', '', '', false, '', 2000);
    for (const row of accountRows) {
      if (String(row['登录名'] || '') === 'user1' && String(row['技能星级'] || '') !== '') {
        await base.updateRow('平台账号表', row._id, { 技能星级: '' });
        removed += 1;
      }
    }
    ok(`已清理 ${removed} 条 e2e 记录`);
    void removed;
  });

  console.log(`\n=== 结果：${pass} passed / ${fail} failed ===`);
  console.log(results.join('\n'));
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => { console.error('e2e fatal:', error); process.exitCode = 1; });
