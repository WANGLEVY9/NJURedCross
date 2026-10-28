import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReimbursementBoxDirectory } from '../lib/reimbursements/box-directory.js';
import { createReimbursementBox } from '../lib/reimbursements/box-storage.js';
import { reimbursementConfiguration } from '../lib/reimbursements/config.js';
import { checksum } from '../lib/reimbursements/material-codec.js';

function fixture(options = {}) {
  const entries = [{ name: '其他板块', type: 'dir' }, ...(options.entries || [])], calls = [];
  const config = { token: 'synthetic-box-token', repoId: 'synthetic-repository', server: 'https://synthetic.box.invalid',
    fetch: async (url, init = {}) => {
      const parsed = new URL(url), method = init.method || 'GET'; calls.push({ url: parsed, method });
      assert.equal(parsed.origin, 'https://synthetic.box.invalid');
      if (parsed.pathname.endsWith('/repo-info/')) return Response.json({ repo_id: options.wrongRepo ? 'other-repository' : config.repoId, repo_name: '合成库' });
      if (method === 'POST') {
        assert.equal(parsed.searchParams.get('path'), '/报销材料');
        assert.equal(init.body, 'operation=mkdir');
        if (!options.rejectCreate) entries.push({ name: '报销材料', type: 'dir' });
        if (options.lostAcknowledgement || options.rejectCreate) throw new Error('synthetic connection lost');
        return Response.json({ success: true });
      }
      assert.equal(parsed.pathname.endsWith('/dir/'), true);
      assert.equal(parsed.searchParams.get('path'), '/');
      return Response.json(options.malformed ? { unexpected: [] } : { dirent_list: entries });
    } };
  return { config, entries, calls };
}

test('Box setup previews only, then creates only the requested directory and skips duplicate mkdir', async () => {
  const f = fixture();
  assert.equal((await prepareReimbursementBoxDirectory(f.config)).outcome, 'missing');
  assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  const created = await prepareReimbursementBoxDirectory(f.config, { apply: true });
  assert.equal(created.outcome, 'created-or-confirmed'); assert.equal(created.otherRootEntriesUnchanged, true);
  assert.equal((await prepareReimbursementBoxDirectory(f.config, { apply: true })).outcome, 'existing');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.deepEqual(f.entries.map(entry => entry.name), ['其他板块', '报销材料']);
});

test('wrong repository, malformed directory and same-named files never trigger writes', async () => {
  for (const options of [{ wrongRepo: true }, { malformed: true }, { entries: [{ name: '报销材料', type: 'file' }] }]) {
    const f = fixture(options); await assert.rejects(prepareReimbursementBoxDirectory(f.config, { apply: true }));
    assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  }
  const f = fixture();
  await assert.rejects(prepareReimbursementBoxDirectory({ ...f.config, directory: '/其他板块' }, { apply: true }));
  await assert.rejects(prepareReimbursementBoxDirectory({ ...f.config, repoId: '' }, { apply: true }));
  assert.equal(f.calls.length, 0);
});

test('lost mkdir acknowledgement is reconciled by reads without repeating POST', async () => {
  const f = fixture({ lostAcknowledgement: true });
  assert.equal((await prepareReimbursementBoxDirectory(f.config, { apply: true })).outcome, 'created-or-confirmed');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  const failed = fixture({ rejectCreate: true });
  await assert.rejects(prepareReimbursementBoxDirectory(failed.config, { apply: true }), { code: 'reimbursement_box_directory_not_confirmed' });
  assert.equal(failed.calls.filter(call => call.method === 'POST').length, 1);
});

test('configured finance storage rejects a different Box repository before file access', async () => {
  const f = fixture({ wrongRepo: true }), bytes = Buffer.from('synthetic'), sha256 = checksum(bytes);
  const storage = createReimbursementBox(f.config);
  await assert.rejects(storage.put({ sha256, bytes }), { code: 'reimbursement_box_repository_mismatch' });
  await assert.rejects(storage.read({ sha256, size: bytes.length, path: `/报销材料/对象/${sha256.slice(0, 2)}/${sha256}.bin` }),
    { code: 'reimbursement_box_repository_mismatch' });
  assert.equal(f.calls.every(call => call.method === 'GET' && call.url.pathname.endsWith('/repo-info/')), true);
});

