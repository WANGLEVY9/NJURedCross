import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('background operation names remain allowlisted and payload-free', async () => {
  const source = await readFile(new URL('../lib/observability.js', import.meta.url), 'utf8');
  assert.match(source, /'skipped'/);
  assert.match(source, /'activity-read'/);
  assert.match(source, /'activity-external-write'/);

  const gate = await readFile(new URL('../lib/background/idle-gate.js', import.meta.url), 'utf8');
  assert.match(gate, /record\('skipped'\)/);
  assert.match(gate, /record\('run'\)/);
  assert.match(gate, /dependency\('background',\s*operation/);
  assert.doesNotMatch(gate, /error\.message|String\(error\)/);

  const task = await readFile(new URL('../lib/background/task.js', import.meta.url), 'utf8');
  assert.match(task, /dependency\('background',\s*'skipped'/);
  assert.match(task, /dependency\('background',\s*'run'/);
  assert.doesNotMatch(task, /onError\(error|error\.message|String\(error\)/);
});
