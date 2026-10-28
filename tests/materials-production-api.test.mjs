import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { materialProductionServer } from './helpers/material-production-server.js';
const body = { applicationId: 'synthetic-overdue', quantity: 2, note: '正常归还', idempotencyKey: 'http-return-one' };
async function fixture(t, options) { const f = await materialProductionServer(options); t.after(() => f.close()); return f; }
const jsonBody = (f, method, value, csrf = true) => ({ method, headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': f.csrf } : {}) }, body: JSON.stringify(value) });

test('formal loans, return submission, manager review and stock movements form a CSRF-guarded HTTP workflow with no preview endpoints', async t => {
  const f = await fixture(t), url = f.origin;
  f.state.signedIn = false; assert.equal((await fetch(url + '/api/public/materials/loans')).status, 401); f.state.signedIn = true;
  assert.equal((await fetch(url + '/api/materials/returns')).status, 403);
  assert.equal((await fetch(url + '/api/public/materials/returns', jsonBody(f, 'POST', body, false))).status, 403);
  f.state.limited = true; assert.equal((await fetch(url + '/api/public/materials/returns', jsonBody(f, 'POST', body))).status, 429); f.state.limited = false;
  assert.equal((await (await fetch(url + '/api/public/materials/loans')).json()).loans.length, 1);
  const saved = await fetch(url + '/api/public/materials/returns', jsonBody(f, 'POST', body)); assert.equal(saved.status, 201);
  const record = (await saved.json()).record;
  f.state.role = 'other'; assert.equal((await (await fetch(url + '/api/public/materials/returns')).json()).records.length, 0);
  f.state.role = 'manager';
  const review = url + `/api/materials/returns/${encodeURIComponent(record.id)}/review`, decision = { action: 'approve', revision: 1, physicalChecked: true };
  assert.equal((await fetch(review, jsonBody(f, 'POST', decision, false))).status, 403);
  assert.equal((await fetch(review, jsonBody(f, 'POST', decision))).status, 200);
  assert.equal((await fetch(url + '/api/materials/schema')).status, 200);
  assert.equal((await fetch(url + '/api/materials/flows')).status, 200);
  const movement = { direction: 'in', reason: '采购', assetCode: 'NJU-RC-synthetic-stickers', quantity: 2, lossQuantity: 0, reference: '合成补货', idempotencyKey: 'http-inbound-one' };
  assert.equal((await fetch(url + '/api/materials/movements', jsonBody(f, 'POST', movement))).status, 200);
  assert.equal((await fetch(url + '/api/materials/inbound')).status, 200);
  assert.ok(f.requests.every(r => !r.path.startsWith('/api/preview/')));
});

test('return photos are validated, lazy, owned, privately served and unavailable to another borrower', async t => {
  const f = await fixture(t), canvas = createCanvas(80, 80); canvas.getContext('2d').fillRect(0, 0, 80, 80);
  const form = new FormData(); for (const [key, value] of Object.entries(body)) form.set(key, String(value));
  form.set('photo', new File([canvas.toBuffer('image/png')], 'synthetic.png', { type: 'image/png' }));
  const response = await fetch(f.origin + '/api/public/materials/returns', { method: 'POST', headers: { 'X-CSRF-Token': f.csrf }, body: form });
  assert.equal(response.status, 201); const record = (await response.json()).record;
  assert.equal(f.state.photoReads, 0);
  f.state.role = 'other'; assert.equal((await fetch(f.origin + record.photoUrl)).status, 404); assert.equal(f.state.photoReads, 0);
  f.state.role = 'owner'; const photo = await fetch(f.origin + record.photoUrl);
  assert.equal(photo.status, 200); assert.match(photo.headers.get('cache-control'), /no-store/); assert.equal(photo.headers.get('content-type'), 'image/png');
  assert.equal(f.state.photoReads, 1);
});

test('finance configuration reports a closed service without touching storage or making writes possible', async t => {
  const f = await fixture(t);
  const config = await fetch(f.origin + '/api/reimbursements/config');
  assert.equal(config.status, 200); const payload = await config.json(); assert.equal(payload.available, false); assert.equal(payload.code, 'reimbursements_disabled');
  assert.doesNotMatch(JSON.stringify(payload), /token|uuid|secret/i);
  const submit = await fetch(f.origin + '/api/reimbursements', jsonBody(f, 'POST', {})); assert.equal(submit.status, 503);
  assert.equal(f.writes.length, 0);
});
