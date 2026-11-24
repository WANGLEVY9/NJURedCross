import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async path => readFile(new URL(path, root), 'utf8');

test('dual-viewport UI audit covers both surfaces and records no page overflow', async () => {
  const report = JSON.parse(await read('reports/UI_COMPONENT_AUDIT_2026-11-24.json'));
  assert.equal(report.length, 20);
  assert.deepEqual([...new Set(report.map(row => row.viewport))], ['desktop', 'mobile']);
  for (const row of report) {
    assert.equal(row.horizontalOverflow, false, `${row.viewport} ${row.url}`);
    assert.equal(row.headingSkip, false, `${row.viewport} ${row.url}`);
    assert.equal(row.redesignScope, row.url.startsWith('/console/'), `${row.viewport} ${row.url}`);
    assert.ok(Array.isArray(row.runtimeErrors));
    assert.equal(row.runtimeErrors.filter(message => /TypeError|ReferenceError|SyntaxError|Unhandled/i.test(message)).length, 0,
      `${row.viewport} ${row.url}`);
  }
});

test('console shared chrome and carousel controls meet legibility and touch floors', async () => {
  const [admin, css, shared] = await Promise.all([
    read('public/styles/admin.css'),
    read('public/styles/console-ui-hardening.css'),
    read('public/styles/refinement.css'),
  ]);
  assert.match(admin, /@import '\.\/console-ui-hardening\.css';/);
  assert.match(css, /\.console \.nav__workspace-text small,[\s\S]*font-size: var\(--fs-caption\)/);
  assert.match(shared, /\.portal \.plogo__text span,[\s\S]*font-size: max\(12px, var\(--fs-caption\)\)/);
  assert.match(shared, /\.home-redesign \.home-banner__dots button,[\s\S]*width: 44px;[\s\S]*height: 44px/);
  assert.match(shared, /\.events-hero__dots button::after/);
  assert.match(shared, /@media \(max-width: 960px\) \{[\s\S]*width: 44px;[\s\S]*height: 44px/);
  assert.match(shared, /@media \(min-width: 961px\) and \(hover: hover\) and \(pointer: fine\)/);
});

test('materials preview route also opts into the shared operations baseline', async () => {
  const source = await read('public/app/console/pages/materials-preview.js');
  assert.match(source, /operations-module material-management-page console-operations-redesign/);
});

test('community compatibility route keeps semantic heading order', async () => {
  const [legacy, layout] = await Promise.all([
    read('public/app/portal/pages/warmth-legacy.js'),
    read('public/app/portal/plaza-layout.js'),
  ]);
  assert.match(legacy, /h\('h2', \{ class: 't-h3', text: program\.name \}\)/);
  assert.match(layout, /h\('h2', \{ class: 't-h3', text: `\$\{index \+ 1\}/);
});
