import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createWorkflow, WF } from '../lib/events/workflow.js';
import { hoursWorkbook } from '../lib/events/hours-workbook.js';
import { reviewWorkbookRows } from '../lib/events/hours-review.js';
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

test('reviewer edits all seven service fields without changing identity or becoming the original checker', async () => {
  const f = await fixture();
  await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: values }], 'checker');
  const entry = (await f.w.reviewDraft(f.e._id)).entries[0];
  const details = { ...values, serviceHours: 4.5, location: '场地一\n场地二', dates: '2026-10-10 14:00–17:00\n2026-10-11 14:00–15:30', remark: '现场核实' };
  const edit = (actor, patch = details, digest = entry.核对摘要) => f.w.editReview(f.e._id, [{ id: entry._id, expectedDigest: digest, details: patch }], actor);
  assert.equal((await edit('checker')).failed, 1);
  assert.equal((await edit('chair', { ...details, 姓名: '改名' })).failed, 1);
  assert.equal((await edit('chair', { ...details, serviceHours: -1 })).failed, 1);
  assert.equal((await edit('chair', details, 'outdated')).failed, 1);
  assert.equal((await edit('chair')).succeeded, 1);
  const draft = await f.w.reviewDraft(f.e._id), updated = draft.entries[0];
  assert.equal(updated.核对人, 'checker'); assert.equal(updated.修订人, 'chair'); assert.equal(updated.状态, '待批准');
  assert.equal(draft.rows[0].姓名, f.regs[0].姓名); assert.equal(draft.rows[0].具体工作地点, details.location);
  assert.equal(draft.rows[0].正式工作日期, details.dates); assert.equal(draft.rows[0].备注, details.remark);
  assert.equal((await f.w.approveBatch(f.e._id, [{ id: entry._id, expectedDigest: entry.核对摘要 }], 'chair')).failed, 1);
  assert.equal((await f.w.approveBatch(f.e._id, [{ id: entry._id, expectedDigest: updated.核对摘要 }], 'chair')).succeeded, 1);
  assert.equal((await edit('chair', details, updated.核对摘要)).failed, 1);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await hoursWorkbook(await f.w.exportDraft(f.e._id)));
  assert.equal(workbook.worksheets[0].getCell('E2').value, details.dates);
  assert.equal(workbook.worksheets[0].getCell('H2').value, 4.5);
  f.rows[WF.ledger][0].备注 = '未授权改动'; await assert.rejects(f.w.exportDraft(f.e._id), /改变/);
});

test('blood monthly review combines multiple sessions by name and SID and excludes zero-service occurrences', async () => {
  const f = await fixture();
  f.rows.source = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((date, i) => ({ _id: `slot-${i}`, 日期: date, 点位: i % 2 ? '新街口印象汇' : '新街口中央', 活动时间: '上午 11~15点', 周次: 46 + i }));
  const w = createWorkflow(f.base, { bloodSourceTable: 'source', now: () => Date.parse('2026-10-01T00:00:00+08:00') });
  const events = (await w.overview()).events.filter(e => e._id.startsWith('BS-')).sort((a, b) => a.报名日期.localeCompare(b.报名日期));
  const ledger = [];
  for (let i = 0; i < events.length; i++) {
    const r = await w.register(events[i]._id, { accountId: 'monthly-user', studentId: '999990008', realName: '同名测试', department: '测试院系', email: '999990008@smail.nju.edu.cn', emailVerified: true });
    await w.confirm(r._id); await f.base.updateRow(WF.registrations, r._id, { 签到照片ID: 'synthetic-photo', 签到提交时间: `${events[i].报名日期}T03:00:00Z` });
    const out = await w.attendanceBatch(events[i]._id, [{ id: r._id, hours: { serviceHours: [4, 4.5, 0, 4][i], trainingHours: 1, travelHours: 1, work: '献血车志愿者' } }], 'checker');
    assert.equal(out.failed, 0); ledger.push(out.results[0].result);
  }
  const draft = await w.reviewDraft(events[0]._id, '2026-10');
  assert.equal(draft.rows.length, 1); assert.equal(draft.entries.length, 3); assert.equal(draft.groups[0].ids.length, 3);
  assert.equal(draft.rows[0].服务时长, 8.5); assert.equal(draft.rows[0].培训时长, 2); assert.equal(draft.rows[0].交通时长, 2);
  assert.equal(draft.rows[0].正式工作日期.split('\n').length, 2); assert.equal(draft.rows[0].具体工作地点.split('\n').length, 2);
  assert.equal(draft.rows[0].正式工作日期.includes('10-26'), false);
  await assert.rejects(w.approveBatch(events[0]._id, [{ id: ledger[3]._id, expectedDigest: ledger[3].核对摘要 }], 'chair', undefined, '2026-10'), /其他活动或月份/);
  await assert.rejects(w.editReview(events[0]._id, [{ id: ledger[3]._id, expectedDigest: ledger[3].核对摘要, details: values }], 'chair', undefined, '2026-10'), /其他活动或月份/);
  await assert.rejects(w.reviewDraft(f.e._id, '2026-10'), /仅适用于献血车/);
  await assert.rejects(w.reviewDraft(events[0]._id, '2026-13'), /有效月份/);
  const approved = await w.approveBatch(events[0]._id, draft.entries.map(e => ({ id: e._id, expectedDigest: e.核对摘要 })), 'chair', undefined, '2026-10');
  assert.equal(approved.succeeded, 3);
  const exported = await w.exportDraft(events[0]._id, '2026-10'); assert.deepEqual(exported.rows, draft.rows);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await hoursWorkbook(exported));
  assert.equal(workbook.worksheets[0].rowCount, 2); assert.equal(workbook.worksheets[0].getCell('H2').value, 8.5);
  assert.equal(workbook.worksheets[0].getCell('E2').alignment.wrapText, true);
  const totals = await w.post(ledger[0]._id);
  assert.equal(totals.serviceHours, 8.5); assert.equal(totals.trainingHours, 2); assert.equal(totals.travelHours, 2);
});

