import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const config = await readFile(new URL('../ops/nginx/njuredcross-site.conf', import.meta.url), 'utf8');

test('HTTPS site config enables HSTS with includeSubDomains on every response', () => {
  assert.match(config, /add_header\s+Strict-Transport-Security\s+"max-age=31536000;\s*includeSubDomains"\s+always;/);
  assert.doesNotMatch(config, /add_header\s+Strict-Transport-Security[^;]*max-age=(?:0|60|300)\b/);
});

test('HTTPS site config preserves host validation and proxy hardening', () => {
  assert.match(config, /server_name\s+njuredcross\.cn\s+www\.njuredcross\.cn/);
  assert.match(config, /proxy_set_header\s+X-Real-IP\s+\$remote_addr;/);
  assert.match(config, /proxy_read_timeout\s+180s;/);
});
