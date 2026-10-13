import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createPreviewServer, PREVIEW_NOTICE } from '../scripts/preview-materials.mjs';
import { createMaterialsFixtures, FIXTURE_TABLES } from '../lib/materials/fixtures.js';

async function preview(t, options) {
  const server = await createPreviewServer(options);
  assert.equal(server.listening, false, 'factory must not start a listener');
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = server.address().port;
  let cookie = '';
  let csrf = '';
  async function request(path, { method = 'GET', body, headers = {}, withCsrf = true } = {}) {
    const raw = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method,
        headers: { ...(cookie ? { Cookie: cookie } : {}),
          ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': raw.length } : {}),
          ...(withCsrf && csrf && method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}), ...headers },
      }, async (res) => {
        try {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, text,
            payload: String(res.headers['content-type']).includes('application/json') ? JSON.parse(text) : null });
        } catch (error) { reject(error); }
      });
      req.on('error', reject);
      req.end(raw);
    });
    if (result.headers['set-cookie']) cookie = result.headers['set-cookie'][0].split(';')[0];
    if (result.payload?.csrfToken) csrf = result.payload.csrfToken;
    return result;
  }
  const session = await request('/api/auth/session');
  return { server, port, request, session, token: () => csrf };
}

test('preview is loopback-only, visibly synthetic, and makes no external requests', async (t) => {
  const originalFetch = globalThis.fetch;
  const externalCalls = [];
  globalThis.fetch = async (...args) => { externalCalls.push(args[0]); throw new Error('External fetch forbidden in synthetic preview'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = await preview(t);
  assert.equal(app.server.address().address, '127.0.0.1');
  assert.throws(() => app.server.listen(0, '0.0.0.0'), /127\.0\.0\.1/);
  assert.throws(() => app.server.listen({ port: 0, host: '::' }), /127\.0\.0\.1/);
  assert.throws(() => app.server.listen('/tmp/materials.sock'), /TCP/);
  assert.equal(app.session.payload.preview.synthetic, true);
  assert.match(app.session.payload.user.label, /本地合成数据/);
  assert.equal(app.session.payload.preview.message, PREVIEW_NOTICE);
  const overview = await app.request('/api/materials/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.headers['x-preview-data'], 'synthetic-memory-only');
  const shell = await app.request('/console/materials');
  assert.equal(shell.status, 200);
  assert.match(shell.text, /<html/);
  assert.equal((await app.request('/api/health')).payload.server, 'local-synthetic');
  assert.equal((await app.request('/api/materials/inventory/synthetic-kit/qr')).status, 200);
  assert.deepEqual(externalCalls, []);
});

test('preview rejects external hostnames and cross-origin writes', async (t) => {
  const app = await preview(t);
  const hostileHost = await app.request('/api/materials/overview', { headers: { Host: 'external.example' } });
  assert.equal(hostileHost.status, 403);
  assert.equal(hostileHost.payload.code, 'preview_loopback_only');
  const origin = await app.request('/api/materials/transactions', {
    method: 'POST', headers: { Origin: 'https://external.example' },
    body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 1 },
  });
  assert.equal(origin.status, 403);
  assert.equal(origin.payload.code, 'preview_origin_rejected');
  assert.equal((await app.request('/api/materials/overview', { headers: { Origin: 'garbage' } })).status, 403);
});

test('CSRF failure does not mutate rows, logout revokes session, and login rotates the token', async (t) => {
  const app = await preview(t);
  const originalToken = app.token();
  const before = (await app.request('/api/materials/scan?code=NJU-RC-synthetic-kit')).payload.item.quantity;
  const denied = await app.request('/api/materials/transactions', { method: 'POST', withCsrf: false,
    body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 1 } });
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.code, 'csrf_failed');
  assert.equal((await app.request('/api/materials/scan?code=NJU-RC-synthetic-kit')).payload.item.quantity, before);
  assert.equal((await app.request('/api/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await app.request('/api/materials/overview')).status, 401);
  assert.equal((await app.request('/api/auth/session')).payload.authenticated, false);
  const login = await app.request('/api/auth/login', { method: 'POST', body: { username: 'ignored', password: 'not-a-real-password' } });
  assert.equal(login.payload.authenticated, true);
  assert.equal(login.payload.user.username, 'synthetic-materials-admin');
  assert.notEqual(app.token(), originalToken);
  const stale = await app.request('/api/materials/transactions', { method: 'POST',
    headers: { 'X-CSRF-Token': originalToken }, body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 1 } });
  assert.equal(stale.status, 403);
});

test('signed-out mode and unknown business endpoints do not imply production access', async (t) => {
  const app = await preview(t, { signedIn: false });
  assert.equal(app.session.payload.authenticated, false);
  assert.equal((await app.request('/api/materials/overview')).status, 401);
  await app.request('/api/auth/login', { method: 'POST', body: {} });
  const unknown = await app.request('/api/public/materials/production-only', { method: 'POST', body: {} });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.payload.code, 'preview_route_not_found');
});

test('fixtures cover partial return, overdue, low stock, pending sync, and a full paged ledger', async (t) => {
  const app = await preview(t);
  const overview = (await app.request('/api/materials/overview')).payload;
  assert.equal(overview.applications.find(item => item.id === 'synthetic-approved').applicant, '合成同学乙');
  assert.ok(overview.stats.flowCount > 8);
  assert.equal(overview.recentFlows.length, 8);
  assert.ok(overview.lowStock.length > 0);
  assert.ok(overview.overdue.length > 0);
  const partial = overview.applications.find((item) => item.id === 'synthetic-partial');
  assert.equal(partial.outstandingQuantity, 1);
  assert.equal(partial.lossQuantity, 1);
  const flows = (await app.request('/api/materials/flows?page=1&pageSize=5')).payload;
  assert.equal(flows.flows.length, 5);
  assert.ok(flows.total > 8);
  const second = (await app.request('/api/materials/flows?page=2&pageSize=5')).payload;
  assert.equal(second.flows.length, 5);
  assert.ok(!second.flows.some((item) => flows.flows.some((first) => first.id === item.id)));
  assert.ok((await app.request('/api/materials/flows?errorOnly=true')).payload.flows.some((item) => item.syncPending));
});

test('普通申请人不能读取管理端实名借用台账', async (t) => {
  const app = await preview(t, { portalActor: { id: 'synthetic-member', memberCode: 'LOCAL-MEMBER', canReview: false } });
  const result = await app.request('/api/materials/overview');
  assert.equal(result.status, 403);
  assert.equal('applications' in result.payload, false);
});

test('inventory edits preserve stock and apply only schema-supported management fields', async (t) => {
  const app = await preview(t);
  const schema = (await app.request('/api/materials/schema')).payload;
  assert.equal(schema.baselineEditable, false);
  assert.deepEqual(schema.fields.center.options, ['合成苏州中心', '合成南京中心']);
  const before = (await app.request('/api/materials/scan?code=NJU-RC-synthetic-kit')).payload.item.quantity;
  const edited = await app.request('/api/materials/inventory/synthetic-kit', { method: 'PATCH',
    body: { name: '急救箱（合成本地编辑）', cabinet: '合成D柜', center: '合成南京中心', threshold: 3, thresholdEnabled: true } });
  assert.equal(edited.status, 200);
  assert.equal(edited.payload.item.name, '急救箱（合成本地编辑）');
  assert.equal(edited.payload.item.quantity, before);
  assert.equal(edited.payload.item.cabinet, '合成D柜');
  assert.equal(edited.payload.item.threshold, 3);
  assert.equal((await app.request('/api/materials/inventory/synthetic-kit', { method: 'PATCH', body: { quantity: 300 } })).status, 400);
  assert.equal((await app.request('/api/materials/inventory/synthetic-kit', { method: 'PATCH', body: { center: '不在选项中' } })).status, 400);
});

test('scan and overview share real ledger updates and reject fractional quantities', async (t) => {
  const app = await preview(t);
  const before = (await app.request('/api/materials/scan?code=NJU-RC-synthetic-kit')).payload.item.quantity;
  const invalid = await app.request('/api/materials/transactions', { method: 'POST',
    body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 1.7, idempotencyKey: 'http:decimal' } });
  assert.equal(invalid.status, 400);
  const saved = await app.request('/api/materials/transactions', { method: 'POST',
    body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 2, idempotencyKey: 'http:inbound' } });
  assert.equal(saved.status, 201);
  const duplicate = await app.request('/api/materials/transactions', { method: 'POST',
    body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 2, idempotencyKey: 'http:inbound' } });
  assert.equal(duplicate.payload.duplicate, true);
  const scan = (await app.request('/api/materials/scan?code=NJU-RC-synthetic-kit')).payload.item;
  const inventory = (await app.request('/api/materials/overview')).payload.inventory;
  assert.equal(scan.quantity, before + 2);
  assert.equal(scan.quantity, inventory.find((item) => item.code === scan.code).quantity);
});

