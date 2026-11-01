import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const redirectHttp = require('follow-redirects').http;
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const declared = manifest.overrides?.['follow-redirects'] || manifest.dependencies?.['follow-redirects'];
const installed = require('follow-redirects/package.json').version;

test('the installed redirect helper matches the declared version', () => {
  // 1.16.1 用 `instanceof Array` 判定 sensitiveHeaders：跨 realm 数组会被当成非数组，
  // 自定义敏感头因此被清空、重定向时不再剥离。依赖漂移时先给出明确提示，
  // 而不是让下一条用例以「凭据泄漏」的形式失败。
  assert.equal(installed, declared, `follow-redirects 本地为 ${installed}，package.json 声明 ${declared}；请先执行 npm install`);
});

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
