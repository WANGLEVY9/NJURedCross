import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import nodemailer from 'nodemailer';
import { Base } from 'seatable-api';
import { createStaticHandler } from '../lib/http/static.js';
import { createSeaTableAccess } from '../lib/seatable-auth.js';
import { configureMailer, mailerStatus, sendMail } from '../lib/mailer.js';

const token = exp => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
test('SeaTable access shares concurrent auth, refreshes before expiry and retries failures', async () => {
  let now = 1_000_000, calls = 0, fail = false;
  const base = { async auth() { calls++; if (fail) throw Error('synthetic outage'); this.accessToken = token((now + 600_000) / 1000); } };
  const access = createSeaTableAccess(base, { now: () => now });
  await Promise.all([access(), access(), access()]);
  assert.equal(calls, 1);
  now += 299_999; await access(); assert.equal(calls, 1);
  now++; await access(); assert.equal(calls, 2);
  now += 300_000; fail = true; await assert.rejects(access(), /synthetic outage/);
  fail = false; assert.equal(await access(), base); assert.equal(calls, 4);
});
test('SeaTable rejects already expired access tokens and bounds opaque-token cache age', async () => {
  let now = 1_000_000, calls = 0;
  const expired = createSeaTableAccess({ async auth() { this.accessToken = token(now / 1000); } }, { now: () => now });
  await assert.rejects(expired(), /near-expiry/);
  const access = createSeaTableAccess({ async auth() { calls++; this.accessToken = 'opaque'; } }, { now: () => now, maxAgeMs: 100 });
  await access(); now += 100; await access(); assert.equal(calls, 2);
});
test('static HTTP serves SPA/assets, revalidates, rejects malformed paths and sibling traversal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nju-rc-test-'));
  const publicDir = join(directory, 'public');
  await mkdir(publicDir); await mkdir(join(directory, 'public-private'));
  await writeFile(join(publicDir, 'index.html'), '<main>synthetic fixture</main>');
  await writeFile(join(publicDir, 'app.js'), 'export const fixture = true;');
  await writeFile(join(directory, 'public-private', 'secret.txt'), 'MUST NOT BE SERVED');
  const handler = createStaticHandler(publicDir);
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://localhost')));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const shell = await fetch(`${base}/console/events`);
  assert.equal(shell.status, 200); assert.match(await shell.text(), /synthetic fixture/);
  assert.equal(shell.headers.get('x-frame-options'), 'DENY');
  const asset = await fetch(`${base}/app.js`); assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${base}/app.js`, { headers: { 'If-None-Match': asset.headers.get('etag') } })).status, 304);
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/bad%zz`)).status, 400);
  assert.equal((await fetch(`${base}/%00.js`)).status, 400);
  assert.equal((await fetch(`${base}/..%2fpublic-private%2fsecret.txt`)).status, 403);
  assert.equal((await fetch(`${base}/app.js`, { method: 'HEAD' })).status, 200);
});
test('updated SeaTable SDK loads and Nodemailer generates mail without SMTP/network', async () => {
  const base = new Base({ server: 'https://synthetic.invalid', APIToken: 'synthetic-only' });
  assert.equal(typeof base.auth, 'function'); assert.equal(typeof base.listRows, 'function');
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const result = await transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', subject: 'synthetic', text: 'fixture' });
  assert.match(result.message.toString(), /Subject: synthetic/);
  configureMailer({ isProduction: true });
  assert.equal(mailerStatus().transport, 'none');
  assert.equal((await sendMail({ to: 'recipient@example.test', text: 'fixture' })).ok, false);
});

test('overridden Axios supports SDK authentication and row requests against a synthetic local server', async t => {
  const requests = [];
  let endpoint;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, endpoint);
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: url.pathname, method: req.method, authorization: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/v2.1/dtable/app-access-token/') {
      return res.end(JSON.stringify({ app_name: 'synthetic', access_token: 'synthetic-access', dtable_uuid: 'synthetic-base', dtable_server: `${endpoint}/` }));
    }
    if (req.method === 'GET') return res.end(JSON.stringify({ rows: [{ _id: 'fixture-row', label: 'synthetic' }] }));
    return res.end(JSON.stringify({ _id: 'fixture-row', success: true }));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  endpoint = `http://127.0.0.1:${server.address().port}`;
  const base = new Base({ server: endpoint, APIToken: 'synthetic-api-token' });
  await base.auth();
  assert.deepEqual(await base.listRows('fixture', '', '', false, 0, 100), [{ _id: 'fixture-row', label: 'synthetic' }]);
  await base.appendRow('fixture', { label: 'synthetic' });
  assert.equal(requests[0].authorization, 'Token synthetic-api-token');
  assert.equal(requests[1].authorization, 'Token synthetic-access');
  assert.equal(requests[2].method, 'POST');
  assert.equal(JSON.parse(requests[2].body).row.label, 'synthetic');
});
