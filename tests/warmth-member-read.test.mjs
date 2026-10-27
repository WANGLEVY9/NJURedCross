import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('warmth-only member read skips unrelated tables and exposes only owned enrollment fields', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const extract = input => {
    const normalized = input.replace(/\r\n/g, '\n');
    const start = normalized.indexOf('async function portalRoutes(');
    const end = normalized.indexOf('/**\n * Wiring for the two development workstreams');
    assert.ok(start >= 0 && end > start, 'portal route extraction boundaries must exist');
    return normalized.slice(start, end);
  };
  const block = extract(source);
  assert.equal(extract(source.replace(/\r?\n/g, '\r\n')), block);
  let baseReads = 0, enrollmentReads = 0, signedIn = true;
  const context = vm.createContext({
    requirePortalSession: () => signedIn ? { username: 'synthetic-own' } : null,
    getBase: async () => { baseReads++; return {}; },
    readWarmthInterests: async () => { enrollmentReads++; return [
      { id: 'own', participantRef: 'synthetic-own', program: 'birthday', status: '已确认', privateNote: 'must-not-escape' },
      { id: 'other', participantRef: 'synthetic-other', program: 'birthday', status: '已确认' },
    ]; },
    ownsBusinessRef: (session, ref) => session.username === ref,
    byDateDesc: () => () => 0,
    safeRows: () => { throw Error('unrelated table read'); },
    readPublicSubmissions: () => { throw Error('unrelated submissions read'); },
    json: (_res, status, body) => ({ status, body }),
  });
  vm.runInContext(block + ';globalThis.read=portalRoutes;', context);
  const result = await context.read({ method: 'GET' }, {}, new URL('http://test/api/portal/me?view=warmth'));
  assert.equal(result.status, 200);
  assert.equal(result.body.enrollments.length, 1);
  assert.equal(result.body.enrollments[0].id, 'own');
  assert.equal(JSON.stringify(result).includes('must-not-escape'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-other'), false);
  assert.equal(enrollmentReads, 1);
  signedIn = false;
  assert.equal(await context.read({ method: 'GET' }, {}, new URL('http://test/api/portal/me?view=warmth')), undefined);
  assert.equal(baseReads, 1);
});
