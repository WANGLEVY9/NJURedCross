import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { birthdayRolloutConfig, inspectBirthdaySchema, BIRTHDAY_TABLE_NAMES } from '../lib/community/birthday-rollout.js';
import { STATE_SCHEMA } from '../lib/production-schema.js';

const metadata = { tables: STATE_SCHEMA.filter(table => BIRTHDAY_TABLE_NAMES.includes(table.name)).map(table => ({ name: table.name, columns: table.columns.map(name => ({ name })) })) };
test('Birthday rollout and automated mail require separate explicit opt-ins', () => {
  for (const env of [{}, { WARMTH_DELIVERY_ENABLED: 'true' }, { WARMTH_BIRTHDAY_ENABLED: 'false', WARMTH_DELIVERY_ENABLED: 'true' }]) {
    assert.deepEqual(birthdayRolloutConfig(env), { enabled: false, automaticDelivery: false });
  }
  assert.deepEqual(birthdayRolloutConfig({ WARMTH_BIRTHDAY_ENABLED: 'true' }), { enabled: true, automaticDelivery: false });
  assert.equal(birthdayRolloutConfig({ WARMTH_BIRTHDAY_ENABLED: 'true', WARMTH_DELIVERY_ENABLED: 'true' }).automaticDelivery, true);
});
test('Existing production-style tables cannot accidentally mark the upgrade ready', () => {
  const partial = structuredClone(metadata);
  partial.tables = partial.tables.slice(0, 2);
  partial.tables[1].columns = partial.tables[1].columns.slice(0, 11);
  const result = inspectBirthdaySchema(partial);
  assert.equal(result.ready, false);
  assert.equal(result.checks.filter(check => !check.exists).length, 5);
  assert.deepEqual(result.checks[1].missingColumns, ['署名昵称', '投递方式', '目标学号', '投递条件', '附件']);
  assert.equal(inspectBirthdaySchema(metadata).ready, true);
});
const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const publicSource = source.slice(source.indexOf('async function publicRoutes('), source.indexOf('async function portalRoutes('));
function harness(enabled = false, ready = false) {
  const calls = [];
  const ctx = vm.createContext({
    birthdayRollout: birthdayRolloutConfig({ WARMTH_BIRTHDAY_ENABLED: String(enabled) }),
    inspectBirthdaySchema: () => ({ ready }),
    getBase: async () => { calls.push('base'); return { async getMetadata() { calls.push('metadata'); return {}; } }; },
    assertBirthdayReady: async () => { if (!ready) throw Object.assign(new Error('not ready'), { statusCode: 503 }); },
    json: (_res, status, body) => ({ status, body }),
  });
  vm.runInContext(`${publicSource}\nglobalThis.routes = publicRoutes;`, ctx);
  return { routes: ctx.routes, calls };
}
test('Disabled capability check does not access NJUTable or disclose schema', async () => {
  const { routes, calls } = harness();
  const result = await routes({ method: 'GET' }, {}, new URL('http://test/api/public/warmth/capabilities'));
  assert.equal(result.status, 200);
  assert.equal(result.body.birthday.ready, false);
  assert.equal(result.body.birthday.automaticDelivery, false);
  assert.deepEqual(calls, []);
  assert.equal(JSON.stringify(result).includes('token'), false);
});
test('New birthday APIs reject requests when rollout is disabled', async () => {
  const { routes } = harness();
  const result = await routes({ method: 'POST' }, {}, new URL('http://test/api/public/warmth/blessings'));
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'birthday_disabled');
});
test('Enabled APIs reject incomplete schemas before any birthday mutation', async () => {
  const { routes } = harness(true, false);
  await assert.rejects(routes({ method: 'POST' }, {}, new URL('http://test/api/public/warmth/blessings')), error => error.statusCode === 503);
});
