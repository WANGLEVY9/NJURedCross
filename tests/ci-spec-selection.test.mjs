import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/ci-select-specs.mjs', import.meta.url));

function select(files) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [script], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.split('\n').map(line => line.trim()).filter(Boolean));
    });
    child.stdin.end(files.join('\n'));
  });
}

test('materials changes select the materials specs only', async () => {
  const specs = await select(['public/app/portal/pages/materials-borrow.js', 'lib/materials/production-workflow.js']);
  assert.ok(specs.length > 0);
  assert.ok(specs.every(spec => /tests\/browser\/(materials|reimbursement)/.test(spec)), specs.join(' '));
});

test('activity workflow changes select activity, workflow and events specs', async () => {
  const specs = await select(['lib/events/workflow.js', 'public/app/console/pages/activity-workspace-page.js']);
  assert.ok(specs.length > 0);
  assert.ok(specs.every(spec => /tests\/browser\/(activity|workflow|events|ordinary)/.test(spec)), specs.join(' '));
});

test('shared layers fall back to the full suite', async () => {
  for (const file of ['server.js', 'public/app/core/api.js', 'public/styles/tokens.css', 'public/index.html']) {
    assert.deepEqual(await select([file]), [], `expected full suite for ${file}`);
  }
});

test('unmapped or oversized changes fall back to the full suite', async () => {
  assert.deepEqual(await select(['docs/OPERATIONS.md']), []);
  assert.deepEqual(await select(Array.from({ length: 60 }, (_, i) => `public/app/portal/pages/materials-${i}.js`)), []);
});
