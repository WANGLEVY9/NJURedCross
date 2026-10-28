import test from 'node:test';
import assert from 'node:assert/strict';
import { reimbursementTableServer } from './helpers/reimbursements-table-server.js';
import { reimbursementConfiguration } from '../lib/reimbursements/config.js';
import { createReimbursementWriteFence } from '../lib/reimbursements/write-fence.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';

test('formal API guards storage readiness, auth, CSRF and finance roles without inheriting materials rights', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close());
  const call = async (path, user = 'owner', body) => {
    const response = await fetch(f.origin + '/api/reimbursements' + path, { method: body ? 'POST' : 'GET',
      headers: { 'x-synthetic-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const config = reimbursementConfiguration({ NJUBOX_MAIN_TOKEN: 'synthetic-other-module-token' });
  assert.equal(config.box.token, ''); assert.equal(config.enabled, false); assert.equal(config.allowWrites, false);
  f.state.signedIn = false; assert.equal((await call('/mine')).status, 401); f.state.signedIn = true;
  assert.equal((await call('', 'owner')).status, 403);
  assert.equal((await call('', 'material-admin')).status, 403);
  assert.equal((await call('/readiness')).status, 403);
  assert.equal((await call('/readiness', 'admin')).body.ready, true);
  f.config.box.token = ''; const notReady = await call('/readiness', 'admin');
  assert.equal(notReady.body.boxConfigured, false); assert.equal(notReady.body.ready, false);
  const unavailable = await call('/config');
  assert.equal(unavailable.status, 200); assert.equal(unavailable.body.available, false);
  assert.equal(unavailable.body.code, 'reimbursements_storage_not_configured'); assert.equal(f.fixture.calls.length, 0);
  assert.equal((await call('', 'owner', {})).status, 403);
  f.config.box.token = 'synthetic';
  assert.equal((await call('/config')).body.local, false);
  assert.equal((await call('/activities')).body.activities[0].id, 'synthetic-event');
  assert.equal((await call('/mine')).body.requests.length, 0);
});

test('uncertain-write marker survives recreation and contains only recovery identifiers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'njurc-finance-fence-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('njurc-finance-fence-'));
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'fence.json'), value = { id: 'synthetic-operation', version: 1, digest: 'a'.repeat(64) };
  await createReimbursementWriteFence(path).save(value);
  const next = createReimbursementWriteFence(path); assert.deepEqual(await next.read(), value);
  await assert.rejects(next.save(value)); await next.clear('wrong-id'); assert.deepEqual(await next.read(), value);
  await next.clear(value.id); assert.equal(await next.read(), null);
});

test('production PDF assets serve only the browser runtime allowlist with correct types', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close());
  const module = await fetch(f.origin + '/vendor/pdfjs/build/pdf.mjs');
  assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
  assert.match(await module.text(), /getDocument/);
  assert.equal((await fetch(f.origin + '/vendor/pdfjs/build/pdf.worker.mjs', { method: 'HEAD' })).status, 200);
  for (const suffix of ['package.json', '../package.json', 'build/%2e%2e%2f.env', 'standard_fonts/%2e%2e%2fpackage.json'])
    assert.equal((await fetch(f.origin + '/vendor/pdfjs/' + suffix)).status, 404);
  assert.equal((await fetch(f.origin + '/vendor/pdfjs/build/pdf.mjs', { method: 'POST' })).status, 405);
});
