import test from 'node:test';
import assert from 'node:assert/strict';
import {hoursProfileSyncWindow,nextHoursProfileSync,eligibleForWeeklyHoursSync} from '../lib/events/hours-sync-schedule.js';

test('Monday profile cutoff uses Beijing time before, at and after 06:00',()=>{
 assert.deepEqual(hoursProfileSyncWindow('2026-11-02T05:59:59+08:00'),{key:'2026-10-26',cutoff:'2026-10-25T22:00:00.000Z',nextAt:'2026-11-01T22:00:00.000Z'});
 assert.equal(hoursProfileSyncWindow('2026-11-02T06:00:00+08:00').key,'2026-11-02');
 assert.equal(hoursProfileSyncWindow('2026-11-04T12:00:00+08:00').cutoff,'2026-11-01T22:00:00.000Z');
});
test('new approvals wait for the next cutoff while a delayed job can catch up old approvals',()=>{
 assert.equal(nextHoursProfileSync('2026-11-04T12:00:00+08:00'),'2026-11-08T22:00:00.000Z');
 assert.equal(nextHoursProfileSync('2026-11-02T06:00:00+08:00'),'2026-11-01T22:00:00.000Z');
 assert.equal(eligibleForWeeklyHoursSync('2026-11-02T05:59:00+08:00','2026-11-04T12:00:00+08:00'),true);
 assert.equal(eligibleForWeeklyHoursSync('2026-11-02T06:01:00+08:00','2026-11-04T12:00:00+08:00'),false);
});
test('the weekly schedule rejects invalid timestamps and crosses year boundaries consistently',()=>{
 assert.throws(()=>hoursProfileSyncWindow('invalid'),TypeError);
 assert.equal(nextHoursProfileSync('2026-12-31T23:59:00+08:00'),'2027-01-03T22:00:00.000Z');
});
