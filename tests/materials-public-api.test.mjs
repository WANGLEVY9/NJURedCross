import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { publicMaterialsTestServer } from './helpers/public-materials-server.js';
import { materialBody } from './helpers/public-materials.js';

test('real public borrowing routes use authorization, CSRF, limits, durable replay and no finance endpoints', async t => {
  const f = publicMaterialsTestServer();
  f.server.listen(0, '127.0.0.1'); await once(f.server, 'listening');
  t.after(async () => { f.server.closeAllConnections(); await new Promise(resolve => f.server.close(resolve)); f.fixture.store.close(); });
  const origin = `http://127.0.0.1:${f.server.address().port}`;
  const send = (path, headers = {}) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(materialBody) });
  const path = '/api/public/materials/requests', auth = { 'X-CSRF-Token': f.csrf };
  const inventory = await (await fetch(origin + '/api/public/materials/catalog')).json();
  assert.equal(inventory[0].remaining, 8);
  f.state.signedIn = false;
  assert.equal((await send(path, auth)).status, 401);
  assert.equal((await fetch(origin + '/api/public/materials/borrow-eligibility')).status, 401);
  f.state.signedIn = true;
  assert.equal((await send(path)).status, 403);
  f.state.limited = true;
  assert.equal((await send(path, auth)).status, 429);
  f.state.limited = false;
  assert.equal(f.fixture.writes.length, 0);
  assert.equal((await send(path, auth)).status, 201);
  const replay = await send(path, auth);
  assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true);
  assert.equal(f.fixture.applications.length, 1); assert.equal(f.audit.length, 1);
  for (const path of ['/api/preview/reimbursements', '/api/public/reimbursements']) {
    assert.equal((await send(path, auth)).status, 404);
  }
});