test('return endpoints reject the wrong asset and over-return, then settle the remaining quantity', async (t) => {
  const app = await preview(t);
  const returnItems = (assetCode, quantity) => app.request('/api/materials/applications/synthetic-partial/return', {
    method: 'POST', body: { assetCode, quantity, lossQuantity: 0, note: '外观完好，配件齐全', idempotencyKey: `http:return:${assetCode}:${quantity}` },
  });
  assert.equal((await returnItems('NJU-RC-synthetic-speaker', 1)).status, 409);
  assert.equal((await returnItems('NJU-RC-synthetic-kit', 2)).status, 409);
  const returned = await returnItems('NJU-RC-synthetic-kit', 1);
  assert.equal(returned.status, 201);
  assert.equal(returned.payload.application.outstandingQuantity, 0);
  assert.equal(returned.payload.application.lossQuantity, 1);
  assert.equal(returned.payload.application.returned, true);
});

test('retry-sync repairs application state without appending another flow or changing inventory', async (t) => {
  const app = await preview(t);
  const before = (await app.request('/api/materials/overview')).payload;
  const pending = (await app.request('/api/materials/flows?errorOnly=true')).payload.flows.find((flow) => flow.syncPending);
  assert.ok(pending);
  const quantity = before.inventory.find((item) => item.code === pending.assetCode).quantity;
  const recovered = await app.request(`/api/materials/flows/${pending.id}/retry-sync`, { method: 'POST', body: {} });
  assert.equal(recovered.status, 200);
  const after = (await app.request('/api/materials/overview')).payload;
  assert.equal(after.stats.flowCount, before.stats.flowCount);
  assert.equal(after.inventory.find((item) => item.code === pending.assetCode).quantity, quantity);
  assert.equal(after.applications.find((item) => item.id === 'synthetic-sync').status, '借出（物资）');
  assert.ok(!(await app.request('/api/materials/flows?errorOnly=true')).payload.flows.some((flow) => flow.syncPending));
});

