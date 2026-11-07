import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import {
  storePhoto, sendPhoto, removePhoto, attendanceBoxPath, evidenceProvider,
  maxEvidenceBytes, setEvidenceBoxConfig, resetEvidenceStore,
} from '../lib/events/attendance-photo.js';
import { openEvidenceStore } from '../lib/events/attendance-evidence-store.js';

const jpeg = () => sharp({ create: { width: 24, height: 18, channels: 3, background: { r: 210, g: 60, b: 70 } } }).jpeg().toBuffer();
const response = (body, status = 200) => new Response(typeof body === 'string' ? body : new Uint8Array(body), { status });

function boxMock(bytes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || 'GET';
    calls.push({ target, method });
    if (target.includes('/dir/?path=')) return response(JSON.stringify({ dirent_list: [] }));
    if (target.includes('operation=mkdir')) return response('ok');
    if (target.includes('/upload-link/')) return response(JSON.stringify('https://box.test/upload'));
    if (target === 'https://box.test/upload') return response(JSON.stringify('commit-id'));
    if (target.includes('/download-link/')) return response(JSON.stringify('https://box.test/download'));
    if (target === 'https://box.test/download') return response(bytes);
    if (target.includes('/file/?path=') && method === 'DELETE') return response(JSON.stringify({ success: true }));
    return response('{}');
  };
  return { calls, fetchImpl };
}

