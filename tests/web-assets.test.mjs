import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createStaticHandler } from '../lib/http/static.js';
import { createWebAssets, STYLE_BUNDLE_PATH } from '../lib/http/web-assets.js';

const SHELL = `<!doctype html><html><head><title>fixture</title>
<link rel="stylesheet" href="/styles/first.css" />
<link rel="stylesheet" href="/styles/second.css">
<link rel="stylesheet" href="/assets/print.css" />
<link rel="modulepreload" href="/app/main.js" />
</head><body><div id="root"></div></body></html>`;
const FIRST = '/* first */\n.a{color:red}\n' + '.pad-first{content:"fixture padding"}\n'.repeat(90);
const SECOND = '/* second */\n.b{background:url("/assets/fonts/x.woff2")}\n' + '.pad-second{content:"fixture padding"}\n'.repeat(90);
const cssImport = rule => '@' + 'im' + 'port ' + rule + ';';

async function fixture(t, { shell = SHELL, first = FIRST, second = SECOND, extra = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nju-web-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'index.html'), shell);
  await writeFile(join(dir, 'styles', 'first.css'), first);
  await writeFile(join(dir, 'styles', 'second.css'), second);
  for (const [path, contents] of Object.entries(extra)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), contents);
  }
  const handler = createStaticHandler(dir);
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://fixture')));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const get = (origin, path, headers = {}) => new Promise((resolve, reject) => {
  http.get(origin + path, { headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

test('the shell collapses stylesheet links into one versioned bundle', async t => {
  const origin = await fixture(t);
  const shell = await get(origin, '/');
  const html = shell.body.toString('utf8');
  const links = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) || [];
  const local = links.filter(tag => /href="\/styles\//.test(tag));
  assert.equal(local.length, 1, 'all /styles/ sheets collapse into the bundle');
  assert.equal(links.length, 2, 'a non-/styles/ sheet is left untouched');
  const href = local[0].match(/href="([^"]+)"/)[1];
  assert.match(href, /^\/styles\/app\.css\?v=[0-9a-f]{12}$/);
  // Non-local stylesheets and preloads are left untouched.
  assert.match(html, /href="\/assets\/print\.css"/);
  assert.match(html, /rel="modulepreload" href="\/app\/main\.js"/);
  assert.match(html, /rel="modulepreload" href="\/app\/core\/format\.js"/);
  assert.equal(shell.headers['cache-control'], 'no-store');
  assert.equal(shell.headers.vary, 'Accept-Encoding');
});

test('the console surface preloads console modules; the portal does not', async t => {
  const origin = await fixture(t);
  const portal = (await get(origin, '/')).body.toString('utf8');
  const consoleShell = (await get(origin, '/console/overview')).body.toString('utf8');
  assert.doesNotMatch(portal, /console\/shell\.js/);
  assert.match(consoleShell, /console\/shell\.js/);
  assert.match(portal, /portal\/navigation\.js/);
});

test('the bundle preserves stylesheet order and pins to the shell version', async t => {
  const origin = await fixture(t);
  const html = (await get(origin, '/')).body.toString('utf8');
  const version = html.match(/app\.css\?v=([0-9a-f]{12})/)[1];

  const pinned = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'gzip' });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(pinned.headers['cache-control'], 'public, max-age=31536000, immutable');
  const css = gunzipSync(pinned.body).toString('utf8');
  assert.ok(css.indexOf('/* first */') < css.indexOf('/* second */'), 'head order is preserved');
  assert.match(css, /url\("\/assets\/fonts\/x\.woff2"\)/);
  assert.match(pinned.headers.etag, /^W\/"[0-9a-f]{12}"$/);

  // Revalidation and a stale token both fall back to revalidation, never immutability.
  assert.equal((await get(origin, `/styles/app.css?v=${version}`, { 'If-None-Match': pinned.headers.etag })).status, 304);
  assert.equal((await get(origin, '/styles/app.css')).headers['cache-control'], 'no-cache');
  assert.equal((await get(origin, '/styles/app.css?v=000000000000')).headers['cache-control'], 'no-cache');
});

