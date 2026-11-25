import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBuffer } from '../lib/attachment/box.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

function config(download) {
  return { njuboxToken: 'synthetic', njuboxServerUrl: 'https://box.example', njuboxFetch: async (input, options) => {
    if (new URL(input).pathname.endsWith('/download-link/')) return Response.json('https://box.example/seafhttp/fixture');
    return download(options);
  } };
}

test('Box download consumes bytes inside its budget and stops an oversized body without buffering the remainder', async () => {
  const cfg = config(async () => new Response(Buffer.from('fixture')));
  assert.equal((await downloadBuffer(cfg, '/fixture.jpg', undefined, { maxBytes: 7 })).toString(), 'fixture');
  let cancelled = false, pulls = 0;
  const oversized = config(async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(downloadBuffer(oversized, '/fixture.jpg', undefined, { maxBytes: 10 }), { code: 'njubox_file_too_large' });
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3);
  await assert.rejects(downloadBuffer(config(async () => new Response(Buffer.alloc(20), { headers: { 'content-length': '20' } })), '/fixture.jpg', undefined, { maxBytes: 10 }), { code: 'njubox_file_too_large' });
});

test('Box stalled response body times out and parent cancellation releases the reader', async () => {
  let cancelled = 0;
  let readerCreated;
  const readerObserved = new Promise(resolve => { readerCreated = resolve; });
  let readers = 0;
  const stalled = config(async () => {
    const response = new Response(new ReadableStream({ cancel() { cancelled++; } }));
    const getReader = response.body.getReader.bind(response.body);
    response.body.getReader = (...args) => {
      if (++readers === 2) readerCreated();
      return getReader(...args);
    };
    return response;
  });
  await assert.rejects(downloadBuffer(stalled, '/fixture.jpg', undefined, { timeoutMs: 10 }), { code: 'external_request_timeout' });
  assert.equal(cancelled, 1);
  const abort = new AbortController();
  const pending = withRequestBudget(() => downloadBuffer(stalled, '/fixture.jpg'), { signal: abort.signal });
  await Promise.race([
    readerObserved,
    new Promise((_, reject) => setTimeout(() => reject(new Error('reader was not observed')), 2_000)),
  ]);
  abort.abort();
  await assert.rejects(pending, { code: 'external_request_cancelled' });
  assert.equal(cancelled, 2);
});

test('Box link acquisition shares the download deadline and aborts the upstream request', async () => {
  let cancelled = 0;
  const cfg = { njuboxToken: 'synthetic', njuboxServerUrl: 'https://box.example', njuboxFetch: (_input, { signal }) => new Promise((_resolve, reject) => {
    const cancel = () => { cancelled++; reject(signal.reason); };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }) };
  await assert.rejects(downloadBuffer(cfg, '/fixture.jpg', undefined, { timeoutMs: 10 }), { code: 'external_request_timeout' });
  assert.equal(cancelled, 1);
});

test('Box missing files remain distinguishable from network and failed body transfers', async () => {
  await assert.rejects(downloadBuffer(config(async () => new Response('', { status: 404 })), '/fixture.jpg'), { code: 'njubox_not_found', statusCode: 404 });
  await assert.rejects(downloadBuffer(config(async () => { throw Error('synthetic reset'); }), '/fixture.jpg'), { code: 'njubox_network_error' });
  await assert.rejects(downloadBuffer(config(async () => new Response(new ReadableStream({ start(controller) { controller.error(Error('synthetic reset')); } }))), '/fixture.jpg'));
});
