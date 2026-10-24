import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const start = server.indexOf('const configuredPublicBaseUrl =');
const end = server.indexOf('const loginAttempts =', start);
assert.ok(start >= 0 && end > start);
function invitationOrigin(env, isProduction = true) {
  const context = vm.createContext({ process: { env }, isProduction, port: 3000, URL });
  return vm.runInContext(server.slice(start, end) + '\npublicBaseUrl;', context);
}

test('disabled morning invitations preserve production startup without new configuration', () => {
  assert.equal(invitationOrigin({}), 'http://localhost:3000');
  assert.equal(invitationOrigin({ WARMTH_MORNING_ENABLED: 'false' }), 'http://localhost:3000');
});

test('enabled production invitations require a configured origin and never use request Host', () => {
  assert.throws(() => invitationOrigin({ WARMTH_MORNING_ENABLED: 'true' }), /PUBLIC_BASE_URL/);
  assert.equal(invitationOrigin({ WARMTH_MORNING_ENABLED: 'true', PUBLIC_BASE_URL: 'https://example.invalid/' }), 'https://example.invalid');
  assert.equal(invitationOrigin({ WARMTH_MORNING_ENABLED: 'true' }, false), 'http://localhost:3000');
  for (const value of ['javascript:alert(1)', 'https://user:pass@example.invalid', 'https://example.invalid/?token=secret']) {
    assert.throws(() => invitationOrigin({ WARMTH_MORNING_ENABLED: 'true', PUBLIC_BASE_URL: value }), /PUBLIC_BASE_URL/);
  }
});
