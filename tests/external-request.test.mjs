import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { runExternalRequest } from '../lib/http/external-request.js';
import { uploadSeaTableImageRequest } from '../lib/http/seatable-image.js';

import {
  probeServer,
  listLibraries,
  getUploadLink,
  getFileLink,
  createShareLink,
  uploadFileBuffer,
} from '../lib/events/njubox.js';

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });

  return `http://127.0.0.1:${server.address().port}`;
}

test('successful requests include response body consumption', async t => {
  const url = await fixture(t, (_req, res) => res.end('synthetic'));
  const result = await runExternalRequest(async signal => {
    const res = await fetch(url, { signal });
    return res.text();
  }, { timeoutMs: 2000 });

  assert.equal(result, 'synthetic');
});

test('deadline aborts a request that never returns headers', async t => {
  const received = Promise.withResolvers();
  const disconnected = Promise.withResolvers();
  const url = await fixture(t, (_req, res) => {
    res.on('close', () => disconnected.resolve());
    received.resolve();
  });

  const controller = new AbortController();
  const operation = runExternalRequest(async signal => {
    const res = await fetch(url, { signal });
    return res.text();
  }, { timeoutMs: 1000, signal: controller.signal });

  const rejection = assert.rejects(
    operation,
    error => error.code === 'external_request_timeout'
      && error.statusCode === 503,
  );

  await received.promise;
  await rejection;
  await disconnected.promise;
});

test('deadline also aborts an unfinished response body', async t => {
  const disconnected = Promise.withResolvers();
  const url = await fixture(t, (_req, res) => {
    res.on('close', () => disconnected.resolve());
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('unfinished');
  });

  await assert.rejects(
    runExternalRequest(async signal => {
      const res = await fetch(url, { signal });
      return res.text();
    }, { timeoutMs: 1000 }),
    error => error.code === 'external_request_timeout',
  );

  await disconnected.promise;
});

test('caller cancellation aborts an active HTTP request', async t => {
  const received = Promise.withResolvers();
  const disconnected = Promise.withResolvers();
  const url = await fixture(t, (_req, res) => {
    res.on('close', () => disconnected.resolve());
    received.resolve();
  });

  const controller = new AbortController();
  const operation = runExternalRequest(async signal => {
    const res = await fetch(url, { signal });
    return res.text();
  }, { timeoutMs: 5000, signal: controller.signal });

  const rejection = assert.rejects(
    operation,
    error => error.code === 'external_request_cancelled',
  );

  await received.promise;
  controller.abort();
  await rejection;
  await disconnected.promise;
});

test('already cancelled requests never start the operation', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    runExternalRequest(async () => {
      calls++;
    }, { signal: controller.signal }),
    error => error.code === 'external_request_cancelled',
  );

  assert.equal(calls, 0);
});

test('transport failures do not expose raw error details', async () => {
  await assert.rejects(
    runExternalRequest(async () => {
      throw new Error('synthetic-private-token');
    }),
    error => error.code === 'external_request_failed'
      && !error.message.includes('synthetic-private-token'),
  );
});

test('invalid deadlines are rejected before starting', async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(
      runExternalRequest(async () => {}, { timeoutMs }),
      TypeError,
    );
  }
});
test('NJUBox probe reads ping and server info without credentials', async t => {
  const paths = [];
  const url = await fixture(t, (req, res) => {
    paths.push(req.url);
    assert.equal(req.headers.authorization, undefined);

    if (req.url === '/api2/ping/') {
      return res.end('"pong"');
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ version: 'synthetic' }));
  });

  const result = await probeServer({
    njuboxServerUrl: url,
    externalRequestTimeoutMs: 2000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ping, 'pong');
  assert.deepEqual(result.serverInfo, { version: 'synthetic' });
  assert.deepEqual(paths, ['/api2/ping/', '/api2/server-info/']);
});

test('NJUBox probe stops after the shared deadline', async t => {
  const paths = [];
  const disconnected = Promise.withResolvers();
  const url = await fixture(t, (req, res) => {
    paths.push(req.url);
    res.on('close', () => disconnected.resolve());
    // Deliberately leave the first response unfinished.
    res.writeHead(200);
    res.write('"unfinished');
  });

  const result = await probeServer({
    njuboxServerUrl: url,
    externalRequestTimeoutMs: 1000,
  });

  assert.equal(result.errorCode, 'external_request_timeout');
  assert.equal(result.ok, false);
  assert.deepEqual(paths, ['/api2/ping/']);
  await disconnected.promise;
});

