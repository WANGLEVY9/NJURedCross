import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('light fields are decorative, bounded, and respect motion preferences', async () => {
  const [component, css] = await Promise.all([
    read('../public/app/ui/light-field.js'),
    read('../public/styles/light-field.css'),
  ]);
  assert.match(component, /aria: \{ hidden: 'true' \}/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none/);
  assert.match(css, /contain: layout paint style/);
  assert.match(css, /@media \(forced-colors: active\)/);
});

test('shared refresh sheets are critical and card refresh keeps one radius system', async () => {
  const [html, assets, cards, lockup] = await Promise.all([
    read('../public/index.html'),
    read('../lib/http/web-assets.js'),
    read('../public/styles/refresh-cards.css'),
    read('../public/styles/brand-lockup.css'),
  ]);
  assert.match(html, /href="\/styles\/light-field\.css"[^>]*data-deferred-style/);
  assert.match(html, /href="\/styles\/refresh-cards\.css"[^>]*data-deferred-style/);
  assert.match(assets, /'\/styles\/brand-lockup\.css', '\/styles\/light-field\.css'/);
  assert.match(cards, /border-radius: 14px/);
  assert.match(cards, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(lockup, /font-weight: 650/);
  assert.doesNotMatch(lockup, /letter-spacing: 0\.18em/);
});
