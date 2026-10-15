import test from 'node:test';
import assert from 'node:assert/strict';
import {activityWindow, shanghaiInstant, positionWithinActivity} from '../public/app/shared/activity-window.js';

test('activity range supports second precision, overnight and multiple dates in Shanghai', () => {
  assert.deepEqual(activityWindow('2026-10-29T08:30:01','2026-10-30T16:30:02'), {
    start:'2026-10-29T08:30:01+08:00', end:'2026-10-30T16:30:02+08:00', seconds:115201,
  });
  assert.equal(shanghaiInstant('2026-10-29T08:30').canonical, '2026-10-29T08:30:00+08:00');
});

test('invalid dates, ambiguous offsets, inverted ranges and leap normalization are rejected', () => {
  for (const value of ['2026-02-29T08:00','2026-10-29T24:00','2026-10-29T08:60','2026-10-29T08:30:60','2026-10-29T08:30Z','2026-10-29T08:30+09:00']) {
    assert.equal(shanghaiInstant(value), null, value);
  }
  assert.equal(activityWindow('2026-10-30T08:00','2026-10-29T08:00'), null);
  assert.equal(activityWindow('2026-10-30T08:00','2026-10-30T08:00'), null);
});

test('a position must stay within its approved project window', () => {
  const activity = {start:'2026-10-29T08:30',end:'2026-10-30T16:30'};
  assert.equal(positionWithinActivity({start:activity.start,end:'2026-10-29T10:30'}, activity), true);
  assert.equal(positionWithinActivity({start:'2026-10-29T08:29:59',end:'2026-10-29T10:30'}, activity), false);
  assert.equal(positionWithinActivity({start:'2026-10-30T14:30',end:'2026-10-30T16:30:01'}, activity), false);
});
