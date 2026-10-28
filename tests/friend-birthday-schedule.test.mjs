import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('  const warmthDeliveryHour =');
const end = source.indexOf('  // 每天按上海时间扫描生日成员', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);
async function boot({ enabled = true, smtp = true, time = '2026-10-25T00:01:00Z' } = {}) {
  const calls = [], timers = [], cleanups = [];
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } }
  const context = vm.createContext({ Date: ClockDate, Intl, Number,
    process: { env: { WARMTH_DELIVERY_ENABLED: 'false' } },
    birthdayRollout: { enabled }, mailerStatus: () => ({ configured: smtp }),
    getBase: async () => 'synthetic-client', withRequestBudget: fn => fn(),
    runFriendBirthdayBatch: async (client, date) => calls.push({ client, date: date.toISOString() }),
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; },
    clearInterval() {}, server: {}, registerShutdownCleanup: (_server, fn) => cleanups.push(fn),
    console: { warn: () => assert.fail('unexpected schedule failure') },
  });
  vm.runInContext(block, context);
  await new Promise(resolve => setTimeout(resolve, 0));
  return { calls, timers, cleanups };
}
test('friend schedule starts after Shanghai 08:00 without a new server setting and registers cleanup', async () => {
  const f = await boot();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].client, 'synthetic-client');
  assert.equal(f.timers[0].ms, 60000);
  assert.equal(f.cleanups.length, 1);
  await f.timers[0].fn();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.calls.length, 2);
});
test('schedule does no delivery before the hour, without SMTP, or with the birthday module disabled', async () => {
  for (const options of [{ time: '2026-10-24T23:59:00Z' }, { smtp: false }, { enabled: false }]) {
    assert.equal((await boot(options)).calls.length, 0);
  }
});
