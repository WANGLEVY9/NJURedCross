import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { collectRequestBody } from '../lib/http/request-body.js';
import { assertRequestActive } from '../lib/http/request-budget.js';

async function loadReader() {
  const source = await readFile(
    new URL('../server.js', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('async function readMaterialAction(');
  const end = source.indexOf('function safeUploadName(', start);

  assert.ok(start >= 0 && end > start, 'Material upload reader must exist');

  const context = vm.createContext({
    collectRequestBody,
    assertRequestActive,
    Response,
    File,
    readJson: async () => ({ action: 'synthetic' }),
  });

  vm.runInContext(
    source.slice(start, end)
      + '\n globalThis.reader = readMaterialAction;',
    context,
  );
  return context.reader;
}

function request(chunks, headers) {
  const req = Readable.from(chunks);
  req.headers = headers;
  return req;
}

test('multipart uploads work without a content-length header', async () => {
  const reader = await loadReader();
  const form = new FormData();
  form.set('action', 'synthetic');
  form.set('photo', new Blob(['synthetic-photo']), 'example.jpg');

  const encoded = new Response(form);
  const req = request(
    [Buffer.from(await encoded.arrayBuffer())],
    { 'content-type': encoded.headers.get('content-type') },
  );

  const result = await reader(req);
  assert.equal(result.body.action, 'synthetic');
  assert.equal(result.photo.name, 'example.jpg');
  assert.equal(await result.photo.text(), 'synthetic-photo');
});

test('uploads without content-length cannot exceed the actual byte limit', async () => {
  const reader = await loadReader();
  const req = request(
    [Buffer.alloc(8 * 1024 * 1024), Buffer.from('x')],
    { 'content-type': 'multipart/form-data; boundary=synthetic' },
  );

  await assert.rejects(
    reader(req),
    error => error.statusCode === 413,
  );
});

test('a low declared content-length cannot bypass actual byte counting', async () => {
  const reader = await loadReader();
  const req = request(
    [Buffer.alloc(8 * 1024 * 1024), Buffer.from('x')],
    {
      'content-type': 'multipart/form-data; boundary=synthetic',
      'content-length': '1',
    },
  );

  await assert.rejects(
    reader(req),
    error => error.statusCode === 413,
  );
});

test('a missing multipart boundary returns a sanitized client error', async () => {
  const reader = await loadReader();
  const req = request(
    [Buffer.from('synthetic-private-input')],
    { 'content-type': 'multipart/form-data' },
  );

  await assert.rejects(reader(req), error => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'invalid_multipart_body');
    assert.equal(error.message.includes('synthetic-private-input'), false);
    return true;
  });
});

test('a broken multipart body returns a sanitized client error', async () => {
  const reader = await loadReader();
  const req = request(
    [Buffer.from('--synthetic\r\nbroken-header')],
    { 'content-type': 'multipart/form-data; boundary=synthetic' },
  );

  await assert.rejects(reader(req), error => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'invalid_multipart_body');
    assert.equal(error.message.includes('broken-header'), false);
    return true;
  });
});