test('generated blood shifts appear in the console and support batch review without copying the source activity', async () => {
  const f = await fixture();
  f.rows.source = [{ _id: 'slot-1', 日期: '2026-10-12', 点位: '新街口中央', 活动时间: '上午 11~15点', 周次: 46 }];
  const w = createWorkflow(f.base, { bloodSourceTable: 'source', now: () => Date.parse('2026-10-06T00:00:00+08:00') });
  const event = (await w.overview()).events.find(row => row._id.startsWith('BS-'));
  assert.ok(event);
  const r = await w.register(event._id, { accountId: 'generated-user', studentId: '999990003', realName: '模拟献血车同学', email: '999990003@smail.nju.edu.cn', emailVerified: true });
  await w.confirm(r._id);
  const missingPhoto = await w.attendanceBatch(event._id, [{ id: r._id, hours: values }], 'checker');
  assert.equal(missingPhoto.failed, 1);
  await f.base.updateRow(WF.registrations, r._id, { 签到照片ID: 'synthetic-photo', 签到提交时间: '2026-10-12T03:00:00.000Z' });
  assert.equal((await w.attendanceBatch(event._id, [{ id: r._id, hours: values }], 'checker')).succeeded, 1);
  const entry = (await w.reviewDraft(event._id)).entries[0];
  assert.equal((await w.approveBatch(event._id, [{ id: entry._id, expectedDigest: entry.核对摘要 }], 'chair')).succeeded, 1);
  const exported = await w.exportDraft(event._id);
  assert.equal(exported.rows[0].服务时长, 2.5); assert.equal(exported.rows[0].志愿者具体工作内容, values.work);
  assert.equal(f.rows[WF.events].some(row => row._id === event._id), false);
});