test('flow review saves an audit note without moving stock or settling a loan', async (t) => {
  const app = await preview(t);
  const before = (await app.request('/api/materials/overview')).payload;
  const reviewed = await app.request('/api/materials/flows/synthetic-return-kit/review', {
    method: 'PATCH', body: { note: '仅合成场景：已核查损耗原因，等待后续处理' },
  });
  assert.equal(reviewed.status, 200);
  assert.match(reviewed.payload.flow.resolution.note, /已核查/);
  const after = (await app.request('/api/materials/overview')).payload;
  assert.equal(after.stats.flowCount, before.stats.flowCount);
  assert.equal(after.stats.totalCurrentQuantity, before.stats.totalCurrentQuantity);
  assert.equal(after.applications.find((item) => item.id === 'synthetic-partial').outstandingQuantity, 1);
  assert.equal((await app.request('/api/audit/recent')).payload.entries.length, 1);
});

const createBody = { name: 'HTTP本地新物资', unit: '个', center: '合成苏州中心', cabinet: 'HTTP柜', level: '1',
  initialQuantity: 4, threshold: 0, thresholdEnabled: false, idempotencyKey: 'http:lifecycle:create' };
const availabilityBody = (availability, key) => ({ availability, reason: availability === 'disabled' ? '本地检修' : '检修完成', idempotencyKey: key });

