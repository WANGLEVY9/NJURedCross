import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWarmthCapabilities } from '../lib/community/capabilities.js';
import { STATE_SCHEMA } from '../lib/production-schema.js';
import { MORNING_SCHEMA } from '../lib/morning/schema.js';

test('public capabilities coalesce both programmes into one metadata read', async () => {
  let reads = 0;
  const get = createWarmthCapabilities({
    birthday: { enabled: true, automaticDelivery: true }, morningEnabled: true,
    getBase: async () => ({ getMetadata: async () => {
      reads++;
      return { tables: [...STATE_SCHEMA, ...MORNING_SCHEMA].map(t => ({ name: t.name, columns: t.columns.map(name => ({ name })) })) };
    } }),
  });
  const results = await Promise.all([get(), get(), get()]);
  assert.equal(reads, 1);
  assert.equal(results[0].birthday.ready, true);
  assert.equal(results[0].morning.ready, true);
  await get();
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(results).includes('columns'), false);
});

test('schema discovery fails closed and retries failures without disclosing credentials', async () => {
  let reads = 0;
  const get = createWarmthCapabilities({ birthday: { enabled: true }, morningEnabled: true,
    getBase: async () => { reads++; throw Error('synthetic-secret'); } });
  for (let i = 0; i < 2; i++) {
    const result = await get();
    assert.equal(result.birthday.ready, false);
    assert.equal(result.morning.ready, false);
    assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  }
  assert.equal(reads, 2);
});

test('disabled programmes do not contact NJUTable', async () => {
  const get = createWarmthCapabilities({ birthday: { enabled: false }, morningEnabled: false,
    getBase: async () => { throw Error('should not read'); } });
  assert.equal((await get()).birthday.enabled, false);
});
