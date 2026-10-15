/**
 * 增量回归测试：签到凭证安全（main 后端契约）。
 *
 * 复用 main 的凭证实现（issueCheckinTicket / checkinByTicket，注册表缺省密钥）：
 *   · 仅“已确认”报名可签发；过期 / 篡改 / 格式错误 / 绑定活动不符 / 报名不存在 的核验被拒绝；
 *   · 重复核验幂等（返回同一条签到）；核验留痕（核验人 / 核验说明）；已请假（已释放）不可签发。
 *
 * 说明：请假释放与重新报名、并发不超卖由 main 的 tests/workflow-checkin-reentry.test.mjs 覆盖，此处不重复。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWorkflow, WF } from '../lib/events/workflow.js';

// main 的 createWorkflow 在测试（未注入 checkinSecret）时使用固定回退密钥。
const SECRET = 'workflow-checkin-fallback-secret';
function signTicket(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `WCT-${body}.${mac}`;
}

const body = { name: '合成值班', date: '2026-10-04', slot: '上午', position: '签到岗', capacity: 2, serviceHours: 2, trainingHours: 0.5, travelHours: 1, location: '测试地点', work: '合成现场服务' };
const t0 = () => Date.parse('2026-10-04T09:00:00+08:00');
const student = { accountId: 'synthetic-account', studentId: '999990001', realName: '测试同学', email: '999990001@smail.nju.edu.cn', emailVerified: true };
function fixture(now = t0, tables = Object.fromEntries(Object.values(WF).map(name => [name, []]))) {
  let seq = 0; const state = { tables };
  const base = {
    async listRows(table, _v, _o, _c, start = 0, limit = 500) { return structuredClone(state.tables[table].slice(start, start + limit)); },
    async appendRow(table, row) { const r = { ...row, _id: `r-${++seq}` }; state.tables[table].push(r); return { _id: r._id }; },
    async updateRow(table, id, patch) { Object.assign(state.tables[table].find(r => r._id === id), patch); },
    async getMetadata() { return { tables: [] }; },
  };
  return { tables: state.tables, workflow: createWorkflow(base, { now }) };
}
async function published(w, now = t0) { const e = await w.create(body, 'organizer'); await w.approve(e._id, 'reviewer'); await w.publish(e._id); return e; }

test('only a confirmed registration can be issued a check-in ticket', async () => {
  const { workflow: w } = fixture();
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await assert.rejects(w.issueCheckinTicket(reg._id, 'admin'), { statusCode: 409 });
  await w.confirm(reg._id);
  const issued = await w.issueCheckinTicket(reg._id, 'admin');
  assert.ok(typeof issued.ticket === 'string' && issued.ticket.startsWith('WCT-'));
  assert.equal(issued.活动ID, e['活动ID']);
});

test('verifying a valid ticket checks in and leaves a trace (verifier / note)', async () => {
  const { tables, workflow: w } = fixture();
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await w.confirm(reg._id);
  const issued = await w.issueCheckinTicket(reg._id, 'admin');
  const checkin = await w.checkinByTicket(issued.ticket, 'verifier', '核对身份与现场照片');
  assert.equal(checkin['报名行ID'], reg._id);
  assert.equal(checkin['核验人'], 'verifier');
  assert.equal(checkin['核验说明'], '核对身份与现场照片');
  assert.equal(tables[WF.registrations].find(r => r._id === reg._id)['报名状态'], '已签到');
  assert.equal(tables[WF.checkins].length, 1);
});

test('verifying the same ticket twice is idempotent', async () => {
  const { tables, workflow: w } = fixture();
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await w.confirm(reg._id);
  const issued = await w.issueCheckinTicket(reg._id, 'admin');
  const first = await w.checkinByTicket(issued.ticket, 'admin', '一');
  const second = await w.checkinByTicket(issued.ticket, 'admin', '二');
  assert.equal(first._id, second._id);
  assert.equal(tables[WF.checkins].length, 1);
});

test('expired ticket is rejected', async () => {
  const clock = { t: Date.parse('2026-10-04T09:00:00+08:00') };
  const { workflow: w } = fixture(() => clock.t);
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await w.confirm(reg._id);
  const issued = await w.issueCheckinTicket(reg._id, 'admin');
  clock.t = Date.parse('2026-10-04T10:00:00+08:00'); // 远超 30 分钟有效期
  await assert.rejects(w.checkinByTicket(issued.ticket, 'admin', '晚到'), { statusCode: 409 });
});

test('tampered or malformed ticket is rejected', async () => {
  const { workflow: w } = fixture();
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await w.confirm(reg._id);
  const issued = await w.issueCheckinTicket(reg._id, 'admin');
  const [bodyPart, sigPart] = issued.ticket.slice(4).split('.');
  await assert.rejects(w.checkinByTicket(`WCT-${bodyPart}.${sigPart.slice(0, -1)}x`), { statusCode: 403 });
  await assert.rejects(w.checkinByTicket('not-a-ticket'), { statusCode: 403 });
});

test('ticket bound to a different activity is rejected', async () => {
  const { workflow: w } = fixture();
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await w.confirm(reg._id);
  const exp = Date.parse('2026-10-04T09:00:00+08:00') + 30 * 60_000;
  const forged = signTicket({ reg: reg._id, act: 'WRONG-ACTIVITY', exp });
  await assert.rejects(w.checkinByTicket(forged, 'admin', '错绑'), { statusCode: 403 });
});

test('ticket for a non-existent registration is rejected', async () => {
  const { workflow: w } = fixture();
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await w.confirm(reg._id);
  const exp = Date.parse('2026-10-04T09:00:00+08:00') + 30 * 60_000;
  const ghost = signTicket({ reg: 'r-ghost', act: e['活动ID'], exp });
  await assert.rejects(w.checkinByTicket(ghost, 'admin', '幽灵'), { statusCode: 404 });
});

test('a released (approved-leave) registration cannot be issued a ticket', async () => {
  const { tables, workflow: w } = fixture();
  const e = await published(w);
  const reg = await w.register(e._id, student);
  await w.confirm(reg._id);
  await w.requestLeave(reg['报名ID'], student, '请假');
  await w.decideLeave(reg._id, true, '批准');
  assert.equal(tables[WF.registrations].find(r => r._id === reg._id)['报名状态'], '已请假');
  await assert.rejects(w.issueCheckinTicket(reg._id, 'admin'), { statusCode: 409 });
});
