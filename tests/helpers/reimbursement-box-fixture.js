import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { checksum } from '../../lib/reimbursements/material-codec.js';
import { createReimbursementBox } from '../../lib/reimbursements/box-storage.js';
import { storageFailure } from '../../lib/reimbursements/material-codec.js';
const { Response } = globalThis;

/** Real finance Box adapter; only the Seafile HTTP transport is synthetic. */
export function reimbursementBoxFixture({ objects = new Map(), state = {} } = {}) {
  const origin = 'https://synthetic.box.invalid', directory = '/报销材料', calls = [], directories = new Set(['/', directory]);
  const config = { server: origin, token: 'synthetic-finance-box-token', repoId: 'synthetic-finance-repository', directory,
    fetch: async (url, init = {}) => {
      const target = new URL(url), method = init.method || 'GET';
      assert.equal(target.origin, origin); assert.equal(init.redirect, 'error');
      assert.ok(['GET', 'POST'].includes(method));
      const path = target.searchParams.get('path');
      calls.push({ method, endpoint: target.pathname, path });
      if (target.pathname.endsWith('/repo-info/')) {
        assert.equal(init.headers.Authorization, `Bearer ${config.token}`);
        return Response.json({ repo_id: config.repoId, repo_name: '合成平台文件存储' });
      }
      if (target.pathname.startsWith('/api/')) assert.equal(init.headers.Authorization, `Bearer ${config.token}`);
      if (target.pathname.endsWith('/dir/')) {
        assert.ok(path === '/' || path === directory || path.startsWith(`${directory}/`));
        if (method === 'POST') {
          assert.equal(init.body, 'operation=mkdir');
          const parent = path.slice(0, path.lastIndexOf('/')) || '/'; assert.ok(directories.has(parent));
          directories.add(directories.has(path) ? `${path} (1)` : path);
          return Response.json({ success: true });
        }
        if (!directories.has(path)) return Response.json({ error: 'not found' }, { status: 404 });
        const prefix = path === '/' ? '/' : `${path}/`;
        return Response.json({ dirent_list: [...directories].filter(dir => dir.startsWith(prefix) && dir !== path
          && !dir.slice(prefix.length).includes('/')).map(dir => ({ name: dir.slice(prefix.length), type: 'dir' })) });
      }
      if (target.pathname.endsWith('/upload-link/')) {
        assert.ok(directories.has(path)); assert.ok(path.startsWith(`${directory}/对象/`));
        return Response.json(`${origin}/seafhttp/upload-api/synthetic?parent=${encodeURIComponent(path)}`);
      }
      if (target.pathname === '/seafhttp/upload-api/synthetic') {
        assert.equal(method, 'POST'); assert.equal(init.headers.Authorization, `Bearer ${config.token}`);
        if (state.failFiles) return new Response('synthetic upload failure', { status: 503 });
        const parent = target.searchParams.get('parent'), file = init.body.get('file');
        assert.equal(init.body.get('parent_dir'), parent); assert.equal(init.body.get('replace'), '1');
        const bytes = Buffer.from(await file.arrayBuffer()), sha256 = checksum(bytes);
        assert.equal(file.name, `${sha256}.bin`); assert.equal(parent, `${directory}/对象/${sha256.slice(0, 2)}`);
        objects.set(sha256, bytes);
        if (state.loseUploadAcknowledgement) { state.loseUploadAcknowledgement = false; throw new Error('synthetic upload response lost'); }
        return Response.json('synthetic-commit');
      }
      if (target.pathname.endsWith('/download-link/')) {
        assert.match(path, /^\/报销材料\/对象\/[a-f0-9]{2}\/[a-f0-9]{64}\.bin$/);
        return Response.json(`${origin}/seafhttp/files/synthetic?path=${encodeURIComponent(path)}`);
      }
      assert.equal(target.pathname, '/seafhttp/files/synthetic');
      assert.equal(method, 'GET'); state.reads = (state.reads || 0) + 1;
      const sha256 = path.split('/').at(-1).slice(0, -4);
      return new Response(objects.get(sha256) || 'corrupt');
    } };
  const makeFiles = () => {
    const adapter = createReimbursementBox(config);
    return { ...adapter, assertConfigured() {
      if (state.boxReady === false) throw storageFailure('reimbursement_box_not_configured');
      adapter.assertConfigured();
    } };
  };
  return { config, calls, objects, directories, makeFiles };
}
