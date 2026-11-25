import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('only browser evidence uploads tolerate infrastructure timeouts', async () => {
  const source = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const lines = source.split('\n');
  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*- uses: actions\/upload-artifact@/.test(lines[index])) continue;
    let end = index + 1;
    while (end < lines.length && end < index + 12 && !/^\s{0,6}(?:- uses:|- name:|[a-z-]+:\s*\|)/.test(lines[end])) end += 1;
    steps.push(lines.slice(index, end).join('\n'));
  }
  const tolerant = steps.filter(step => /^\s*continue-on-error:\s*true/m.test(step));
  assert.equal(tolerant.length, 1);
  assert.match(tolerant[0], /name: browser-\$\{\{ matrix\.project \}\}-\$\{\{ matrix\.shard \}\}-evidence/);
  assert.doesNotMatch(tolerant[0], /production-deployment-receipt|http-coverage-evidence/);
});
