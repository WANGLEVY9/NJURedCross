import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const hero = (await readFile(new URL('../public/app/portal/member-hero.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const workflowApi = (await readFile(new URL('../lib/events/workflow-api.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('client cancellation is never mistaken for a missing SQL capability', () => {
  assert.match(source, /const transientReadFailure = error =>/);
  assert.match(source, /'external_request_cancelled', 'external_request_timeout', 'AbortError', 'TimeoutError'/);
  // 取消不计入能力失败，而是落到整表索引兜底，仍能拿到真实值。
  assert.match(source, /if \(!transientReadFailure\(error\)\) \{/);
});

test('falling back to the full index is time-boxed, not permanent', () => {
  assert.match(source, /const VOLUNTEER_SCOPED_RETRY_MS =/);
  assert.match(source, /Date\.now\(\) - volunteerPlatformScopedDisabledAt >= VOLUNTEER_SCOPED_RETRY_MS/);
  assert.match(source, /volunteerPlatformScopedDisabledAt = Date\.now\(\);/);
});

test('the dedicated hours endpoint keeps identity data when the upstream fails', () => {
  assert.match(workflowApi, /url\.pathname==='\/api\/portal\/workflow\/hours'/);
  assert.match(workflowApi, /hoursUnavailable=true/);
  assert.match(workflowApi, /platformHours,hoursUnavailable/);
});

test('the overview /me route also isolates hours failures instead of returning 500', () => {
  assert.match(workflowApi, /let platformHours=null,hoursUnavailable=false;/);
  assert.match(workflowApi, /\[portal\/workflow\/me\] hours read unavailable/);
});

test('a failed hours read is reported with a retry instead of rendering a dash', () => {
  assert.doesNotMatch(hero, /\}\)\.catch\(\(\) => \{\}\);/, 'the hero must not swallow read failures');
  assert.match(hero, /mc-dashboard--failed/);
  assert.match(hero, /时长暂时无法读取，数据未丢失。/);
  assert.match(hero, /function showFailure\(\)/);
});

test('retrying hours always bypasses the in-flight read cache', () => {
  assert.match(hero, /const load = \(fresh = false\)/);
  assert.match(hero, /\?fresh=\$\{Date\.now\(\)\}/);
  assert.match(hero, /void load\(true\)/);
  assert.match(hero, /if \(data\.hoursUnavailable\) \{ showFailure\(\); return; \}/);
});
