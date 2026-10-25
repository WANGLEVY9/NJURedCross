import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createPdfAssets } from '../lib/http/pdf-assets.js';

test('PDF assets allow only reader resources and keep other dependency files private', async t => {
  const assets = createPdfAssets();
  const server = http.createServer(async (req, res) => {
    if (!await assets(req, res, new URL(req.url, 'http://fixture'))) {
      res.writeHead(418); res.end('not a PDF asset');
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/ordinary-page`)).status, 418);
  for (const path of ['build/pdf.mjs', 'build/pdf.worker.mjs', 'cmaps/Adobe-GB1-UCS2.bcmap', 'standard_fonts/FoxitSerif.pfb', 'wasm/openjpeg.wasm']) {
    const response = await fetch(`${origin}/vendor/pdfjs/${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  const head = await fetch(`${origin}/vendor/pdfjs/build/pdf.mjs`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const path of ['package.json', 'build/pdf.mjs.map', 'standard_fonts/private/secret.txt', 'wasm/private.wasm.txt', 'build/%2e%2e%2fpackage.json']) {
    assert.equal((await fetch(`${origin}/vendor/pdfjs/${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${origin}/vendor/pdfjs/build/pdf.mjs`, { method: 'POST' })).status, 405);
});
