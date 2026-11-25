import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectFailures, commitRange, failureSummary, isInfrastructureError, renderDeploymentReceipt, renderQualitySummary, summarizeNeeds } from '../scripts/ci-quality-report.mjs';

const report = {
  suites: [{
    file: 'example.spec.mjs',
    specs: [{
      title: 'scrolls an internal table',
      line: 42,
      tests: [{ projectName: 'mobile-chromium', results: [
        { status: 'unexpected', error: { message: 'expect(locator).toBeInViewport() failed' } },
        { status: 'timedOut', error: { message: 'Timeout 30000ms exceeded' } },
        { status: 'passed', error: { message: 'ignored' } },
      ] }],
    }],
  }],
  errors: [],
};

test('collectFailures includes timed out and interrupted results', () => {
  const failures = collectFailures(report);
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map(failure => failure.message), [
    'expect(locator).toBeInViewport() failed',
    'Timeout 30000ms exceeded',
  ]);
  assert.equal(failures[0].infrastructure, false);
  assert.equal(failures[1].infrastructure, true);
});

test('collectFailures reads compact browser shard summaries', () => {
  const summary = { failures: [{ file: 'a.spec.mjs', line: 7, title: 'case', project: 'chromium', message: 'ECONNRESET', infrastructure: true }] };
  assert.deepEqual(collectFailures(summary), summary.failures);
});

test('infrastructure errors are distinguished from deterministic assertions', () => {
  assert.equal(isInfrastructureError('socket hang up'), true);
  assert.equal(isInfrastructureError('Expected 1 but received 0'), false);
});

test('quality summary names failed stages and exact failing cases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'njurc-quality-'));
  const path = join(directory, 'summary.json');
  writeFileSync(path, JSON.stringify({ failures: collectFailures(report) }));
  const summary = renderQualitySummary({ browser: { result: 'failure' }, verify: { result: 'success' }, timezones: { result: 'cancelled' } }, [path]);
  assert.match(summary, /browser/);
  assert.match(summary, /timezones/);
  assert.match(summary, /example\.spec\.mjs:42/);
  assert.match(summary, /assertion/);
  assert.match(summary, /infrastructure/);
  assert.equal(summarizeNeeds({ browser: { result: 'failure' } }).failed.length, 1);
});

test('failureSummary de-duplicates repeated failures and stays bounded', () => {
  const failures = Array.from({ length: 30 }, (_, index) => ({ file: 'a.spec.mjs', line: 1, title: `case ${index % 2}`, project: 'chromium', message: `failure ${index % 2}`, infrastructure: false }));
  assert.equal(failureSummary(failures).length, 2);
});

test('commitRange tolerates a shallow checkout and honors the injected git command', () => {
  assert.deepEqual(commitRange('', 'abc'), []);
  assert.deepEqual(commitRange('abc', 'abc'), []);
  assert.deepEqual(commitRange('abc', 'def', () => ({ status: 128, stdout: '' })), []);
  assert.deepEqual(commitRange('abc', 'def', () => ({ status: 0, stdout: '1234567 fix CI\n7654321 improve tests\n' })), ['1234567 fix CI', '7654321 improve tests']);
});

test('deployment receipt keeps its verification layers', () => {
  const summary = renderDeploymentReceipt({ deployedCommit: 'def', verifiedFiles: 1000, changedFiles: 3, removedFiles: 0, restarted: true, bridgeReady: false, publicHealth: false }, 'abc', () => ({ status: 128, stdout: '' }));
  assert.match(summary, /校验 1000 个运行文件/);
  assert.match(summary, /重启后端：是/);
  assert.match(summary, /后端就绪慢/);
  assert.match(summary, /公网健康检查未过/);
  assert.doesNotMatch(summary, /累计包含/);
});
