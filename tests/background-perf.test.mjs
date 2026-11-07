import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('public snapshots only depend on tables the projection actually reads', () => {
  assert.match(source, /workflow: \[WF\.events, WF\.registrations, ORDINARY_GROUP_TABLE, bloodSourceTable\]/);
  assert.doesNotMatch(source, /workflow: \[\.\.\.Object\.values\(WF\)/);
});

test('the 180s operations tick reads two tables instead of the full workflow snapshot', () => {
  assert.match(source, /const data=await workflow\.publicRead\(\);/);
  assert.doesNotMatch(source, /const data=await workflow\.read\(\);\s*\n\s*if\(mailerStatus\(\)\.configured\)\{const messages=participationReminderMessages/);
});

test('friend birthday delivery honours the background idle gate', () => {
  assert.match(source, /const friendTick = async \(\) => \{\s*\n\s*if \(!backgroundGate\.allow\(\)\) return;/);
});