test('preview lifecycle routes require simulated login CSRF and local origin; old endpoints cannot bypass', async t => {
  const app = await preview(t, { signedIn: false, seedSyncFailure: false });
  assert.equal((await app.request('/api/preview/materials/inventory', { method: 'POST', body: createBody })).status, 401);
  assert.equal((await app.request('/api/preview/materials/inventory/synthetic-kit/availability', { method: 'PATCH', body: availabilityBody('disabled', 'denied') })).status, 401);
  await app.request('/api/auth/login', { method: 'POST', body: {} });
  const before = (await app.request('/api/materials/overview')).payload;
  assert.equal((await app.request('/api/preview/materials/inventory', { method: 'POST', body: createBody, withCsrf: false })).status, 403);
  assert.equal((await app.request('/api/preview/materials/inventory/synthetic-kit/availability', { method: 'PATCH', body: availabilityBody('disabled', 'denied'), withCsrf: false })).status, 403);
  assert.equal((await app.request('/api/preview/materials/inventory', { method: 'POST', body: createBody, headers: { Origin: 'https://outside.example' } })).status, 403);
  assert.equal((await app.request('/api/preview/materials/inventory/synthetic-kit/availability', { method: 'PATCH', body: availabilityBody('disabled', 'denied'), headers: { Origin: 'https://outside.example' } })).status, 403);
  assert.equal((await app.request('/api/materials/inventory', { method: 'POST', body: createBody })).status, 404);
  assert.equal((await app.request('/api/materials/inventory/synthetic-kit/availability', { method: 'PATCH', body: availabilityBody('disabled', 'bypass') })).status, 404);
  assert.equal((await app.request('/api/materials/inventory/synthetic-kit', { method: 'PATCH', body: { availability: 'disabled' } })).status, 400);
  const after = (await app.request('/api/materials/overview')).payload;
  assert.equal(after.inventory.length, before.inventory.length); assert.equal(after.stats.flowCount, before.stats.flowCount);
  assert.equal(after.inventory.find(item => item.id === 'synthetic-kit').availability, 'active');
});

test('HTTP creation exposes local-demo capability, returns generated asset and creates only one inbound', async t => {
  const app = await preview(t, { seedSyncFailure: false });
  const before = (await app.request('/api/materials/overview')).payload;
  assert.equal(before.capabilities.inventoryLifecycle.mode, 'local-demo');
  assert.equal((await app.request('/api/materials/schema')).payload.creation.fields.initialQuantity.editable, true);
  const create = () => app.request('/api/preview/materials/inventory', { method: 'POST', body: createBody });
  const first = await create(), replay = await create();
  assert.equal(first.status, 201); assert.equal(replay.status, 200); assert.equal(replay.payload.duplicate, true);
  assert.equal(first.payload.item.id, replay.payload.item.id); assert.equal(first.payload.item.initial, 4);
  assert.equal(first.payload.item.baselineQuantity, 0); assert.equal(first.payload.item.quantity, 4); assert.equal(first.payload.item.difference, 0);
  assert.equal((await app.request(`/api/materials/scan?code=${first.payload.item.code}`)).payload.item.availability, 'active');
  assert.equal((await app.request('/api/preview/materials/inventory', { method: 'POST', body: { ...createBody, initialQuantity: 1.5, idempotencyKey: 'http:bad' } })).status, 400);
  assert.equal((await app.request('/api/preview/materials/inventory', { method: 'POST', body: { ...createBody, initialQuantity: 3 } })).status, 409);
  const after = (await app.request('/api/materials/overview')).payload;
  assert.equal(after.inventory.length, before.inventory.length + 1); assert.equal(after.stats.flowCount, before.stats.flowCount + 1);
  assert.equal(after.stats.totalCurrentQuantity, before.stats.totalCurrentQuantity + 4);
});

