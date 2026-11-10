import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticHandler, rewriteModuleUrls, createAssetVersion, versionablePath } from '../lib/http/static.js';

// Build import fixtures through a quote helper: the project-wide import checker
// scans raw source text and would otherwise treat these samples as real imports.
const QUOTE = "'";
const quoted = value => `${QUOTE}${value}${QUOTE}`;
const SHELL = `<!doctype html><html lang="zh"><head>
<link rel="stylesheet" href="/styles/base.css" />
<link rel="modulepreload" href="/app/main.js" />
<script src="/app/boot.js"></script>
<script src="/app/main.js" type="module"></script>
</head><body></body></html>`;

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nju-asset-version-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'app'));
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'index.html'), SHELL);
  await writeFile(join(dir, 'styles', 'base.css'), '.a{color:red}\n');
  await writeFile(join(dir, 'app', 'boot.js'), 'window.fixture = true;\n');
  await writeFile(join(dir, 'app', 'main.js'), [
    `import { x } from ${quoted('./dep.js')};`,
    `export const value = () => import(${quoted('./pages/uno.js')});`,
    `export const shared = () => import(${quoted('../core/toast.js')});`,
    `export { x } from ${quoted('./dep.js')};`,
    'export { x };',
  ].join('\n'));
  await writeFile(join(dir, 'app', 'dep.js'), 'export const x = 1;\n');
  const handler = createStaticHandler(dir, { assetVersion: createAssetVersion(dir, { ttlMs: 0 }) });
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://fixture')).catch(() => { res.statusCode = 500; res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { dir, base: `http://127.0.0.1:${server.address().port}` };
}

test('rewriteModuleUrls pins only the UNO leaf module and keeps shared URLs stable', () => {
  const source = [
    `import a from ${quoted('./a.js')};`,
    `import(${quoted('./pages/uno.js')});`,
    `export { c } from ${quoted('../c.js')};`,
    `const other = () => import(${quoted('./pages/about.js')});`,
    `const shared = () => import(${quoted('../core/toast.js')});`,
    `const text = ${quoted('from ./not-an-import.js')};`,
    `import(${quoted('https://cdn/x.js')});`,
  ].join('\n');
  const output = rewriteModuleUrls(source, 'abc123');
  assert.match(output, /import a from '\.\/a\.js'/);
  assert.match(output, /export \{ c \} from '\.\.\/c\.js'/);
  assert.match(output, /import\('\.\/pages\/uno\.js\?v=abc123'\)/);
  assert.match(output, /import\('\.\/pages\/about\.js'\)/);
  assert.match(output, /import\('\.\.\/core\/toast\.js'\)/);
  assert.match(output, /'from \.\/not-an-import\.js'/);
  assert.match(output, /import\('https:\/\/cdn\/x\.js'\)/);
  assert.equal(rewriteModuleUrls(source, ''), source);
  assert.equal(versionablePath('/app/core/router.js'), false);
  assert.equal(versionablePath('/app/portal/pages/about.js'), false);
  assert.equal(versionablePath('/app/portal/pages/uno.js'), true);
  assert.equal(versionablePath('/app/main.js'), true);
});

test('the shell pins entry modules and delivered lazy imports are immutable', async t => {
  const { base } = await fixture(t);
  const shell = await fetch(base + '/');
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'no-store');
  const html = await shell.text();
  const version = html.match(/data-asset-version="([0-9a-f]{16})"/)?.[1];
  assert.ok(version, 'shell must publish the release token');
  assert.match(html, new RegExp(`/app/main\\.js\\?v=${version}`));
  assert.match(html, new RegExp(`/app/boot\\.js\\?v=${version}`));

  const main = await fetch(base + `/app/main.js?v=${version}`);
  assert.equal(main.status, 200);
  assert.equal(main.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const source = await main.text();
  assert.match(source, /from '\.\/dep\.js'/);
  assert.match(source, new RegExp(`import\\('\\./pages/uno\\.js\\?v=${version}'\\)`));
  assert.match(source, /import\('\.\.\/core\/toast\.js'\)/);
  assert.equal((await fetch(base + '/app/main.js')).headers.get('cache-control'), 'no-cache');
});

test('the UNO route flattens its module waterfall without duplicating shared modules', async t => {
  const { base } = await fixture(t);
  const html = await (await fetch(base + '/games/uno')).text();
  const version = html.match(/data-asset-version="([0-9a-f]{16})"/)?.[1];
  assert.match(html, new RegExp(`/app/portal/pages/uno\\.js\\?v=${version}`));
  assert.match(html, /modulepreload" href="\/app\/games\/uno\/engine\.js"/);
  assert.match(html, /rel="preload" as="style"/);
  assert.doesNotMatch(await (await fetch(base + '/')).text(), /portal\/pages\/uno\.js\?v=/);
});

test('any front-end source change invalidates every pinned module URL', async t => {
  const { dir, base } = await fixture(t);
  const before = (await (await fetch(base + '/')).text()).match(/data-asset-version="([0-9a-f]{16})"/)[1];
  await writeFile(join(dir, 'app', 'dep.js'), 'export const x = 2;\n');
  const after = (await (await fetch(base + '/')).text()).match(/data-asset-version="([0-9a-f]{16})"/)[1];
  assert.notEqual(after, before);
  const stale = await fetch(base + `/app/main.js?v=${before}`);
  assert.equal(stale.headers.get('cache-control'), 'no-cache');
});