test('upstream adjusted-hour records remain reviewable and reject altered amounts after integration', async () => {
  const f = await fixture();
  await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: values }], 'checker');
  const stored = f.rows[WF.ledger][0];
  stored.来源摘要 = createHash('sha256').update(JSON.stringify([stored.来源摘要.slice(3),
    ...['服务时长', '培训时长', '交通时长'].map(key => Number(stored[key]))])).digest('hex');
  delete stored.核对摘要; delete stored.工作内容; delete stored.退回原因;
  const entry = (await f.w.reviewDraft(f.e._id)).entries[0];
  assert.equal((await f.w.approveBatch(f.e._id, [{ id: entry._id, expectedDigest: entry.核对摘要 }], 'chair')).succeeded, 1);
  assert.equal((await f.w.exportDraft(f.e._id)).rows[0].服务时长, 2.5);
  assert.equal((await f.w.post(entry._id)).serviceHours, 2.5);
  stored.服务时长 = '9';
  await assert.rejects(f.w.exportDraft(f.e._id), /改变/);
  await assert.rejects(f.w.post(entry._id), /改变/);
});
test('review and exported workbook retain registration order when attendance is entered in reverse', async () => {
  const f = await fixture();
  await f.w.attendanceBatch(f.e._id, [...f.regs].reverse().map(r => ({ id: r._id, hours: values })), 'checker');
  const review = await f.w.reviewDraft(f.e._id);
  assert.deepEqual(review.rows.map(row => row.学号), f.regs.map(row => row.学号));
  for (const entry of review.entries) await f.w.approveHours(entry._id, 'chair');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await hoursWorkbook(await f.w.exportDraft(f.e._id)));
  assert.deepEqual(workbook.worksheets[0].getColumn(3).values.slice(2), f.regs.map(row => row.学号));
});
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
  const alias = url.replace('/hours-export', '/export.xlsx');
  assert.equal((await fetch(alias, { method: 'HEAD' })).status, 200);
  const aliasResponse = await fetch(alias); assert.equal(aliasResponse.status, 200);
  const aliasWorkbook = new ExcelJS.Workbook(); await aliasWorkbook.xlsx.load(Buffer.from(await aliasResponse.arrayBuffer()));
  assert.deepEqual(aliasWorkbook.getWorksheet(1).getSheetValues(), workbook.getWorksheet(1).getSheetValues());
  assert.equal(audited, 2);
  permitted = false;
  for (const target of [url, alias]) { assert.equal((await fetch(target, { method: 'HEAD' })).status, 403); assert.equal((await fetch(target)).status, 403); }
  assert.equal(audited, 2);
});


test('monthly grouping keeps namesakes separate and rejects conflicting student identities', () => {
  const event = { 活动ID: 'event', 活动名称: '献血车志愿服务', 地点: '点位', 工作内容: '服务' };
  const entries = ['001', '002'].map((sid, i) => ({ _id: `l${i}`, 报名行ID: `r${i}`, 学号: sid, 姓名: '同名同学', 活动ID: 'event', 服务时长: '2', 培训时长: '1', 交通时长: '1' }));
  const registrations = entries.map(e => ({ _id: e.报名行ID, 报名日期: '2026-10-12', 报名时段: '上午' }));
  const draft = reviewWorkbookRows(event, entries, registrations, { monthly: true });
  assert.equal(draft.rows.length, 2); assert.deepEqual(draft.rows.map(r => r.学号), ['001', '002']);
  entries[1].学号 = '001'; entries[1].姓名 = '另一个姓名';
  assert.throws(() => reviewWorkbookRows(event, entries, registrations, { monthly: true }), /不同姓名/);
});

test('zero-only review stays editable but does not produce a misleading export', async () => {
  const f = await fixture();
  await f.w.attendanceBatch(f.e._id, [{ id: f.regs[0]._id, hours: { ...values, serviceHours: 0 } }], 'checker');
  const draft = await f.w.reviewDraft(f.e._id); assert.equal(draft.rows.length, 1); assert.equal(draft.rows[0].培训时长, 0);
  await f.w.approveHours(draft.entries[0]._id, 'chair');
  await assert.rejects(f.w.exportDraft(f.e._id), /大于0/);
});

test('review-edit route enforces permission and CSRF and forwards the month with the session actor', async () => {
  let permitted = false, csrf = true, writes = 0;
  const items = [{ id: 'l1', expectedDigest: 'digest', details: values }];
  const context = { requireConsoleAccess: () => permitted ? { username: 'chair', role: 'platform_admin' } : null,
    requireCsrf: () => csrf, actor: s => s.username, readJson: async () => ({ items, month: '2026-10' }), audit: async () => {},
    getWorkflow: async () => ({ editReview: async (...args) => { writes++; assert.deepEqual(args, ['event', items, 'chair', 'platform_admin', '2026-10']); return { succeeded: 1, failed: 0, results: [] }; } }),
    json: (_res, status, body) => ({ status, body }) };
  const req = { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' } }, url = new URL('http://localhost/api/volunteer/workflow/events/event/hours-edit');
  await workflowRoutes(req, null, url, context); assert.equal(writes, 0);
  permitted = true; csrf = false; await workflowRoutes(req, null, url, context); assert.equal(writes, 0);
  csrf = true; assert.equal((await workflowRoutes(req, null, url, context)).status, 200); assert.equal(writes, 1);
});
