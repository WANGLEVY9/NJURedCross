import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');

test('portal writes use the three-argument CSRF guard and abort on rejection', () => {
  assert.doesNotMatch(source, /requireCsrf\(req,\s*session\)/,
    'CSRF guard needs req, res and session; ignoring its result leaves writes unprotected');
});

test('request middleware, probes and bounded admission are wired at the HTTP entry', () => {
  assert.match(source, /createRequestMiddleware\(\{/);
  assert.match(source, /createRequestConcurrencyGate\(\{/);
  assert.match(source, /http\.createServer\(\(req, res\) => observer\.http\(req, res, \(\) => requestMiddleware\(req, res\)\)\)/);
  assert.match(source, /readinessChecks:/);
  assert.match(source, /metricsAccess[,:\s]/);
  assert.match(source, /bodyLimitFor:/);
  assert.match(source, /loopbackAddresses\.has\(forwarded\)/,
    'metrics must distinguish a local reverse proxy from a public visitor');
});
