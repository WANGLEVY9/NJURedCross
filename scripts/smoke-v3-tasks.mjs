/**
 * v3 S5 端到端验证（真实测试 Base）
 *
 * v3.1（2026-10-11）改造点：
 *   · 技能认证：技能名称改下拉（8 项字典）、常用软件多选（13 项）、
 *     「绘图与二创」必交往期作品链接、选「其他」需手填。
 *   · 任务发布：必须附带技能要求（技能名称 + 所需星级）。
 *   · 任务申领：提交后进「申领审核中」，**管理员审核通过后才真正接到任务**。
 *
 * 覆盖：
 *   A. 发布任务（技能要求校验）→ 心愿清单可见 → 按星级排序
 *   B. 申领任务 → 落「待审核」+ 任务转「申领审核中」→ 管理员通过 → 任务转「已认领」
 *   C. 申领被驳回 → 任务回到「待认领」，可再次申领
 *   D. 技能提交（下拉 + 软件多选 + 条件必填）→ 管理员审核 → 星级写回账号
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

const SKILL_NAME = '图片处理';
const SKILL_NAME_B = '绘图与二创';
const DESC = '拍摄过 10 场校级活动并独立完成后期';

async function main() {
  console.log(`\n=== v3 S5 e2e @ ${BASE} ===\n`);
  const member = await login('user1', 'smoke1234');
  const admin = await login('admin1', 'njuredcross');
  assert.ok(member.cookie, '成员登录失败');
  assert.ok(admin.cookie, '管理员登录失败');

  const stamp = Date.now();
  const lowTitle = `S5低星任务_${stamp}`;
  const highTitle = `S5高星任务_${stamp}`;
  const rejectTitle = `S5驳回任务_${stamp}`;
  const createdTaskIds = [];
  const createdClaimIds = [];
  const createdSkillIds = [];
  let claimedTaskId = '';
  let pendingClaimId = '';

  await step('心愿清单可读（成员）且下发技能要求字典', async () => {
    const { status, payload } = await api(member, '/api/public/tasks');
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    assert.ok(Array.isArray(payload.tasks), 'tasks 应为数组');
    assert.ok(Array.isArray(payload.types) && payload.types.length >= 4, '应下发任务类型字典');
    assert.equal(payload.skillNames.length, 8, '应下发 8 项技能名称字典');
    assert.ok(payload.skillNames.includes('绘图与二创'), '技能字典应含「绘图与二创」');
    assert.equal(payload.claimStatuses.pending, '待审核', '应下发申领状态字典');
    assert.equal(typeof payload.stats.reviewing, 'number', 'stats 应含「申领审核中」计数');
  });

  await step('发布任务：缺标题 → 400', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { stars: 3, skillRequirement: SKILL_NAME, skillStars: 3 } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'task_title_required');
  });

  await step('发布任务：缺星级（未自评）→ 400', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { title: `S5_${stamp}_nostar`, skillRequirement: SKILL_NAME, skillStars: 3 } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'task_stars_required');
  });

  await step('发布任务：星级越界（6 星）→ 400', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { title: `S5_${stamp}_bad`, stars: 6, skillRequirement: SKILL_NAME, skillStars: 3 } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'task_stars_required');
  });

  await step('发布任务：缺技能要求 → 400 task_skill_required', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { title: `S5_${stamp}_noskill`, stars: 3 } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'task_skill_required');
  });

  await step('发布任务：技能名不在字典 → 400 task_skill_invalid', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', { method: 'POST', body: { title: `S5_${stamp}_badskill`, stars: 3, skillRequirement: '打螺丝', skillStars: 3 } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'task_skill_invalid');
  });

  await step('发布任务：技能选「其他」需手填 → 400 / 手填后 201', async () => {
    const miss = await api(admin, '/api/console/tasks', { method: 'POST', body: { title: `S5_${stamp}_otheract`, stars: 3, skillRequirement: '其他', skillStars: 2 } });
    assert.equal(miss.status, 400);
    assert.equal(miss.payload.code, 'task_skill_required');
    const filled = await api(admin, '/api/console/tasks', {
      method: 'POST',
      body: { title: `S5其他技能_${stamp}`, description: 'e2e 其他技能', type: '现场执行', stars: 2, skillRequirement: '其他', skillRequirementOther: '无人机航拍', skillStars: 2 },
    });
    assert.equal(filled.status, 201, `期望 201 实得 ${filled.status}: ${JSON.stringify(filled.payload)}`);
    createdTaskIds.push(filled.payload.task.id);
    assert.equal(filled.payload.task.skillRequirement, '无人机航拍', '手填技能名应收录');
  });

  await step('发布任务：低星（2 星）+ 技能要求 → 201', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', {
      method: 'POST',
      body: { title: lowTitle, description: 'e2e 低星任务', type: '现场执行', stars: 2, skillRequirement: SKILL_NAME, skillStars: 2 },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.task.stars, 2);
    assert.equal(payload.task.skillRequirement, SKILL_NAME, '任务应带技能要求');
    assert.equal(payload.task.skillStars, 2, '任务应带要求星级');
    createdTaskIds.push(payload.task.id);
  });

  await step('发布任务：高星（5 星）+ 技能要求 → 201', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', {
      method: 'POST',
      body: { title: highTitle, description: 'e2e 高星任务', type: '摄影摄像', stars: 5, skillRequirement: SKILL_NAME, skillStars: 4 },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}`);
    createdTaskIds.push(payload.task.id);
  });

  await step('发布任务：驳回用任务 → 201', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks', {
      method: 'POST',
      body: { title: rejectTitle, description: 'e2e 驳回任务', type: '现场执行', stars: 1, skillRequirement: SKILL_NAME, skillStars: 1 },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}`);
    createdTaskIds.push(payload.task.id);
  });

  await step('心愿清单：新任务可见且高星排在低星之前', async () => {
    const { payload } = await api(member, '/api/public/tasks');
    const ids = payload.tasks.map((t) => t.id);
    const lowIdx = ids.indexOf(createdTaskIds[1]);
    const highIdx = ids.indexOf(createdTaskIds[2]);
    assert.ok(lowIdx >= 0 && highIdx >= 0, '两个任务都应出现在清单');
    assert.ok(highIdx < lowIdx, `高星应排在低星前（high=${highIdx} low=${lowIdx}）`);
  });

  // --- 申领 → 管理员审核（v3.1 核心）---
  await step('申领任务 → 201，状态「待审核」，返回邮件状态字段', async () => {
    const { status, payload } = await api(member, `/api/public/tasks/${encodeURIComponent(createdTaskIds[2])}/claim`, {
      method: 'POST', body: { note: 'e2e 申领' },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.claim.status, '待审核', '申领必须落在「待审核」');
    assert.equal(typeof payload.mailed, 'boolean', '应返回 mailed 布尔值（SMTP 未配置即 false）');
    claimedTaskId = createdTaskIds[2];
    pendingClaimId = payload.claim.id;
    createdClaimIds.push(pendingClaimId);
  });

  await step('申领后任务转「申领审核中」，未审核前不得重复申领（409）', async () => {
    const again = await api(member, `/api/public/tasks/${encodeURIComponent(claimedTaskId)}/claim`, { method: 'POST', body: {} });
    assert.equal(again.status, 409, `期望 409 实得 ${again.status}`);
    assert.equal(again.payload.code, 'task_not_open');
    const { payload } = await api(member, '/api/public/tasks');
    const task = payload.tasks.find((t) => t.id === claimedTaskId);
    assert.equal(task.status, '申领审核中', '任务应处于「申领审核中」');
    assert.equal(task.claimedBy, '', '未审核通过前不得写入认领人');
  });

  await step('我申领的任务：包含该记录且状态为待审核', async () => {
    const { status, payload } = await api(member, '/api/public/tasks/mine');
    assert.equal(status, 200);
    const hit = payload.claims.find((c) => c.taskId === claimedTaskId);
    assert.ok(hit, '应包含本次申领');
    assert.equal(hit.status, '待审核');
  });

  await step('控制台申领队列：待审核区含该申领，且带任务详情', async () => {
    const { status, payload } = await api(admin, '/api/console/tasks/claims');
    assert.equal(status, 200, `期望 200 实得 ${status}`);
    const hit = payload.pending.find((c) => c.id === pendingClaimId);
    assert.ok(hit, '待审核队列应包含该申领');
    assert.ok(hit.task && hit.task.id === claimedTaskId, '应带出任务详情');
    assert.equal(payload.statuses.pending, '待审核');
  });

  await step('审核：驳回缺原因 → 400 claim_note_required', async () => {
    const { status, payload } = await api(admin, `/api/console/tasks/claims/${encodeURIComponent(pendingClaimId)}/review`, { method: 'POST', body: { decision: 'reject' } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'claim_note_required');
  });

  await step('成员不得审核申领（越权）', async () => {
    const { status } = await api(member, `/api/console/tasks/claims/${encodeURIComponent(pendingClaimId)}/review`, { method: 'POST', body: { decision: 'approve' } });
    assert.ok([401, 403].includes(status), `期望 401/403 实得 ${status}`);
  });

  await step('管理员通过申领 → 任务转「已认领」且写入认领人', async () => {
    const { status, payload } = await api(admin, `/api/console/tasks/claims/${encodeURIComponent(pendingClaimId)}/review`, { method: 'POST', body: { decision: 'approve' } });
    assert.equal(status, 200, `期望 200 实得 ${status}: ${JSON.stringify(payload)}`);
    const list = await api(member, '/api/public/tasks');
    const task = list.payload.tasks.find((t) => t.id === claimedTaskId);
    assert.equal(task.status, '已认领', '通过后任务应为「已认领」');
    assert.ok(task.claimedBy, '通过后应写入认领人');
    const mine = await api(member, '/api/public/tasks/mine');
    assert.equal(mine.payload.claims.find((c) => c.id === pendingClaimId).status, '已通过');
  });

  await step('重复审核同一申领 → 409 claim_already_reviewed', async () => {
    const { status, payload } = await api(admin, `/api/console/tasks/claims/${encodeURIComponent(pendingClaimId)}/review`, { method: 'POST', body: { decision: 'approve' } });
    assert.equal(status, 409, `期望 409 实得 ${status}`);
    assert.equal(payload.code, 'claim_already_reviewed');
  });

  await step('驳回路径：申领 → 驳回 → 任务回到「待认领」可再次申领', async () => {
    const claim = await api(member, `/api/public/tasks/${encodeURIComponent(createdTaskIds[3])}/claim`, { method: 'POST', body: { note: 'e2e 待驳回' } });
    assert.equal(claim.status, 201);
    createdClaimIds.push(claim.payload.claim.id);
    const review = await api(admin, `/api/console/tasks/claims/${encodeURIComponent(claim.payload.claim.id)}/review`, { method: 'POST', body: { decision: 'reject', note: 'e2e 材料不足' } });
    assert.equal(review.status, 200, `期望 200 实得 ${review.status}`);
    const list = await api(member, '/api/public/tasks');
    const task = list.payload.tasks.find((t) => t.id === createdTaskIds[3]);
    assert.equal(task.status, '待认领', '驳回后任务应重新开放');
    assert.equal(task.claimedBy, '', '驳回后不得保留认领人');
    const again = await api(member, `/api/public/tasks/${encodeURIComponent(createdTaskIds[3])}/claim`, { method: 'POST', body: { note: 'e2e 再次申领' } });
    assert.equal(again.status, 201, '驳回后应可再次申领');
    createdClaimIds.push(again.payload.claim.id);
  });

  // --- 技能（注意：技能提交有 10 次/小时的分桶限流，这里刻意压到 8 次以内）---
  await step('技能提交：名称不在字典 → 400 skill_name_invalid', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: `摄影${stamp}`, softwares: ['PS'], selfStars: 3, description: DESC } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'skill_name_invalid');
  });

  await step('技能提交：未选常用软件 → 400 skill_softwares_required', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: SKILL_NAME, selfStars: 3, description: DESC } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'skill_softwares_required');
  });

  await step('技能提交：说明缺失 → 400 skill_desc_required', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: SKILL_NAME, softwares: ['PS'], selfStars: 3 } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'skill_desc_required');
  });

  await step('技能提交：「绘图与二创」缺作品链接 → 400 skill_portfolio_required', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: SKILL_NAME_B, softwares: ['Procreate'], selfStars: 4, description: DESC } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'skill_portfolio_required');
  });

  await step('技能提交：选「其他」未手填 → 400 skill_name_other_required', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', { method: 'POST', body: { name: '其他', softwares: ['PS'], selfStars: 3, description: DESC } });
    assert.equal(status, 400, `期望 400 实得 ${status}`);
    assert.equal(payload.code, 'skill_name_other_required');
  });

  await step('技能提交：完整信息（下拉 + 软件多选）→ 201 待审核', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', {
      method: 'POST',
      body: { name: SKILL_NAME, softwares: ['PS', 'AI', 'PS'], description: DESC, selfStars: 3, proof: 'https://example.com/portfolio' },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.skill.status, '待审核');
    assert.deepEqual(payload.skill.softwares, ['PS', 'AI'], '常用软件应去重后回显');
    createdSkillIds.push(payload.skill.id);
  });

  await step('同名技能重复提交 → 409 skill_pending_exists', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', {
      method: 'POST', body: { name: SKILL_NAME, softwares: ['PS'], description: DESC, selfStars: 4 },
    });
    assert.equal(status, 409, `期望 409 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.equal(payload.code, 'skill_pending_exists');
  });

  await step('技能提交：「绘图与二创」+ 作品链接 → 201（条件必填通过）', async () => {
    const { status, payload } = await api(member, '/api/portal/skills', {
      method: 'POST',
      body: { name: SKILL_NAME_B, softwares: ['Procreate', '画世界 pro'], description: DESC, selfStars: 4, proof: 'https://example.com/drawing' },
    });
    assert.equal(status, 201, `期望 201 实得 ${status}: ${JSON.stringify(payload)}`);
    assert.deepEqual(payload.skill.softwares, ['Procreate', '画世界 pro'], '软件多选应完整保留');
    createdSkillIds.push(payload.skill.id);
  });

  await step('会员查看本人技能：含刚提交记录且不泄露账号', async () => {
    const { status, payload } = await api(member, '/api/portal/skills');
    assert.equal(status, 200);
    assert.ok(payload.skills.some((s) => s.id === createdSkillIds[0]), '应包含本人技能');
    assert.deepEqual(payload.names.length, 8, '应下发技能名称字典');
    assert.deepEqual(payload.softwares.length, 13, '应下发常用软件字典');
    assert.ok(payload.skills.every((s) => !('account' in s)), '门户技能不得泄露账号引用');
  });

  await step('控制台技能队列：含待审核记录且带常用软件', async () => {
    const { status, payload } = await api(admin, '/api/console/skills');
    assert.equal(status, 200);
    const hit = payload.queue.find((s) => s.id === createdSkillIds[0]);
    assert.ok(hit, '队列应包含该技能');
    assert.ok(hit.account, '控制台队列应带提交人标识');
    assert.deepEqual(hit.softwares, ['PS', 'AI'], '队列应带常用软件');
  });

  await step('审核：通过但缺星级 → 400 skill_level_required', async () => {
    const { status, payload } = await api(admin, `/api/console/skills/${encodeURIComponent(createdSkillIds[0])}/review`, { method: 'POST', body: { decision: 'approve' } });
    assert.equal(status, 400);
    assert.equal(payload.code, 'skill_level_required');
  });

  await step('审核通过（定 4 星）→ 账号技能星级写回为 4', async () => {
    const { status, payload } = await api(admin, `/api/console/skills/${encodeURIComponent(createdSkillIds[0])}/review`, {
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
    const { status, payload } = await api(admin, `/api/console/skills/${encodeURIComponent(createdSkillIds[0])}/review`, { method: 'POST', body: { decision: 'approve', level: 5 } });
    assert.equal(status, 409);
    assert.equal(payload.code, 'skill_already_reviewed');
  });

  await step('无 CSRF 写接口 → 403', async () => {
    const res = await fetch(`${BASE}/api/console/tasks`, {
      method: 'POST', headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `S5_${stamp}_nocsrf`, stars: 3, skillRequirement: SKILL_NAME, skillStars: 3 }),
    });
    assert.equal(res.status, 403, `期望 403 实得 ${res.status}`);
  });

  await step('普通成员访问控制台队列 → 无权限', async () => {
    const { status } = await api(member, '/api/console/skills');
    assert.ok([401, 403].includes(status), `期望 401/403 实得 ${status}`);
  });

  await step('清理：删除本次任务/申领/技能记录并复位星级', async () => {
    const { Base } = await import('seatable-api');
    const base = new Base({ server: process.env.SEATABLE_SERVER_URL, APIToken: process.env.SEATABLE_API_TOKEN });
    await base.auth();
    const taskRows = await base.listRows('任务表', '', '', false, '', 2000);
    const claimRows = await base.listRows('任务申领表', '', '', false, '', 2000);
    const skillRows = await base.listRows('成员技能表', '', '', false, '', 2000);
    let removed = 0;
    for (const row of claimRows) if (createdTaskIds.includes(String(row['任务ID'] || ''))) { await base.deleteRow('任务申领表', row._id); removed += 1; }
    for (const row of taskRows) if (createdTaskIds.includes(String(row['任务ID'] || ''))) { await base.deleteRow('任务表', row._id); removed += 1; }
    for (const row of skillRows) if (createdSkillIds.includes(String(row['技能ID'] || ''))) { await base.deleteRow('成员技能表', row._id); removed += 1; }
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
