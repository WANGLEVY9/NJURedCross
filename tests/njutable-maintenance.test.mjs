import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('NJUTable hygiene uses an explicit confirmation and a 60-day retention default', async () => {
  const source = await readFile(new URL('../scripts/njutable-maintenance.mjs', import.meta.url), 'utf8');
  assert.match(source, /const RETENTION_DAYS = 60/);
  assert.match(source, /APPLY-NJUTABLE-HYGIENE/);
  assert.match(source, /DELETE-NON-EMPTY-DEV-TABLES/);
  assert.match(source, /audit_logs_require_explicit_confirmation/);
  assert.match(source, /identity_records_require_explicit_environment_opt_in/);
  assert.match(source, /if \(!args\.apply\) \{/);
  assert.match(source, /deleteRows\(base, plan\.name, ids\)/);
});

test('hygiene service and timer enable the daily bounded cleanup', async () => {
  const [service, timer] = await Promise.all([
    readFile(new URL('../ops/systemd/njuredcross-njutable-hygiene.service', import.meta.url), 'utf8'),
    readFile(new URL('../ops/systemd/njuredcross-njutable-hygiene.timer', import.meta.url), 'utf8'),
  ]);
  assert.match(service, /--apply --confirm=APPLY-NJUTABLE-HYGIENE --include-audit/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /OnCalendar=/);
});