async function fixture(t, { provider = 'box', fetchImpl = null, perAccount = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'attendance-evidence-'));
  const previous = {};
  const values = {
    WORKFLOW_EVIDENCE_DIR: join(root, 'photos'),
    WORKFLOW_EVIDENCE_DB: join(root, 'evidence.sqlite'),
    WORKFLOW_EVIDENCE_PROVIDER: provider,
    WORKFLOW_EVIDENCE_MAX_PER_ACCOUNT: perAccount,
    NJUBOX_ATTENDANCE_DIR: '/活动签到凭证',
  };
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === '') delete process.env[key]; else process.env[key] = value;
  }
  resetEvidenceStore();
  if (fetchImpl) setEvidenceBoxConfig({ njuboxToken: 'test-token', njuboxServerUrl: 'https://box.test', njuboxFetch: fetchImpl });
  t.after(async () => {
    resetEvidenceStore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

const fakeResponse = () => {
  const result = { headers: null, body: null };
  return {
    result,
    node: {
      writeHead(_status, headers) { result.headers = headers; },
      end(bytes) { result.body = bytes; },
    },
  };
};

test('provider defaults to Box only when a library token is configured', async t => {
  const root = await fixture(t, { provider: 'auto' });
  const savedMain = process.env.NJUBOX_MAIN_TOKEN;
  const savedLegacy = process.env.NJUBOX_API_TOKEN;
  delete process.env.NJUBOX_MAIN_TOKEN;
  delete process.env.NJUBOX_API_TOKEN;
  resetEvidenceStore();
  assert.equal(evidenceProvider(), 'local', 'auto without a token stays local');
  setEvidenceBoxConfig({ njuboxToken: 'test-token', njuboxFetch: async () => response('{}') });
  assert.equal(evidenceProvider(), 'box');
  process.env.WORKFLOW_EVIDENCE_PROVIDER = 'local';
  assert.equal(evidenceProvider(), 'local');
  if (savedMain !== undefined) process.env.NJUBOX_MAIN_TOKEN = savedMain;
  if (savedLegacy !== undefined) process.env.NJUBOX_API_TOKEN = savedLegacy;
  assert.equal(maxEvidenceBytes(), 8 * 1024 * 1024);
  assert.ok(root);
});

test('Box paths are layered by month, activity and registration', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const path = attendanceBoxPath({ date: '2026-11-07', eventId: 'ACT 1/..', registrationCode: 'WR-9' }, id, 'image/png');
  assert.deepEqual(path, { relativePath: '2026-11/ACT_1___/WR-9', filename: `${id}.png` });
  assert.equal(attendanceBoxPath({}, id, 'image/jpeg').filename, `${id}.jpg`);
  assert.match(attendanceBoxPath({}, id, 'image/webp').relativePath, /^\d{4}-\d{2}\/未关联活动\/未关联报名$/);
});

test('Box upload records metadata, reads back through Box and removes both', async t => {
  const bytes = await jpeg();
  const { calls, fetchImpl } = boxMock(bytes);
  const root = await fixture(t, { fetchImpl });
  const context = { date: '2026-11-07', eventId: 'ACT-1', registrationCode: 'WR-1', studentId: '231250082' };
  const id = await storePhoto(Readable.from([bytes]), context);
  assert.match(id, /^[a-f0-9-]{36}$/);

  const store = await openEvidenceStore(join(root, 'evidence.sqlite'));
  const entry = store.get(id);
  store.close();
  assert.equal(entry.provider, 'box');
  assert.match(entry.path, /^\/活动签到凭证\/2026-11\/ACT-1\/WR-1\//);
  assert.equal(entry.event_id, 'ACT-1');
  assert.equal(entry.sha256.length, 64);

  const sent = fakeResponse();
  await sendPhoto(sent.node, id);
  assert.equal(sent.result.headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(Buffer.from(sent.result.body), bytes);
  assert.ok(calls.some(call => call.target.includes('/download-link/')));

  await removePhoto(id);
  assert.ok(calls.some(call => call.method === 'DELETE' && call.target.includes('/file/?path=')));
  const after = await openEvidenceStore(join(root, 'evidence.sqlite'));
  assert.equal(after.get(id), null);
  after.close();
});

test('Box failure falls back to the private local directory without losing the photo', async t => {
  const bytes = await jpeg();
  const root = await fixture(t, { fetchImpl: async () => { throw Error('box offline'); } });
  const id = await storePhoto(Readable.from([bytes]), { eventId: 'ACT-2', registrationCode: 'WR-2' });
  assert.deepEqual(await readFile(join(root, 'photos', id)), bytes);
  const sent = fakeResponse();
  await sendPhoto(sent.node, id);
  assert.deepEqual(Buffer.from(sent.result.body), bytes);
});

test('historic local files without metadata rows remain readable', async t => {
  const bytes = await jpeg();
  const root = await fixture(t, { provider: 'local' });
  const id = await storePhoto(Readable.from([bytes]));
  assert.equal(evidenceProvider(), 'local');
  const sent = fakeResponse();
  await sendPhoto(sent.node, id);
  assert.deepEqual(Buffer.from(sent.result.body), bytes);
  assert.ok(root);
});

test('per-account quota rejects a new upload instead of silently falling back', async t => {
  const bytes = await jpeg();
  const { fetchImpl } = boxMock(bytes);
  await fixture(t, { fetchImpl, perAccount: '1' });
  const context = { studentId: '231250082', eventId: 'ACT-3', registrationCode: 'WR-3' };
  await storePhoto(Readable.from([bytes]), context);
  await assert.rejects(storePhoto(Readable.from([bytes]), context), { statusCode: 429 });
});

test('metadata store supports reference reconciliation', async t => {
  const root = await fixture(t, { provider: 'local' });
  const store = await openEvidenceStore(join(root, 'reconcile.sqlite'));
  store.record({ id: 'a'.repeat(36), provider: 'box', path: '/活动签到凭证/a.jpg', bytes: 10, mime: 'image/jpeg', sha256: 'x', created_at: new Date().toISOString() });
  store.record({ id: 'b'.repeat(36), provider: 'box', path: '/活动签到凭证/b.jpg', bytes: 10, mime: 'image/jpeg', sha256: 'y', created_at: new Date().toISOString() });
  store.markReferenced(['a'.repeat(36)]);
  assert.equal(store.list('box').length, 2);
  assert.equal(store.list().filter(row => row.referenced === 1).length, 1);
  store.close();
  await assert.rejects(access(join(root, 'photos')), { code: 'ENOENT' });
});