test('finance uploads stay under the reimbursement folder and verify the bound repository once per instance', async () => {
  const calls = [], bytes = Buffer.from('synthetic'), sha256 = checksum(bytes), dir = `/报销材料/对象/${sha256.slice(0, 2)}`;
  const config = { token: 'synthetic-box-token', repoId: 'synthetic-repository', server: 'https://synthetic.box.invalid',
    fetch: async (url, init = {}) => {
      const parsed = new URL(url); calls.push({ url: parsed, method: init.method || 'GET' });
      if (parsed.pathname.endsWith('/repo-info/')) return Response.json({ repo_id: config.repoId });
      if (parsed.pathname.endsWith('/dir/')) {
        assert.equal(init.method, 'GET');
        const path = parsed.searchParams.get('path');
        const name = path === '/' ? '报销材料' : path === '/报销材料' ? '对象' : sha256.slice(0, 2);
        return Response.json({ dirent_list: [{ name, type: 'dir' }] });
      }
      if (parsed.pathname.endsWith('/upload-link/')) {
        assert.equal(parsed.searchParams.get('path'), dir);
        return Response.json('https://synthetic.box.invalid/upload');
      }
      if (parsed.pathname.endsWith('/download-link/')) return Response.json('https://synthetic.box.invalid/download');
      if (parsed.pathname === '/download') return new Response(bytes);
      assert.equal(parsed.pathname, '/upload'); assert.equal(init.method, 'POST');
      assert.equal(init.body.get('parent_dir'), dir);
      return Response.json('synthetic-commit');
    } };
  const storage = createReimbursementBox(config), ref = await storage.put({ bytes, sha256 });
  assert.equal(ref.path, `${dir}/${sha256}.bin`); assert.deepEqual(await storage.read(ref), bytes);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/repo-info/')).length, 1);
});

test('finance configuration uses its own credential, directory and repository binding without enabling production', () => {
  const defaults = reimbursementConfiguration({ NJUBOX_MAIN_TOKEN: 'synthetic-other-token' });
  assert.equal(defaults.box.token, ''); assert.equal(defaults.box.directory, '/报销材料');
  const config = reimbursementConfiguration({ NJUBOX_REIMBURSEMENTS_TOKEN: 'synthetic-finance-token', NJUBOX_REIMBURSEMENTS_REPO_ID: 'synthetic-repository' });
  assert.equal(config.box.token, 'synthetic-finance-token'); assert.equal(config.box.repoId, 'synthetic-repository');
  assert.equal(config.enabled, false); assert.equal(config.allowWrites, false);
});

test('foreign upload links cannot receive finance credentials and malformed listings never cause mkdir', async () => {
  const bytes = Buffer.from('synthetic'), sha256 = checksum(bytes);
  for (const malformed of [false, true]) {
    const calls = [], storage = createReimbursementBox({ token: 'synthetic-finance-token', server: 'https://synthetic.box.invalid',
      fetch: async (url, init = {}) => {
        const target = new URL(url); calls.push({ url: target, method: init.method || 'GET' });
        assert.equal(target.origin, 'https://synthetic.box.invalid'); assert.equal(init.redirect, 'error');
        if (target.pathname.endsWith('/dir/')) {
          if (malformed) return Response.json({ invalid: [] });
          const path = target.searchParams.get('path'), name = path === '/' ? '报销材料' : path === '/报销材料' ? '对象' : sha256.slice(0, 2);
          return Response.json({ dirent_list: [{ name, type: 'dir' }] });
        }
        assert.equal(target.pathname.endsWith('/upload-link/'), true);
        return Response.json('https://synthetic-other.invalid/upload');
      } });
    await assert.rejects(storage.put({ bytes, sha256 }));
    assert.equal(calls.some(call => call.method !== 'GET'), false);
    assert.equal(calls.some(call => call.url.origin !== 'https://synthetic.box.invalid'), false);
  }
  for (const directory of ['/', '/报销材料/../其他目录', '/报销材料//其他目录', '/报销材料\\其他目录', '/报销材料\n']) {
    assert.throws(() => createReimbursementBox({ directory }), { code: 'reimbursement_box_invalid_directory' });
  }
});
