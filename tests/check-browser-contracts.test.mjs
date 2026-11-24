import assert from 'node:assert/strict';
import test from 'node:test';
import { EXEMPT, inspectBrowserSpecs, inspectSpec } from '../scripts/check-browser-contracts.mjs';

test('rejects a page viewport assertion near an internal scroll container', () => {
  const source = [
    "const table = page.locator('.activity-final-hours-table');",
    'await table.evaluate(node => { node.scrollTop = node.scrollHeight; });',
    "await expect(page.locator('.activity-final-hours-table tr').last()).toBeInViewport();",
  ].join('\n');
  assert.deepEqual(inspectSpec('sample.spec.mjs', source), [
    'tests/browser/sample.spec.mjs:3 - internal scroll container assertion must use container geometry, not page toBeInViewport',
  ]);
});

test('accepts container geometry and documented exemptions', () => {
  const geometry = [
    "const table = page.locator('.activity-final-hours-table');",
    'const reach = await table.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight);',
    'expect(reach).toBe(true);',
  ].join('\n');
  const exempt = [
    "const body = page.locator('.modal__body');",
    `// ${EXEMPT}: page-level visibility is intentional`,
    'await expect(body).toBeInViewport();',
  ].join('\n');
  assert.deepEqual(inspectSpec('geometry.spec.mjs', geometry), []);
  assert.deepEqual(inspectSpec('exempt.spec.mjs', exempt), []);
});

test('scans the real browser spec directory without findings', () => {
  const { files, findings } = inspectBrowserSpecs();
  assert.ok(files.length > 0);
  assert.deepEqual(findings, []);
});
