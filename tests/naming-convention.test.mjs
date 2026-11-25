import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async path => readFile(new URL(path, root), 'utf8');

test('renamed telemetry tools keep imports and commands consistent', async () => {
  const [analysis, correlate, inspect, performance, pkg, telemetry, scripts] = await Promise.all([
    read('scripts/telemetry-trace-analysis.mjs'),
    read('scripts/correlate-telemetry-traces.mjs'),
    read('scripts/inspect-telemetry-trace.mjs'),
    read('scripts/inspect-production-performance.sh'),
    read('package.json'),
    read('docs/TELEMETRY.md'),
    read('scripts/README.md'),
  ]);
  assert.doesNotMatch(analysis, /telemetry-trace-analysis\.js/);
  assert.match(correlate, /telemetry-trace-analysis\.mjs/);
  assert.match(inspect, /telemetry-trace-analysis\.mjs/);
  assert.match(performance, /correlate-telemetry-traces\.mjs/);
  assert.doesNotMatch(performance, /telemetry-trace-analysis\.js/);
  assert.match(pkg, /scripts\/correlate-telemetry-traces\.mjs/);
  assert.match(telemetry, /scripts\/inspect-telemetry-trace\.mjs/);
  assert.match(scripts, /scripts\/inspect-telemetry-trace\.mjs/);
  for (const source of [analysis, correlate, inspect, performance, pkg, telemetry, scripts]) {
    assert.doesNotMatch(source, /scripts\/(?:analyze-telemetry-traces|read-telemetry-trace)\./);
  }
});

test('naming guide and name gate stay discoverable', async () => {
  const [guide, contributions, development, pkg] = await Promise.all([
    read('docs/NAMING.md'),
    read('CONTRIBUTING.md'),
    read('docs/DEVELOPMENT.md'),
    read('package.json'),
  ]);
  assert.match(guide, /check:names/);
  assert.match(contributions, /docs\/NAMING\.md/);
  assert.match(development, /NAMING\.md/);
  assert.match(pkg, /"check:names"/);
});
