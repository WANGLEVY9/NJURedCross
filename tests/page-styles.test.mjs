import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensurePageStyles } from '../public/app/core/page-styles.js';

class Link extends EventTarget {
  constructor(path) { super(); this.dataset = { pageStyle: path }; this.writes = 0; }
  setAttribute(name, value) { this[name] = value; this.writes++; }
  removeAttribute(name) { delete this[name]; }
  loaded() { this.dispatchEvent(new Event('load')); }
  failed() { this.dispatchEvent(new Event('error')); }
}
const fixture = () => {
  const links = [new Link('/styles/calendar.css'), new Link('/styles/booking.css')];
  return { links, document: { querySelectorAll: () => links } };
};

test('homepage does not start specialised stylesheet requests', async () => {
  const f = fixture(); await ensurePageStyles('/', f);
  assert.ok(f.links.every(link => link.writes === 0));
});
test('other pages wait for every stylesheet without moving their links', async () => {
  const f = fixture(); let done = false;
  const ready = ensurePageStyles('/events', f).then(() => { done = true; });
  assert.equal(f.links[0].href, '/styles/calendar.css');
  f.links[0].loaded(); await Promise.resolve(); assert.equal(done, false);
  f.links[1].loaded(); await ready; assert.equal(done, true);
});
test('overlapping navigation shares the stylesheet downloads', async () => {
  const f = fixture(); const a = ensurePageStyles('/events', f), b = ensurePageStyles('/materials', f);
  f.links.forEach(link => link.loaded()); await Promise.all([a, b]);
  assert.ok(f.links.every(link => link.writes === 1));
});
test('loaded styles remain available for later navigation', async () => {
  const f = fixture(); const a = ensurePageStyles('/events', f);
  f.links.forEach(link => link.loaded()); await a;
  await ensurePageStyles('/about', f);
  assert.ok(f.links.every(link => link.writes === 1));
});
test('failed stylesheet can be retried without restarting successful downloads', async () => {
  const f = fixture(); const a = ensurePageStyles('/events', f);
  f.links[0].loaded(); f.links[1].failed(); await assert.rejects(a, /页面样式加载失败/);
  const b = ensurePageStyles('/events', f); f.links[1].loaded(); await b;
  assert.equal(f.links[0].writes, 1); assert.equal(f.links[1].writes, 2);
});
test('a stalled stylesheet has a deadline and permits retry', async () => {
  const f = fixture(); const a = ensurePageStyles('/events', { ...f, timeoutMs: 5 });
  f.links[0].loaded(); await assert.rejects(a, /页面样式加载失败/);
  const b = ensurePageStyles('/events', f); f.links[1].loaded(); await b;
});
test('HTML retains the original order of all stylesheets', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" (?:href|data-page-style)="([^"]+)"/g)].map(m => m[1]);
  assert.equal(links.length, 21);
  assert.ok(links.indexOf('/styles/warmth.css') < links.indexOf('/styles/morning.css'));
  assert.ok(links.indexOf('/styles/calendar.css') < links.indexOf('/styles/booking.css'));
  assert.equal(links.at(-1), '/styles/material-services.css');
  assert.equal([...html.matchAll(/data-page-style=/g)].length, 5);
});
