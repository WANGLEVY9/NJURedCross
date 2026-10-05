import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import { createWorkflow, WF } from '../lib/events/workflow.js';
import { hoursWorkbook } from '../lib/events/hours-workbook.js';
import { HOURS_EXPORT_COLUMNS } from '../lib/events/hours-export.js';
import { workflowRoutes } from '../lib/events/workflow-api.js';
import { json } from '../lib/http/response.js';

const config = { name: '合成公益活动', date: '2026-10-10', slot: '14:00–17:00', position: '服务岗', capacity: 5,
  serviceHours: 3, trainingHours: 1, travelHours: 1, location: '合成场地', work: '现场服务' };
async function fixture() {
  let seq = 0, interrupt = false;
  const rows = Object.fromEntries(Object.values(WF).map(table => [table, []]));
  const base = {
    async listRows(t, _v, _o, _c, start = 0, limit = 500) { return structuredClone(rows[t].slice(start, start + limit)); },
    async appendRow(t, value) { const row = { ...value, _id: `r${++seq}` }; rows[t].push(row); return { _id: row._id }; },
    async updateRow(t, id, patch) { if (interrupt && t === WF.registrations && patch.报名状态 === '已签到') { interrupt = false; throw new Error('合成中断'); } Object.assign(rows[t].find(r => r._id === id), patch); },
  };
  const w = createWorkflow(base), e = await w.create(config, 'organizer');
  await w.approve(e._id, 'reviewer'); await w.publish(e._id);
  const regs = [];
  for (let i = 0; i < 2; i++) {
    const sid = `99999000${i + 1}`;
    const r = await w.register(e._id, { accountId: `account-${i}`, studentId: sid, realName: `测试同学${i + 1}`, department: '测试院系', email: `${sid}@smail.nju.edu.cn`, emailVerified: true });
    await w.confirm(r._id); regs.push(r);
  }
  return { rows, base, w, e, regs, interrupt: () => { interrupt = true; } };
}
const values = { serviceHours: 2.5, trainingHours: 0.5, travelHours: 0, work: '实际服务工作' };
test('an asynchronous schema guard blocks all writes before attendance can be partially saved', async () => {
  const f = await fixture();
  const guarded = createWorkflow(f.base, { assertWritable: async () => { throw new Error('schema required'); } });
  await assert.rejects(guarded.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: values }], 'checker'), /schema required/);
  assert.equal(f.rows[WF.checkins].length, 0); assert.equal(f.rows[WF.ledger].length, 0);
});
test('batch attendance records editable per-person hours without remarks, approval or immediate posting', async () => {
  const f = await fixture();
  const out = await f.w.attendanceBatch(f.e._id, f.regs.map(r => ({ id: r._id, hours: values })), 'checker');
  assert.equal(out.succeeded, 2); assert.equal(out.failed, 0);
  assert.equal(f.rows[WF.checkins].length, 2); assert.equal(f.rows[WF.ledger].length, 2);
  assert.equal(f.rows[WF.ledger][0].服务时长, '2.5'); assert.equal(f.rows[WF.ledger][0].交通时长, '0');
  assert.equal(f.rows[WF.ledger][0].工作内容, values.work); assert.equal(f.rows[WF.ledger][0].状态, '待批准');
  assert.equal(f.rows[WF.profiles].length, 0);
  const draft = await f.w.reviewDraft(f.e._id); assert.deepEqual(draft.columns, HOURS_EXPORT_COLUMNS);
  assert.equal(draft.rows[0].培训时长, 0.5); assert.match(draft.rows[0].正式工作日期, /14:00/);
  await assert.rejects(f.w.exportDraft(f.e._id), /没有已批准/);
});
test('invalid values fail per row without creating attendance; cross-event and duplicate batches never write', async () => {
  const f = await fixture();
  const invalid = await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: { ...values, serviceHours: -1 } }, { id: f.regs[1]._id, hours: values }], 'checker');
  assert.equal(invalid.failed, 1); assert.equal(invalid.succeeded, 1); assert.equal(f.rows[WF.checkins].length, 1);
  const other = await f.w.create({ ...config, name: '另一个活动' }, 'organizer');
  await assert.rejects(f.w.attendanceBatch(other._id, [{ id: f.regs[0]._id, hours: values }], 'checker'), /其他活动/);
  await assert.rejects(f.w.attendanceBatch(f.e._id, Array(2).fill({ id: f.regs[0]._id, hours: values }), 'checker'), /重复/);
  assert.equal(f.rows[WF.checkins].length, 1);
});
test('retry after an interrupted attendance link restores exactly one checkin and ledger', async () => {
  const f = await fixture(); f.interrupt();
  const items = [{ id: f.regs[0]._id, hours: values }];
  assert.equal((await f.w.attendanceBatch(f.e._id, items, 'checker')).failed, 1);
  assert.equal((await f.w.attendanceBatch(f.e._id, items, 'checker')).succeeded, 1);
  const entry = f.rows[WF.ledger][0];
  assert.equal((await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: { ...values, expectedDigest: entry.核对摘要 } }], 'checker')).succeeded, 1);
  assert.equal(f.rows[WF.checkins].length, 1); assert.equal(f.rows[WF.ledger].length, 1);
});
test('chair review, stale revisions and returned edits preserve independent approval and immutable approved hours', async () => {
  const f = await fixture(); await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: values }], 'checker');
  const old = (await f.w.reviewDraft(f.e._id)).entries[0];
  assert.equal((await f.w.approveBatch(f.e._id, [{ id: old._id, expectedDigest: old.核对摘要 }], 'checker')).failed, 1);
  await f.w.returnHours(old._id, 'chair', 'platform_admin', '请核对实际工作时间', old.核对摘要);
  await f.w.reviewHours(f.regs[0]._id, 'checker', { ...values, serviceHours: 2, expectedDigest: old.核对摘要 });
  assert.equal((await f.w.approveBatch(f.e._id, [{ id: old._id, expectedDigest: old.核对摘要 }], 'chair')).failed, 1);
  const updated = (await f.w.reviewDraft(f.e._id)).entries[0];
  assert.equal((await f.w.approveBatch(f.e._id, [{ id: updated._id, expectedDigest: updated.核对摘要 }], 'chair')).succeeded, 1);
  await assert.rejects(f.w.reviewHours(f.regs[0]._id, 'checker', { ...values, expectedDigest: updated.核对摘要 }), /不能修改/);
  assert.equal((await f.w.post(updated._id)).serviceHours, 2); assert.equal((await f.w.post(updated._id)).serviceHours, 2);
  f.rows[WF.ledger][0].工作内容 = '表外篡改';
  await assert.rejects(f.w.exportDraft(f.e._id), /改变/); await assert.rejects(f.w.post(updated._id), /改变/);
});
test('binary XLSX round-trip preserves exact ten columns, text student IDs and actual numeric hours', async () => {
  const f = await fixture(); await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: values }], 'checker');
  const entry = (await f.w.reviewDraft(f.e._id)).entries[0]; await f.w.approveHours(entry._id, 'chair');
  const draft = await f.w.exportDraft(f.e._id); draft.rows[0].学号 = '001234567'; draft.rows[0].姓名 = '=1+1';
  const buffer = await hoursWorkbook(draft); assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); const sheet = workbook.getWorksheet(1);
  assert.deepEqual(sheet.getRow(1).values.slice(1), HOURS_EXPORT_COLUMNS);
  assert.equal(sheet.getCell('C2').value, '001234567'); assert.equal(sheet.getCell('A2').value, '=1+1');
  assert.equal(sheet.getCell('F2').value, 0.5); assert.equal(sheet.getCell('G2').value, 0); assert.equal(sheet.getCell('H2').value, 2.5);
});
test('new and legacy ledgers cannot be moved into another activity export even if their source digest remains intact', async () => {
  for (const legacy of [false, true]) {
    const f = await fixture(); await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: {} }], 'checker');
    const entry = (await f.w.reviewDraft(f.e._id)).entries[0]; await f.w.approveHours(entry._id, 'chair');
    const other = await f.w.create({ ...config, name: '另一活动', location: '另一场地' }, 'organizer');
    const stored = f.rows[WF.ledger][0]; stored.活动ID = other.活动ID;
    if (legacy) { stored.来源摘要 = stored.来源摘要.slice(3); stored.核对摘要 = ''; }
    await assert.rejects(f.w.exportDraft(other._id), /关联不一致/);
    await assert.rejects(f.w.post(stored._id), /关联不一致/);
  }
});
test('new routes require events permission, CSRF and trusted origin before loading data or writing', async () => {
  let reads = 0, allowed = false, csrf = true;
  const ctx = { requireConsoleAccess: (_req, _res, scope) => { assert.equal(scope, 'events'); return allowed ? { username: 'admin' } : null; },
    requireCsrf: () => csrf, getWorkflow: async () => { reads++; return {}; }, json: (_res, status, body) => ({ status, body }) };
  const req = { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' } };
  const url = new URL('http://localhost/api/volunteer/workflow/events/x/attendance-batch');
  await workflowRoutes(req, null, url, ctx); allowed = true; csrf = false; await workflowRoutes(req, null, url, ctx);
  csrf = true; req.headers.origin = 'https://foreign.example'; assert.equal((await workflowRoutes(req, null, url, ctx)).status, 403);
  assert.equal(reads, 0);
});

test('authorized HTTP export validates HEAD without CSRF and delivers a private ten-column XLSX attachment', async t => {
  const f = await fixture(); await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: values }], 'checker');
  const entry = (await f.w.reviewDraft(f.e._id)).entries[0]; await f.w.approveHours(entry._id, 'chair');
  let audited = 0, permitted = true;
  const context = { getWorkflow: async () => f.w, requireConsoleAccess: (_req, res, scope) => {
    assert.equal(scope, 'events'); if (permitted) return { username: 'chair' }; json(res, 403, { ok: false }); return null;
  }, requireCsrf: () => { throw Error('GET/HEAD must remain read-only'); }, audit: async () => { audited++; }, json };
  const server = http.createServer((req, res) => {
    void workflowRoutes(req, res, new URL(req.url, 'http://localhost'), context).catch(error => json(res, error.statusCode || 500, { ok: false, message: error.message }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/volunteer/workflow/events/${f.e._id}/hours-export`;
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0); assert.equal(audited, 0);
  const response = await fetch(url); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /spreadsheetml/);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.match(response.headers.get('content-disposition'), /attachment;.*filename\*=UTF-8/);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(workbook.getWorksheet(1).getRow(1).values.slice(1), HOURS_EXPORT_COLUMNS); assert.equal(audited, 1);
  permitted = false; assert.equal((await fetch(url, { method: 'HEAD' })).status, 403); assert.equal((await fetch(url)).status, 403); assert.equal(audited, 1);
});
