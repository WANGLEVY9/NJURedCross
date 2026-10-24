import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMorningPlazaSnapshotStore, selectDailyCardIds, shanghaiDate } from '../lib/morning/plaza-snapshot-store.js';

test('daily plaza snapshots are stable per account and rotate on Shanghai midnight', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'morning-plaza-snapshot-'));
  const file = join(directory, 'quota.sqlite');
  const store = await openMorningPlazaSnapshotStore(file, { chooseIndex: () => 0 });
  try {
    const candidates = Array.from({ length: 12 }, (_, i) => `card-${i}`);
    const first = store.getOrCreate('account-a', '2026-10-25', candidates);
    assert.equal(first.length, 6);
    assert.equal(new Set(first).size, 6);
    assert.notDeepEqual(first, candidates.slice(0, 6));
    assert.deepEqual(store.getOrCreate('account-a', '2026-10-25', ['new-card']), first);
    assert.deepEqual(store.getOrCreate('account-b', '2026-10-25', ['other-card']), ['other-card']);
    const nextDay = store.getOrCreate('account-a', '2026-10-26', candidates);
    assert.equal(nextDay.length, 6);
    assert.deepEqual([...nextDay].sort(), ['card-0', 'card-10', 'card-11', 'card-7', 'card-8', 'card-9']);
    assert.equal(nextDay.some(id => first.includes(id)), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('daily selection shuffles and prefers cards not shown the previous day', () => {
  const candidates = Array.from({ length: 12 }, (_, i) => `card-${i}`);
  const reverseShuffle = () => { let index = 0; return () => index++; };
  const first = selectDailyCardIds(candidates, [], reverseShuffle());
  const next = selectDailyCardIds(candidates, first, reverseShuffle());
  assert.notDeepEqual(first, candidates.slice(0, 6));
  assert.equal(first.length, 6);
  assert.equal(new Set(first).size, 6);
  assert.equal(next.length, 6);
  assert.equal(new Set(next).size, 6);
  assert.equal(new Set(next.filter(id => !first.includes(id))).size, 6);
  assert.equal(next.some(id => first.includes(id)), false);
});

test('daily selection uses every available new card before repeating yesterday cards', () => {
  const fresh = ['new-1', 'new-2', 'new-3', 'new-4'];
  const previous = Array.from({ length: 8 }, (_, i) => `old-${i}`);
  const selected = selectDailyCardIds([...previous, ...fresh], previous, () => 0);
  assert.equal(selected.length, 6);
  assert.deepEqual(selected.filter(id => id.startsWith('new-')).sort(), fresh);
  assert.equal(selected.filter(id => id.startsWith('old-')).length, 2);
});

test('Shanghai calendar date is used for daily refresh boundaries', () => {
  assert.equal(shanghaiDate(new Date('2026-10-24T16:30:00.000Z')), '2026-10-25');
});
