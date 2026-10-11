import test from 'node:test';
import assert from 'node:assert/strict';
import { runProbe } from './njubox-api-example/client.mjs';

const repoId = '11111111-1111-4111-8111-111111111111';
const config = { serverUrl: 'https://box.example.test', token: 'synthetic-test-token', repoId };
function fixture(options = {}) {
  let directory, content, downloads = 0;
  const calls = [], events = [];
  const json = value => new Response(JSON.stringify(value), { status: 200 });
  const original = { name: 'existing-material', id: 'untouched', type: 'dir' };
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || 'GET';
    calls.push({ path: url.pathname, method, auth: init.headers?.Authorization });
    if (url.pathname === '/upload') {
      assert.equal(init.headers?.Authorization, undefined);
      content = await init.body.get('file').text();
      return json({ success: true });
    }
    if (url.pathname === '/download') return new Response(options.corrupt ? 'corrupt' : content);
    assert.equal(init.headers.Authorization, 'Bearer ' + config.token);
    const endpoint = url.pathname.split('/').filter(Boolean).at(-1);
    const path = url.searchParams.get('path');
    if (endpoint === 'repo-info') return json({ repo_id: options.mismatch ? 'wrong' : repoId });
    if (endpoint === 'upload-link') return json(options.external ? 'https://untrusted.test/upload' : 'https://box.example.test/upload');
    if (endpoint === 'download-link') { downloads++; return json('https://box.example.test/download'); }
    if (endpoint === 'dir' && method === 'POST') {
      assert.equal(init.body.get('operation'), 'mkdir');
      directory = path;
      return json({ success: true });
    }
    if (endpoint === 'file' && method === 'DELETE') {
      assert.equal(path, directory + '/probe.txt');
      content = undefined;
      return json({ success: true });
    }
    if (endpoint === 'dir' && method === 'DELETE') {
      assert.equal(path, directory);
      assert.equal(content, undefined);
      directory = undefined;
      return json({ success: true });
    }
    if (endpoint === 'dir' && method === 'GET') {
      if (path === '/') return json({ user_perm: options.readOnly ? 'r' : 'rw',
        dirent_list: directory ? [original, { name: directory.slice(1), id: 'test', type: 'dir' }] : [original] });
      assert.equal(path, directory);
      const list = content === undefined ? [] : [{ name: 'probe.txt', type: 'file' }];
      if (options.unexpected) list.push({ name: 'someone-elses-file', type: 'file' });
      return json({ dirent_list: list });
    }
    throw Error('Unexpected request');
  };
  return { fetchImpl, log: event => events.push(event), calls, events,
    state: () => ({ directory, content, downloads }) };
}
test('default probe is read-only and logs no credentials or existing names', async () => {
  const mock = fixture();
  const result = await runProbe(config, mock);
  assert.equal(result.write, false);
  assert.equal(mock.calls.length, 2);
  assert.ok(mock.calls.every(call => call.method === 'GET'));
  assert.ok(!JSON.stringify(mock.events).includes(config.token));
  assert.ok(!JSON.stringify(mock.events).includes('existing-material'));
});
test('CRUD validates both contents and removes only its own files', async () => {
  const mock = fixture();
  const result = await runProbe(config, { ...mock, write: true });
  assert.equal(result.crudVerified, true);
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.originalRootEntriesUnchanged, true);
  assert.deepEqual(mock.state(), { directory: undefined, content: undefined, downloads: 2 });
});
test('UUID mismatch blocks all writes', async () => {
  const mock = fixture({ mismatch: true });
  await assert.rejects(runProbe(config, { ...mock, write: true }), /UUID mismatch/);
  assert.ok(mock.calls.every(call => call.method === 'GET'));
});
test('read-only permission blocks writes', async () => {
  const mock = fixture({ readOnly: true });
  await assert.rejects(runProbe(config, { ...mock, write: true }), /Read-write/);
  assert.ok(mock.calls.every(call => call.method === 'GET'));
});
test('content mismatch triggers cleanup and failure', async () => {
  const mock = fixture({ corrupt: true });
  await assert.rejects(runProbe(config, { ...mock, write: true }), /does not match/);
  assert.equal(mock.state().directory, undefined);
  assert.equal(mock.state().content, undefined);
});
test('unexpected entries prevent recursive deletion', async () => {
  const mock = fixture({ unexpected: true });
  await assert.rejects(runProbe(config, { ...mock, write: true }), /Cleanup/);
  assert.ok(!mock.calls.some(call => call.method === 'DELETE'));
  assert.ok(mock.events.some(event => event.operation === 'cleanup incomplete'));
});
test('external upload URL is rejected without transmitting data', async () => {
  const mock = fixture({ external: true });
  await assert.rejects(runProbe(config, { ...mock, write: true }), /origin/);
  assert.ok(!mock.calls.some(call => call.path === '/upload'));
  assert.equal(mock.state().directory, undefined);
});
test('invalid configuration performs no requests', async () => {
  const mock = fixture();
  await assert.rejects(runProbe({ ...config, token: '' }, mock), /Missing/);
  await assert.rejects(runProbe({ ...config, serverUrl: 'http://box.example.test' }, mock), /HTTPS/);
  await assert.rejects(runProbe({ ...config, repoId: 'wrong' }, mock), /UUID/);
  assert.equal(mock.calls.length, 0);
});
