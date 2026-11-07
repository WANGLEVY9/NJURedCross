import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = (await readFile(new URL('../public/app/console/shell.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const main = (await readFile(new URL('../public/app/main.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('leaving the console for the portal always performs a full document navigation', () => {
  assert.doesNotMatch(shell, /navigate\('\/'\)/, 'console must not switch surfaces inside the SPA');
  assert.match(shell, /location\.assign\('\/'\)/);
  assert.match(main, /onRetry: \(\) => location\.assign\('\/'\)/);
});
