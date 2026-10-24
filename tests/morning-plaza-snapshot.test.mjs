import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMorningPlazaSnapshotStore, shanghaiDate } from '../lib/morning/plaza-snapshot-store.js';

test('daily plaza snapshots are stable per account and rotate on Shanghai midnight', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'morning-plaza-snapshot-'));
  const file = join(directory, 'quota.sqlite');
  const store = await openMorningPlazaSnapshotStore(file);
  try {
    const first = store.getOrCreate('account-a', '2026-10-25', Array.from({ length: 9 }, (_, i) => `card-${i}`));
    assert.deepEqual(first, ['card-0', 'card-1', 'card-2', 'card-3', 'card-4', 'card-5']);
    assert.deepEqual(store.getOrCreate('account-a', '2026-10-25', ['new-card']), first);
    assert.deepEqual(store.getOrCreate('account-b', '2026-10-25', ['other-card']), ['other-card']);
    assert.deepEqual(store.getOrCreate('account-a', '2026-10-26', ['tomorrow-card']), ['tomorrow-card']);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Shanghai calendar date is used for daily refresh boundaries', () => {
  assert.equal(shanghaiDate(new Date('2026-10-24T16:30:00.000Z')), '2026-10-25');
});