test('NJUBox probe honours cancellation before sending requests', async t => {
  let requests = 0;
  const url = await fixture(t, (_req, res) => {
    requests++;
    res.end('"pong"');
  });
  const controller = new AbortController();
  controller.abort();

  const result = await probeServer({
    njuboxServerUrl: url,
    signal: controller.signal,
  });

  assert.equal(result.errorCode, 'external_request_cancelled');
  assert.equal(result.ok, false);
  assert.equal(requests, 0);
});
test('NJUBox authenticated endpoints preserve headers and results', async t => {
  const requests = [];
  const url = await fixture(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({
      url: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body,
    });

    if (req.url === '/api2/repos/') {
      return res.end(JSON.stringify([{ id: 'synthetic-repo' }]));
    }
    if (req.url.includes('/upload-link/')) {
      return res.end('"https://upload.example.test/"');
    }
    if (req.url.includes('/file/')) {
      return res.end('"https://download.example.test/"');
    }
    return res.end(JSON.stringify({
      link: 'https://share.example.test/',
    }));
  });

  const config = {
    njuboxServerUrl: url,
    njuboxToken: 'synthetic-token',
    njuboxRepoId: 'synthetic-repo',
    externalRequestTimeoutMs: 2000,
  };

  assert.deepEqual(await listLibraries(config), [{ id: 'synthetic-repo' }]);
  assert.equal(
    await getUploadLink(config, '', '/folder'),
    'https://upload.example.test/',
  );
  assert.equal(
    await getFileLink(config, '', '/folder/file.txt'),
    'https://download.example.test/',
  );
  assert.equal(
    await createShareLink(config, '', '/folder/file.txt'),
    'https://share.example.test/',
  );

  assert.equal(requests.length, 4);
  assert.ok(requests.every(req =>
    req.authorization === 'Token synthetic-token',
  ));
  assert.equal(requests[3].method, 'POST');
  assert.equal(
    new URLSearchParams(requests[3].body).get('path'),
    '/folder/file.txt',
  );
});

test('NJUBox upload sends multipart data and reads its result', async t => {
  let endpoint;
  let uploads = 0;
  const url = await fixture(t, async (req, res) => {
    assert.equal(req.headers.authorization, 'Token synthetic-token');

    if (req.url.includes('/upload-link/')) {
      return res.end(JSON.stringify(`${endpoint}/upload`));
    }

    uploads++;
    assert.equal(req.method, 'POST');
    assert.match(req.headers['content-type'], /^multipart\/form-data;/);
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.match(body, /synthetic-file\.txt/);
    assert.match(body, /synthetic-content/);
    res.end('synthetic-upload-result');
  });
  endpoint = url;

  const result = await uploadFileBuffer({
    njuboxServerUrl: url,
    njuboxToken: 'synthetic-token',
    njuboxRepoId: 'synthetic-repo',
    externalRequestTimeoutMs: 2000,
  }, {
    filename: 'synthetic-file.txt',
    buffer: Buffer.from('synthetic-content'),
  });

  assert.equal(result, 'synthetic-upload-result');
  assert.equal(uploads, 1);
});

test('NJUBox upload aborts an unfinished result without retrying', async t => {
  let endpoint;
  let uploads = 0;
  const disconnected = Promise.withResolvers();
  const url = await fixture(t, async (req, res) => {
    if (req.url.includes('/upload-link/')) {
      return res.end(JSON.stringify(`${endpoint}/upload`));
    }

    uploads++;
    for await (const chunk of req) {
      // Consume the upload, then deliberately leave its result unfinished.
      void chunk;
    }
    res.on('close', () => disconnected.resolve());
    res.writeHead(200);
    res.write('unfinished');
  });
  endpoint = url;

  await assert.rejects(
    uploadFileBuffer({
      njuboxServerUrl: url,
      njuboxToken: 'synthetic-token',
      njuboxRepoId: 'synthetic-repo',
      externalRequestTimeoutMs: 1000,
    }, {
      filename: 'synthetic-file.txt',
      buffer: Buffer.from('synthetic-content'),
    }),
    error => error.code === 'external_request_timeout'
      && error.statusCode === 503,
  );

  await disconnected.promise;
  assert.equal(uploads, 1);
});
test('SeaTable image upload preserves fields and returns the stored path', async t => {
  const requests = [];
  const url = await fixture(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body,
    });
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/api/v2.1/dtable/app-upload-link/') {
      return res.end(JSON.stringify({
        upload_link: '/synthetic-upload',
        parent_path: '/images',
        img_relative_path: 'photos',
        workspace_id: 1,
      }));
    }

    res.end(JSON.stringify({ name: 'stored.png' }));
  });

  const file = new File(['synthetic-image'], 'input.png', {
    type: 'image/png',
  });
  const result = await uploadSeaTableImageRequest(file, {
    serverUrl: url,
    apiToken: 'synthetic-token',
    filename: 'safe.png',
    timeoutMs: 2000,
  });

  assert.equal(result, '/workspace/1/images/photos/stored.png');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(req =>
    req.authorization === 'Bearer synthetic-token',
  ));
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].path, '/synthetic-upload?ret-json=1');
  assert.match(requests[1].body, /safe\.png/);
  assert.match(requests[1].body, /name="replace"/);
});

test('SeaTable image upload cancels a stalled result without retrying', async t => {
  let uploads = 0;
  const disconnected = Promise.withResolvers();
  const url = await fixture(t, async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/api/v2.1/dtable/app-upload-link/') {
      return res.end(JSON.stringify({
        upload_link: '/synthetic-upload',
        parent_path: '/images',
        img_relative_path: 'photos',
        workspace_id: 1,
      }));
    }

    uploads++;
    for await (const chunk of req) {
      void chunk;
    }
    res.on('close', () => disconnected.resolve());
    res.write('{"name":');
  });

  await assert.rejects(
    uploadSeaTableImageRequest(
      new File(['synthetic-image'], 'input.png', { type: 'image/png' }),
      {
        serverUrl: url,
        apiToken: 'synthetic-token',
        filename: 'safe.png',
        timeoutMs: 1000,
      },
    ),
    error => error.code === 'external_request_timeout',
  );

  await disconnected.promise;
  assert.equal(uploads, 1);
});