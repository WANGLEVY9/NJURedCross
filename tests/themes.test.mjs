import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, resolveTheme, applyTheme, selectTheme, setThemeMotion } from '../public/app/core/themes.js';

function contrast(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return 1.05 / (luminance + .05);
}
test('each surface has five unique themes with readable white action text', () => {
  for (const surface of ['portal', 'console']) {
    assert.equal(THEMES[surface].length, 5);
    assert.equal(new Set(THEMES[surface].map(theme => theme.id)).size, 5);
    for (const theme of THEMES[surface]) assert.ok(contrast(theme.color) >= 4.5, theme.name);
    assert.equal(resolveTheme(surface, 'corrupt').id, THEMES[surface][0].id);
  }
});
test('portal and console preferences and motion settings remain independent', () => {
  const saved = new Map(); globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const documentRoot = { dataset: {} }; globalThis.document = { documentElement: documentRoot, querySelector: () => null, getAnimations: () => [] };
  selectTheme('portal', 'sail'); selectTheme('console', 'botanic');
  assert.equal(applyTheme('portal').id, 'sail'); assert.equal(documentRoot.dataset.theme, 'sail');
  assert.equal(applyTheme('console').id, 'botanic');
  setThemeMotion('console', false); assert.equal(documentRoot.dataset.motion, 'reduced');
  applyTheme('portal'); assert.equal(documentRoot.dataset.motion, 'full');
  const prefs = JSON.parse(saved.get('nju-rc.preferences.v1'));
  assert.equal(prefs['theme.portal'], 'sail'); assert.equal(prefs['theme.console'], 'botanic');
});
test('theme preview works even when browser storage is unavailable', () => {
  globalThis.localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  selectTheme('portal', 'iris'); assert.equal(globalThis.document.documentElement.dataset.theme, 'iris');
  applyTheme('console'); assert.equal(globalThis.document.documentElement.dataset.theme, 'botanic');
});
