import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { apiFailure } from '../lib/http/errors.js';
import { createMutationQueue, assertCompleteRows } from '../lib/events/safety.js';
import { linkedRowIds, registrationReadiness, summarizeVolunteerWorkflow, previewHoursEntry } from '../lib/events/volunteer-workflow.js';

// Git checkouts on Windows may use CRLF; source section markers use LF.
const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function section(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a); return source.slice(a, b); }
function registrationFixture({ capacity = 1, existing = [], sessions = [] } = {}) {
  let sequence = 0;
  const tables = { projects: [{ _id: 'row-event', 活动ID: 'EVT-fixture', 状态: '报名中', 容量: String(capacity) }], sessions, registrations: [...existing] };
  const base = { async listRows(table, _v, _o, _c, start = 0, limit = 100) { await Promise.resolve(); return tables[table].slice(start, start + limit); }, async appendRow(table, row) { const result = { ...row, _id: `row-${++sequence}` }; tables[table].push(result); return { _id: result._id }; } };
  const box = {
    eventProjectTable: 'projects', eventSessionTable: 'sessions', eventRegistrationTable: 'registrations',
    requiredText: value => String(value).trim(), requiredEmail: value => String(value).trim(), assertPublicEmail: () => {},
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    toFiniteNumber: value => Number(value), eventIdentifier: () => `REG-${++sequence}`, randomCheckinCode: () => 'fixture',
    eventCheckinToken: (code, salt) => `${code}-${salt}`, eventCheckinHash: value => value,
    QRCode: { toDataURL: async () => 'synthetic-qr' }, assertCompleteRows,
    withEventMutation: createMutationQueue(),
    withSharedWriteLock: createMutationQueue(),
    URL,
    displayRead: (_client, _key, load) => load(),
  };
  vm.createContext(box);
  vm.runInContext(section('async function listAllRows(', 'function reviewFromRow(') + section('async function registerForEvent(', '/* --------------------------------------------------------------------------\n   Public projections') + section('async function api(req, res, url)', 'async function dispatchApi(') + ';globalThis.register=registerForEvent;globalThis.invoke=api;', box);
  box.dispatchApi = req => box.register(base, { eventKey: req.key || 'row-event', participantRef: req.email, body: { name: '合成用户', email: req.email, consent: true, sessionId: req.sessionId } });
  return { tables, base, run: (email, path = '/api/public/events/EVT-fixture/registrations', key = 'row-event', sessionId) => box.invoke({ method: 'POST', email, key, sessionId }, {}, new URL(`http://fixture${path}`)) };
}