test('the bundle negotiates brotli and gzip independently of gzip-only callers', async t => {
  const origin = await fixture(t);
  const html = (await get(origin, '/')).body.toString('utf8');
  const version = html.match(/app\.css\?v=([0-9a-f]{12})/)[1];

  const br = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'br, gzip' });
  assert.equal(br.headers['content-encoding'], 'br');
  const brText = brotliDecompressSync(br.body).toString('utf8');
  assert.match(brText, /^\/\* \/styles\/first\.css \*\//);
  assert.ok(brText.includes('/* first */') && brText.indexOf('/* first */') < brText.indexOf('/* second */'));

  const gz = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');

  const plain = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'identity' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(plain.body.toString('utf8').includes('/* first */'));
});

test('the bundle token changes when a stylesheet changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nju-web-assets-version-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'index.html'), SHELL);
  await writeFile(join(dir, 'styles', 'first.css'), FIRST);
  await writeFile(join(dir, 'styles', 'second.css'), SECOND);
  const first = (await createWebAssets(dir).bundle()).version;
  await writeFile(join(dir, 'styles', 'second.css'), SECOND + '.c{color:blue}\n');
  const second = (await createWebAssets(dir).bundle()).version;
  assert.notEqual(first, second);
  assert.equal(STYLE_BUNDLE_PATH, '/styles/app.css');
});

test('cached delivery assets refresh after an in-place shell or stylesheet deployment', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nju-web-assets-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'index.html'), SHELL);
  await writeFile(join(dir, 'styles', 'first.css'), FIRST);
  await writeFile(join(dir, 'styles', 'second.css'), SECOND);
  const assets = createWebAssets(dir, { refreshIntervalMs: 0 });
  const shellBefore = (await assets.shell('portal')).html;
  const bundleBefore = (await assets.bundle()).version;

  await writeFile(join(dir, 'index.html'), SHELL.replace('<div id="root"></div>', '<div id="root"><p data-deploy="new-shell">new</p></div>'));
  assert.match((await assets.shell('portal')).html, /data-deploy="new-shell"/);
  assert.notEqual((await assets.shell('portal')).html, shellBefore);

  await writeFile(join(dir, 'styles', 'first.css'), FIRST + '.deployed{color:green}\n');
  const refreshed = await assets.bundle();
  assert.notEqual(refreshed.version, bundleBefore);
  assert.match(refreshed.body, /\.deployed\{color:green\}/);
});

test('nested imports preserve cascade, media conditions and relative asset bases', async t => {
  const origin = await fixture(t, {
    second: cssImport('"./nested/review.css" screen and (min-width: 30em)') + '\n.after{color:blue}',
    extra: {
      'styles/nested/review.css': cssImport('url("../publication.css")') + '\n.review{background:url("./icon.svg")}',
      'styles/publication.css': '.publication{color:red}',
    },
  });
  const css = (await get(origin, '/styles/app.css')).body.toString();
  assert.doesNotMatch(css, /@import\b/);
  assert.match(css, /@media screen and \(min-width: 30em\)\{/);
  assert.ok(css.indexOf('.a{') < css.indexOf('.publication{'));
  assert.ok(css.indexOf('.publication{') < css.indexOf('.review{'));
  assert.ok(css.indexOf('.review{') < css.indexOf('.after{'));
  assert.match(css, /url\("\/styles\/nested\/icon.svg"\)/);
});

test('import-like text in comments and strings is left intact', async t => {
  const origin = await fixture(t, { second: `/* ${cssImport('"missing.css"')} */\n.x{content:'${cssImport('"missing.css"')}'}` });
  const css = (await get(origin, '/styles/app.css')).body.toString();
  assert.match(css, /content:'@import "missing.css";'/);
});

for (const entry of [
  cssImport('"https://example.com/a.css"'),
  cssImport('"//example.com/a.css"'),
  cssImport('"../outside.css"'),
  cssImport('"./missing.css"'),
  cssImport('"./second.css"'),
  cssImport('"./first.css" layer(ui)'),
  cssImport('"./first.css" supports(display: grid)'),
  '.x{} ' + cssImport('"./first.css"'),
]) {
  test(`unsupported import falls back to the original shell: ${entry}`, async t => {
    const origin = await fixture(t, { second: entry, extra: { 'outside.css': '.outside{}' } });
    const response = await get(origin, '/');
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), SHELL);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal((await get(origin, '/styles/app.css')).status, 500);
  });
}

