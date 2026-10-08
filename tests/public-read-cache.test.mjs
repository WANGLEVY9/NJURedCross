import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createReadCache } from '../lib/http/read-cache.js';
import { assertCompleteRows } from '../lib/events/safety.js';

test('public reads coalesce concurrent loads and expire on a bounded deadline', async () => {
  let time = 0, calls = 0;
  const cache = createReadCache({ ttlMs: 10, now: () => time });
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get('events', load), cache.get('events', load)]), [1, 1]);
  time = 9;
  assert.equal(await cache.get('events', load), 1);
  time = 10;
  assert.equal(await cache.get('events', load), 2);
});

test('failed public reads are retried and never cached as empty activities', async () => {
  const cache = createReadCache();
  await assert.rejects(cache.get('events', () => { throw new Error('offline'); }));
  assert.deepEqual(await cache.get('events', () => ['published']), ['published']);
});

test('a mutation invalidates projections and an older read cannot refill the cache', async () => {
  const cache = createReadCache();
  let resolveOld;
  const old = cache.get('events', () => new Promise(resolve => { resolveOld = resolve; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get('events', () => 'new'), 'new');
  resolveOld('old');
  assert.equal(await old, 'old');
  assert.equal(await cache.get('events', () => 'unexpected'), 'new');
});

test('homepage reads events and inventory concurrently without the unrelated volunteer overview', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function loadPublicOverview(');
  const end = source.indexOf('async function publicRoutes(', start);
  assert.ok(start >= 0, 'loadPublicOverview must exist');
  assert.ok(end > start, 'publicRoutes must follow loadPublicOverview');
  const block = source.slice(start, end);
  const calls = [];
  let resolveEvents;
  const context = { Date, publicPrograms: [], publicEmailDomains: [], inventoryTable: 'inventory',
    assertCompleteRows,
    getPublicEvents: () => { calls.push('events'); return new Promise(resolve => { resolveEvents = resolve; }); },
    listAllRows: async () => { calls.push('inventory'); return []; },
  };
  vm.createContext(context);
  vm.runInContext(block + ';globalThis.load=loadPublicOverview', context);
  const result = context.load({});
  assert.deepEqual(calls, ['events', 'inventory']);
  resolveEvents([{ status: '报名中', remaining: 3, confirmed: 2, waitlisted: 0 }]);
  const payload = await result;
  assert.equal(payload.stats.openSeats, 3);
  assert.equal(payload.featured.length, 1);
});