test('upstream auth errors are 503 and application auth/CSRF statuses are preserved', () => {
  for (const status of [401, 403]) {
    const failure = apiFailure({ response: { status, data: { detail: 'secret-upstream-payload' } } });
    assert.equal(failure.status, 503); assert.equal(failure.payload.code, 'seatable_auth_failed');
    assert.ok(!JSON.stringify(failure).includes('secret-upstream-payload'));
    assert.equal(apiFailure({ statusCode: status, message: 'app error' }).status, status);
  }
  assert.equal(apiFailure({ response: { status: 500 } }).status, 502);
});
test('public/admin and event aliases share a capacity queue; exactly one confirmed', async () => {
  const fixture = registrationFixture();
  const outcomes = await Promise.all([fixture.run('one@example.test'), fixture.run('two@example.test', '/api/events/row-event/registrations', 'EVT-fixture')]);
  assert.equal(outcomes.filter(item => item.status === '已确认').length, 1);
  assert.equal(outcomes.filter(item => item.status === '候补').length, 1);
});
test('simultaneous same email across public/admin does not create duplicate records', async () => {
  const fixture = registrationFixture({ capacity: 10 });
  const results = await Promise.allSettled([fixture.run('same@example.test'), fixture.run('SAME@example.test', '/api/events/row-event/registrations')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(fixture.tables.registrations.length, 1);
});
test('checked-in participants still occupy capacity and queue recovers after failed task', async () => {
  const fixture = registrationFixture({ existing: [{ 活动ID: 'EVT-fixture', 报名状态: '已签到', 南大邮箱: 'first@example.test' }] });
  await assert.rejects(fixture.run('first@example.test'));
  assert.equal((await fixture.run('next@example.test')).status, '候补');
});
test('truncation beyond 5000 rows refuses the write even if duplicate is outside first page', async () => {
  const existing = Array.from({ length: 5000 }, () => ({ 活动ID: 'OTHER' }));
  existing.push({ 活动ID: 'EVT-fixture', 南大邮箱: 'own@example.test', 报名状态: '已确认' });
  const fixture = registrationFixture({ existing });
  await assert.rejects(fixture.run('own@example.test'), { code: 'incomplete_operational_data', statusCode: 503 });
  assert.equal(fixture.tables.registrations.length, 5001);
});
test('session aliases share the activity reservation queue', async () => {
  const fixture = registrationFixture({ capacity: 20, sessions: [{ _id: 'session-row', 场次ID: 'SES-fixture', 活动ID: 'EVT-fixture', 容量: '1' }] });
  const results = await Promise.all([fixture.run('one@example.test', undefined, undefined, 'session-row'), fixture.run('two@example.test', '/api/events/EVT-fixture/registrations', 'EVT-fixture', 'SES-fixture')]);
  assert.equal(results.filter(result => result.status === '已确认').length, 1);
});

const registration = { _id: 'registration', 活动类别: '公益', 活动名称: '合成活动', 报名日期: '2026-10-04', 学号: '000000001', 姓名: '合成学生', 是否报名成功: true, 志愿时长: 2, 录入状态: '待录入', 签到表: [{ row_id: 'checkin', display_value: '不用于匹配' }] };
const checkin = { _id: 'checkin', 学号: '000000001', 活动名称: [{ row_id: 'registration', display_value: '不用于匹配' }] };
test('hours preview requires confirmed, valid hours and bidirectional identity-matched checkin', () => {
  assert.deepEqual(linkedRowIds(['a', { row_id: 'a' }, { display_value: 'not-an-id' }]), ['a']);
  assert.equal(registrationReadiness(registration, new Map([['checkin', checkin]])).state, '待录入');
  assert.equal(previewHoursEntry([registration], [checkin], ['registration']).ready, true);
  for (const row of [ { ...registration, 是否报名成功: false }, { ...registration, 志愿时长: null }, { ...registration, 录入状态: '已录入' }, { ...registration, 签到表: [] } ]) {
    assert.equal(previewHoursEntry([row], [checkin], ['registration']).ready, false);
  }
  assert.equal(previewHoursEntry([registration], [{ ...checkin, 学号: 'other' }], ['registration']).ready, false);
  assert.equal(previewHoursEntry([registration], [{ ...checkin, 活动名称: [{ row_id: 'other' }] }], ['registration']).ready, false);
});
test('empty/invalid/unknown states cannot become recorded hours or guessed checkins', () => {
  for (const value of ['', ' ', 'invalid', -1, true]) assert.notEqual(registrationReadiness({ ...registration, 志愿时长: value }, new Map([['checkin', checkin]])).state, '待录入');
  assert.equal(registrationReadiness({ ...registration, 录入状态: 'mistyped' }, new Map([['checkin', checkin]])).state, '需核验');
  assert.equal(registrationReadiness({ ...registration, 是否报名成功: 'true' }, new Map([['checkin', checkin]])).confirmed, false);
});
test('same title/different dates stay separate; orphan links do not merge by display text', () => {
  const summary = summarizeVolunteerWorkflow([registration, { ...registration, _id: 'r2', 报名日期: '2026-10-05', 签到表: [] }], [checkin, { _id: 'orphan', 活动名称: [{ row_id: 'unknown', display_value: '合成活动' }] }]);
  assert.equal(summary.groups.length, 2); assert.equal(summary.orphanCheckins, 1);
  assert.equal(summary.registrationsWithVerifiedCheckin, 1);
  assert.ok(!JSON.stringify(summary).includes('000000001'));
});
test('preview never adds profile totals, rechecks recorded state and rejects unbounded selections', () => {
  const preview = previewHoursEntry([registration], [checkin], ['registration', 'registration']);
  assert.equal(preview.selected, 1); assert.equal(preview.writes, false); assert.equal(preview.incrementsProfileTotals, false);
  assert.equal(previewHoursEntry([{ ...registration, 录入状态: '已录入' }], [checkin], ['registration']).ready, false);
  assert.throws(() => previewHoursEntry([], [], Array(201).fill('registration')), { statusCode: 400 });
  assert.equal(previewHoursEntry([], [], ['missing']).ready, false);
});
