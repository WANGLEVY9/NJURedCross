import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readJsonObject } from '../lib/http/json-body.js';
import { apiFailure } from '../lib/http/errors.js';
import { json } from '../lib/http/response.js';

async function fixture(t) {
  let writes = 0;

  const server = http.createServer(async (req, res) => {
    try {
      const body = await readJsonObject(req);
      writes++;
      json(res, 200, { ok: true, received: body });
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const failure = apiFailure(error);
      json(res, failure.status, failure.payload);
    }
  });

  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  function post(input) {
    const bytes = Buffer.isBuffer(input)
      ? input
      : Buffer.from(input, 'utf8');

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: '/synthetic-action',
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bytes.length,
        },
      }, res => {
        const chunks = [];
        res.on('error', reject);
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.end(bytes);
    });
  }

  return { post, writes: () => writes };
}

test('HTTP rejects non-object JSON before business writes', async t => {
  const f = await fixture(t);

  for (const input of ['null', '[]', '"text"', '123', 'false']) {
    const result = await f.post(input);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'invalid_json_body');
    assert.equal(result.body.ok, false);
  }

  assert.equal(f.writes(), 0);
});

test('HTTP malformed JSON errors omit submitted private content', async t => {
  const f = await fixture(t);
  const result = await f.post('{"token":"synthetic-private-token"');

  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'invalid_json_body');
  assert.equal(
    JSON.stringify(result.body).includes('synthetic-private-token'),
    false,
  );
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(f.writes(), 0);
});

test('HTTP rejects invalid UTF-8 before business writes', async t => {
  const f = await fixture(t);
  const bytes = Buffer.concat([
    Buffer.from('{"name":"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}'),
  ]);

  const result = await f.post(bytes);

  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'invalid_json_body');
  assert.equal(f.writes(), 0);
});

test('normal requests still succeed after rejected requests', async t => {
  const f = await fixture(t);

  assert.equal((await f.post('null')).status, 400);
  assert.equal((await f.post('{')).status, 400);

  const result = await f.post('{"name":"合成测试","quantity":2}');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.received, {
    name: '合成测试',
    quantity: 2,
  });
  assert.equal(f.writes(), 1);
});