import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('client cancellation is never mistaken for a missing SQL capability', () => {
  assert.match(source, /const transientReadFailure = error =>/);
  assert.match(source, /'external_request_cancelled', 'external_request_timeout', 'AbortError', 'TimeoutError'/);
  // 取消必须原样抛出，不能被当成「这个人没有时长」而返回 null。
  assert.match(source, /if \(transientReadFailure\(error\)\) throw error;/);
});

test('falling back to the full index is time-boxed, not permanent', () => {
  assert.match(source, /const VOLUNTEER_SCOPED_RETRY_MS =/);
  assert.match(source, /Date\.now\(\) - volunteerPlatformScopedDisabledAt >= VOLUNTEER_SCOPED_RETRY_MS/);
  assert.match(source, /volunteerPlatformScopedDisabledAt = Date\.now\(\);/);
});

const hero = (await readFile(new URL('../public/app/portal/member-hero.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('a failed hours read is reported with a retry instead of rendering a dash', () => {
  assert.doesNotMatch(hero, /\}\)\.catch\(\(\) => \{\}\);/, 'the hero must not swallow read failures');
  assert.match(hero, /mc-dashboard--failed/);
  assert.match(hero, /时长暂时无法读取，数据未丢失。/);
  assert.match(hero, /feed\.reset = \(\) => \{ pending = undefined; \};/);
});
