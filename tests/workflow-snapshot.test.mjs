import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createReadCache } from '../lib/http/read-cache.js';
import { withDisplayReads } from '../lib/http/display-reads.js';

test('catalogue/calendar shared snapshot coalesces, has a hard age limit and invalidates after writes', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('function getPublicWorkflowData('), source.indexOf('function getPublicEvents('));
  let clock = 0, reads = 0, fail = false;
  const cache = createReadCache({ ttlMs: 10, staleMs: 20, now: () => clock });
  const context = vm.createContext({ publicReadCache: cache, withDisplayReads,
    getWorkflow: async () => ({ publicRead: async () => {
      reads++;
      if (fail) throw Error('synthetic upstream unavailable');
      return { events: [], registrations: [], version: reads };
    } }),
  });
  vm.runInContext(block + ';globalThis.read=getPublicWorkflowData;', context);
  const values = await Promise.all([context.read(), context.read()]);
  assert.equal(reads, 1);
  assert.equal(values[0].version, values[1].version);
  clock = 11;
  assert.equal((await context.read()).version, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
  clock = 42;
  fail = true;
  await assert.rejects(context.read(), /synthetic upstream/);
  fail = false;
  cache.clear();
  assert.equal((await context.read()).version, 4);
});
