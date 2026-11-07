import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAttendanceRequestStore, ATTENDANCE_REQUEST_STATUS } from '../lib/events/attendance-request-store.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'attendance-request-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return openAttendanceRequestStore(join(root, 'requests.sqlite'));
}

test('a member submits one pending explanation and responsible review closes it', async t => {
  const store = await fixture(t);
  const payload = { registrationCode: 'WR-1', eventId: 'E-1', accountId: 'ACC-1', studentId: '231250082', reason: '值班医生延后确认到场' };
  const created = store.submit(payload);
  assert.equal(created.status, ATTENDANCE_REQUEST_STATUS.pending);
  const duplicate = store.submit({ ...payload, reason: '重复提交' });
  assert.equal(duplicate.id, created.id, 'duplicate pending requests are not created');
  assert.equal(duplicate.reason, created.reason);
  assert.equal(store.forRegistration('WR-1').reason, '值班医生延后确认到场');
  assert.equal(store.forAccount('ACC-1').length, 1);
  assert.equal(store.forEvent('E-1').length, 1);

  assert.equal(store.decide('WR-1', ATTENDANCE_REQUEST_STATUS.approved, 'recorder'), 1);
  const decided = store.forRegistration('WR-1');
  assert.equal(decided.status, ATTENDANCE_REQUEST_STATUS.approved);
  assert.equal(decided.decided_by, 'recorder');
  assert.equal(store.forEvent('E-1').length, 0);
  assert.equal(store.decide('WR-1', ATTENDANCE_REQUEST_STATUS.rejected, 'recorder'), 0, 'closed request is immutable');
  store.close();
});

test('rejecting and listing stay scoped to the event; invalid input is refused', async t => {
  const store = await fixture(t);
  assert.throws(() => store.submit({ registrationCode: 'WR-2', reason: '' }), /补签说明无效/);
  assert.throws(() => store.submit({ registrationCode: 'WR-2', reason: 'x'.repeat(301) }), /补签说明无效/);
  assert.throws(() => store.decide('WR-2', 'pending'), /结案状态无效/);
  store.submit({ registrationCode: 'WR-2', eventId: 'E-2', accountId: 'A', reason: '现场未带手机' });
  store.submit({ registrationCode: 'WR-3', eventId: 'E-3', accountId: 'A', reason: '纸质签到' });
  assert.deepEqual(store.forEvent('E-2').map(row => row.registration_code), ['WR-2']);
  assert.equal(store.decide('WR-2', ATTENDANCE_REQUEST_STATUS.rejected, 'reviewer'), 1);
  assert.equal(store.forRegistration('WR-2').status, ATTENDANCE_REQUEST_STATUS.rejected);
  store.close();
});
