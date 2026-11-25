import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isSafeExternalUrl, safeExternalUrl } from '../lib/http/url-safety.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('external link validation rejects executable and credential-bearing URLs', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'https://user:secret@example.test/photo',
    '//example.test/photo',
    'https://example.test/\nX',
  ]) assert.equal(isSafeExternalUrl(value), false, value);
  assert.equal(safeExternalUrl('  https://example.test/article  '), 'https://example.test/article');
  assert.equal(safeExternalUrl(null), null);
});

test('source security inspection stays clean for the current tree', () => {
  const result = spawnSync(process.execPath, ['scripts/check-security.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