test('import cycles, symlink escapes and excessive recursion fail closed; nested edits change digest', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nju-import-limits-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'index.html'), SHELL);
  await writeFile(join(dir, 'styles/first.css'), cssImport('"./child.css"'));
  await writeFile(join(dir, 'styles/second.css'), SECOND);
  await writeFile(join(dir, 'styles/child.css'), '.nested{color:red}');
  const before = await createWebAssets(dir).bundle();
  await writeFile(join(dir, 'styles/child.css'), '.nested{color:blue}');
  assert.notEqual(before.version, (await createWebAssets(dir).bundle()).version);
  await writeFile(join(dir, 'styles/child.css'), cssImport('"./first.css"'));
  await assert.rejects(createWebAssets(dir).bundle(), /Cyclic/);
  await writeFile(join(dir, 'outside.css'), '.outside{}');
  await symlink(join(dir, 'outside.css'), join(dir, 'styles/escape.css'));
  await writeFile(join(dir, 'styles/first.css'), cssImport('"./escape.css"'));
  await assert.rejects(createWebAssets(dir).bundle(), /escapes/);
  for (let i = 0; i < 18; i++) {
    await writeFile(join(dir, `styles/depth-${i}.css`), i === 17 ? '.end{}' : cssImport(`"./depth-${i + 1}.css"`));
  }
  await writeFile(join(dir, 'styles/first.css'), cssImport('"./depth-0.css"'));
  await assert.rejects(createWebAssets(dir).bundle(), /limit/);
});

test('each surface bundles only its own stylesheet清单', async () => {
  const assets = createWebAssets(fileURLToPath(new URL('../public', import.meta.url)));
  const portal = await assets.bundle('portal');
  const console_ = await assets.bundle('console');
  assert.equal(portal.href, '/styles/app.css');
  assert.equal(console_.href, '/styles/app-console.css');
  // Shared sheets stay in both bundles.
  for (const body of [portal.body, console_.body]) {
    assert.match(body, /\/\* \/styles\/tokens\.css \*\//);
    assert.doesNotMatch(body, /@import\b/);
  }
  // The console never pays for portal visuals and the portal never pays for the
  // admin workspace styles.
  assert.match(portal.body, /\/\* \/styles\/portal\.css \*\//);
  assert.doesNotMatch(portal.body, /\/\* \/styles\/admin\.css \*\//);
  assert.match(console_.body, /\/\* \/styles\/admin\.css \*\//);
  assert.doesNotMatch(console_.body, /\/\* \/styles\/portal\.css \*\//);
  assert.doesNotMatch(console_.body, /\/\* \/styles\/booking\.css \*\//);
  assert.ok(console_.body.length < portal.body.length + 200_000);
  const { html } = await assets.shell('console');
  assert.match(html, /href="\/styles\/app-console\.css\?v=[a-f0-9]+"/);
  assert.doesNotMatch(html, /href="\/styles\/app\.css\?v=/);
  assert.doesNotMatch(html, /href="\/styles\/portal\.css"/);
  // Both bundles stay addressable so an in-app surface switch can load them.
  assert.match(html, /id="style-manifest"/);
});

test('actual application shell keeps boot CSS independent and exposes bundled deferred paths', async () => {
  const assets = createWebAssets(fileURLToPath(new URL('../public', import.meta.url)));
  const original = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { html } = await assets.shell('portal');
  const { body } = await assets.bundle();
  assert.match(html, /<link rel="stylesheet" href="\/styles\/boot.css"\s*\/>/);
  assert.match(html, /href="\/styles\/app.css\?v=[a-f0-9]+" media="print" data-deferred-style data-bundled-styles="[^"]*\/styles\/tokens.css/);
  assert.doesNotMatch(body, /@import\b/);
  assert.doesNotMatch(body, /\/\* \/styles\/boot.css \*\//);
  assert.equal((html.match(/data-deferred-style/g) || []).length, 1);
  assert.doesNotMatch(html,/href="\/styles\/font-faces.css"/);
  assert.doesNotMatch(body,/\/\* \/styles\/font-faces.css \*\//);
  // Only the style manifest is added: it names the other surface's bundle so an
  // in-app switch can fetch it on demand.
  assert.equal((html.match(/<script\b/g) || []).length, (original.match(/<script\b/g) || []).length + 1);
});
