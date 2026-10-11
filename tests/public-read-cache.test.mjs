import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createReadCache } from '../lib/http/read-cache.js';

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
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const block = source.slice(source.indexOf('async function loadPublicOverview('), source.indexOf('/**\n * Student surface.'));
  const calls = [];
  let resolveEvents;
  const context = { Date, publicPrograms: [], publicEmailDomains: [], inventoryTable: 'inventory',
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

test('bounded stale public data is immediate while only one background refresh runs', async () => {
  let time=0, calls=0, finish;
  const cache=createReadCache({ttlMs:10,staleMs:20,now:()=>time});
  await cache.get('events',()=>{calls++;return 'before';});time=11;
  const refresh=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  assert.equal(await cache.get('events',refresh),'before');
  assert.equal(await cache.get('events',refresh),'before');assert.equal(calls,2);
  finish('after');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await cache.get('events',()=>assert.fail('fresh value should be reused')),'after');
});

test('background failure never extends the stale age and mutations discard stale data', async () => {
  let time=0;const cache=createReadCache({ttlMs:10,staleMs:20,now:()=>time});
  await cache.get('events',()=>['old']);time=11;
  assert.deepEqual(await cache.get('events',()=>{throw Error('offline');}),['old']);
  await new Promise(resolve=>setImmediate(resolve));time=30;
  await assert.rejects(cache.get('events',()=>{throw Error('offline');}),/offline/);
  time=12;cache.clear();
  assert.deepEqual(await cache.get('events',()=>['new']),['new']);
});
