import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectEvidenceCleanup,
} from '../lib/events/evidence-cleanup-inspection.js';

const id = '00000000-0000-4000-8000-000000000001';

function options(changes = {}) {
  return {
    loadRegistrations: async () => [],
    loadFiles: async () => [],
    referencesComplete: true,
    nowMs: 100000,
    minAgeMs: 1000,
    ...changes,
  };
}

test('reference reads finish before directory scanning starts', async () => {
  const calls = [];
  const result = await inspectEvidenceCleanup(options({
    loadRegistrations: async () => {
      calls.push('references');
      return [];
    },
    loadFiles: async () => {
      calls.push('files');
      return [{
        name: id,
        isRegularFile: true,
        size: 100,
        mtimeMs: 95000,
        nlink: 1,
      }];
    },
  }));

  assert.deepEqual(calls, ['references', 'files']);
  assert.equal(result.reviewCandidates.length, 1);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
});

test('unconfirmed completeness stops before either reader runs', async () => {
  let calls = 0;
  await assert.rejects(inspectEvidenceCleanup(options({
    referencesComplete: false,
    loadRegistrations: async () => { calls++; return []; },
    loadFiles: async () => { calls++; return []; },
  })));
  assert.equal(calls, 0);
});

test('invalid preview policy stops before either reader runs', async () => {
  let calls = 0;
  await assert.rejects(inspectEvidenceCleanup(options({
    minAgeMs: 0,
    loadRegistrations: async () => { calls++; return []; },
    loadFiles: async () => { calls++; return []; },
  })));
  assert.equal(calls, 0);
});

test('truncated references stop before directory scanning', async () => {
  const registrations = [];
  registrations.readMeta = { truncated: true };
  let scanned = false;

  await assert.rejects(inspectEvidenceCleanup(options({
    loadRegistrations: async () => registrations,
    loadFiles: async () => { scanned = true; return []; },
  })));

  assert.equal(scanned, false);
});

test('malformed photo references stop before directory scanning', async () => {
  let scanned = false;
  await assert.rejects(inspectEvidenceCleanup(options({
    loadRegistrations: async () => [{ 签到照片ID: '../private-file' }],
    loadFiles: async () => { scanned = true; return []; },
  })));
  assert.equal(scanned, false);
});

test('failed reference reads stop before directory scanning', async () => {
  const failure = new Error('synthetic read failure');
  let scanned = false;

  await assert.rejects(inspectEvidenceCleanup(options({
    loadRegistrations: async () => { throw failure; },
    loadFiles: async () => { scanned = true; return []; },
  })), error => error === failure);

  assert.equal(scanned, false);
});

test('directory failures cannot produce an empty successful preview', async () => {
  const failure = new Error('synthetic directory failure');

  await assert.rejects(inspectEvidenceCleanup(options({
    loadFiles: async () => { throw failure; },
  })), error => error === failure);
});

test('referenced photos remain excluded from review candidates', async () => {
  const result = await inspectEvidenceCleanup(options({
    loadRegistrations: async () => [{ 签到照片ID: id }],
    loadFiles: async () => [{
      name: id,
      isRegularFile: true,
      size: 100,
      mtimeMs: 95000,
      nlink: 1,
    }],
  }));

  assert.deepEqual(result.reviewCandidates, []);
  assert.deepEqual(result.retained, [{ name: id, reason: 'referenced' }]);
});

test('invalid readers are rejected', async () => {
  await assert.rejects(
    inspectEvidenceCleanup(options({ loadFiles: null })),
    TypeError,
  );
  await assert.rejects(
    inspectEvidenceCleanup(options({ loadRegistrations: null })),
    TypeError,
  );
});