test('HTTP disable retains original return and metadata, blocks new movement and supports restore history', async t => {
  const app = await preview(t, { seedSyncFailure: false });
  const path = '/api/preview/materials/inventory/synthetic-kit/availability';
  const stopped = await app.request(path, { method: 'PATCH', body: availabilityBody('disabled', 'http:disable') });
  assert.equal(stopped.status, 200); assert.equal(stopped.payload.item.quantity, 10); assert.equal(stopped.payload.item.availability, 'disabled');
  assert.equal((await app.request(path, { method: 'PATCH', body: availabilityBody('disabled', 'http:disable') })).payload.duplicate, true);
  assert.equal((await app.request('/api/materials/transactions', { method: 'POST', body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 1, idempotencyKey: 'http:new' } })).status, 409);
  assert.equal((await app.request('/api/materials/applications/synthetic-approved/checkout', { method: 'POST', body: { assetCode: 'NJU-RC-synthetic-kit', quantity: 2, idempotencyKey: 'http:new-loan' } })).status, 409);
  const returned = await app.request('/api/materials/applications/synthetic-partial/return', { method: 'POST', body: { assetCode: 'NJU-RC-synthetic-kit', quantity: 1, lossQuantity: 0, idempotencyKey: 'http:old-return' } });
  assert.equal(returned.status, 201); assert.equal(returned.payload.item.availability, 'disabled'); assert.equal(returned.payload.item.quantity, 11);
  const restored = await app.request(path, { method: 'PATCH', body: availabilityBody('active', 'http:restore') });
  assert.equal(restored.payload.item.availability, 'active'); assert.equal(restored.payload.item.quantity, 11);
  assert.deepEqual(restored.payload.item.availabilityHistory.map(item => item.action), ['disable', 'restore']);
  assert.equal((await app.request('/api/materials/transactions', { method: 'POST', body: { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 1, idempotencyKey: 'http:after-restore' } })).status, 201);
});

test('HTTP pending-sync prevents disabling until existing recovery route confirms it', async t => {
  const app = await preview(t);
  const path = '/api/preview/materials/inventory/synthetic-camera/availability', body = availabilityBody('disabled', 'http:disable-camera');
  const denied = await app.request(path, { method: 'PATCH', body });
  assert.equal(denied.status, 409); assert.equal(denied.payload.code, 'material_sync_pending');
  const pending = (await app.request('/api/materials/flows?errorOnly=true')).payload.flows.find(flow => flow.syncPending);
  assert.equal((await app.request(`/api/materials/flows/${pending.id}/retry-sync`, { method: 'POST', body: {} })).status, 200);
  const stopped = await app.request(path, { method: 'PATCH', body });
  assert.equal(stopped.status, 200); assert.equal(stopped.payload.item.quantity, 2); assert.equal(stopped.payload.item.availability, 'disabled');
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('HTTP availability and legacy transactions use one queue, so queued outbound cannot race disabling', async t => {
  const data = createMaterialsFixtures(), entered = deferred(), release = deferred(), original = data.client.appendRow;
  data.client.appendRow = async (table, row) => {
    if (table === FIXTURE_TABLES.flows && row['幂等键'] === 'http:race:first') { entered.resolve(); await release.promise; }
    return original(table, row);
  };
  t.after(() => release.resolve());
  const app = await preview(t, { fixture: data, seedSyncFailure: false });
  const first = app.request('/api/materials/transactions', { method: 'POST', body: { assetCode: 'NJU-RC-synthetic-kit', operation: '出库', quantity: 1, destination: '首笔领用', idempotencyKey: 'http:race:first' } });
  await entered.promise;
  const stopBodyRead = deferred();
  app.server.on('request', req => { if (req.url.endsWith('/availability')) req.once('end', () => stopBodyRead.resolve()); });
  const stop = app.request('/api/preview/materials/inventory/synthetic-kit/availability', { method: 'PATCH', body: availabilityBody('disabled', 'http:race:disable') });
  await stopBodyRead.promise; await new Promise(resolve => setImmediate(resolve));
  const trailing = app.request('/api/materials/transactions', { method: 'POST', body: { assetCode: 'NJU-RC-synthetic-kit', operation: '出库', quantity: 1, destination: '后续领用', idempotencyKey: 'http:race:last' } });
  release.resolve();
  const results = await Promise.all([first, stop, trailing]);
  assert.deepEqual(results.map(result => result.status), [201, 200, 409]);
  const item = (await app.request('/api/materials/scan?code=NJU-RC-synthetic-kit')).payload.item;
  assert.equal(item.quantity, 9); assert.equal(item.availability, 'disabled');
});
