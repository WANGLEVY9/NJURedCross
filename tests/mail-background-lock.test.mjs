import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('mail background jobs never hold the foreground shared write lock', () => {
  assert.match(source, /const withMailBackgroundLock = await createWriteCoordinator\(/);
  assert.match(source, /withMailBackgroundLock\(\(\) => reimbursementNotifier\.deliver\(\)\)/);
  assert.match(source, /withMailBackgroundLock\(async \(\) => \{\s*const records = await repairMailRecords/);
  assert.doesNotMatch(source, /withSharedWriteLock\(\(\) => reimbursementNotifier\.deliver\(\)\)/);
});

test('decision mail snapshots are shared only inside a short single-flight window', () => {
  assert.match(source, /stamp-decisionReadAt<300/);
  assert.match(source, /const decisionMail=createDecisionMail\(\{read:decisionSnapshot/);
});
