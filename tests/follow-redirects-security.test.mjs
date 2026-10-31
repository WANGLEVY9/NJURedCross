import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const redirectHttp = createRequire(import.meta.url)('follow-redirects').http;

test('custom sensitive credentials are removed on cross-origin redirects for same-realm and VM-created arrays', async t => {
  const received = [];
  const target = http.createServer((req, res) => { received.push(req.headers); res.end('ok'); });
  const source = http.createServer((req, res) => {
    res.writeHead(302, { Location: `http://localhost:${target.address().port}/target` }); res.end();
  });
  for (const server of [target, source]) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  }
  for (const sensitiveHeaders of [['X-API-Key'], vm.runInNewContext("['X-API-Key']")]) {
    await new Promise((resolve, reject) => {
      const req = redirectHttp.get({ hostname: '127.0.0.1', port: source.address().port, path: '/', family: 4,
        sensitiveHeaders, headers: { 'X-API-Key': 'SYNTHETIC-SECRET', 'X-Harmless': 'synthetic-public' } }, res => {
        res.resume(); res.on('end', resolve); res.on('error', reject);
      });
      req.on('error', reject); req.setTimeout(5000, () => req.destroy(Error('Synthetic redirect timed out')));
    });
    assert.equal(received.at(-1)['x-api-key'], undefined);
    assert.equal(received.at(-1)['x-harmless'], 'synthetic-public');
  }
  assert.equal(received.length, 2);
});
