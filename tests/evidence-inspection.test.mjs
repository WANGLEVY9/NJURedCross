import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectEvidenceReferences,
  inspectAttendanceEvidence,
} from '../lib/events/evidence-inspection.js';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';

test('matching references require no reconciliation', () => {
  const result = inspectEvidenceReferences(
    [{ 签到照片ID: first }],
    [first],
  );

  assert.deepEqual(result.counts, {
    referenced: 1,
    present: 1,
    missing: 0,
    unreferenced: 0,
    ignoredFiles: 0,
  });
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unreferenced, []);
});

test('missing referenced evidence is reported', () => {
  const result = inspectEvidenceReferences(
    [{ 签到照片ID: first }],
    [],
  );

  assert.deepEqual(result.missing, [first]);
  assert.equal(result.counts.missing, 1);
});

test('unreferenced files are reported without deletion authorization', () => {
  const result = inspectEvidenceReferences([], [second]);

  assert.deepEqual(result.unreferenced, [second]);
  assert.equal(result.mode, 'read-only');
  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
  assert.equal(result.deletionAuthorized, false);
});

test('shared references count each file once without exposing identities', () => {
  const result = inspectEvidenceReferences([
    { 签到照片ID: first, 姓名: 'synthetic-private-name' },
    { 签到照片ID: first, 邮箱: 'private@example.test' },
    { 签到照片ID: '' },
    {},
  ], [first]);

  assert.equal(result.counts.referenced, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-private-name'), false);
  assert.equal(JSON.stringify(result).includes('private@example.test'), false);
});

test('incomplete registration reads stop inspection', () => {
  const rows = [];
  Object.defineProperty(rows, 'readMeta', {
    value: { truncated: true },
  });

  assert.throws(
    () => inspectEvidenceReferences(rows, [first]),
    { code: 'incomplete_operational_data', statusCode: 503 },
  );
});

test('invalid reference IDs stop inspection instead of appearing unreferenced', () => {
  for (const id of ['../outside', 'invalid-id', 123, ['invalid']]) {
    assert.throws(
      () => inspectEvidenceReferences([{ 签到照片ID: id }], [first]),
      { code: 'invalid_evidence_inventory', statusCode: 503 },
    );
  }
});

test('unrelated filenames are counted but never selected for reconciliation', () => {
  const result = inspectEvidenceReferences([], [
    'notes.txt',
    'temporary-upload.tmp',
    first,
  ]);

  assert.equal(result.counts.ignoredFiles, 2);
  assert.deepEqual(result.unreferenced, [first]);
});

test('malformed inputs and repeated evidence filenames stop inspection', () => {
  assert.throws(
    () => inspectEvidenceReferences(null, []),
    { code: 'incomplete_operational_data' },
  );

  for (const rows of [[null], [42], [[]]]) {
    assert.throws(
      () => inspectEvidenceReferences(rows, []),
      { code: 'invalid_evidence_inventory' },
    );
  }

  for (const names of [null, [null], [''], [first, first]]) {
    assert.throws(
      () => inspectEvidenceReferences([], names),
      { code: 'invalid_evidence_inventory' },
    );
  }
});
test('inspection combines explicit readers without authorizing deletion', async () => {
  const calls = [];
  const result = await inspectAttendanceEvidence({
    loadRegistrations: async () => {
      calls.push('registrations');
      return [{ 签到照片ID: first }];
    },
    loadDirectory: async () => {
      calls.push('directory');
      return {
        filenames: [first, second],
        ignoredEntries: 1,
        storage: {
          photoBytes: 30,
          otherFileBytes: 0,
          totalFileBytes: 30,
          includesSubdirectories: false,
        },
      };
    },
  });

  assert.deepEqual(calls, ['registrations', 'directory']);
  assert.deepEqual(result.unreferenced, [second]);
  assert.equal(result.atomicSnapshot, false);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.ignoredDirectoryEntries, 1);
  assert.deepEqual(result.storage, {
    photoBytes: 30,
    otherFileBytes: 0,
    totalFileBytes: 30,
    includesSubdirectories: false,
  });
});

test('incomplete registrations stop before directory scanning', async () => {
  const rows = [];
  Object.defineProperty(rows, 'readMeta', {
    value: { truncated: true },
  });
  let scans = 0;

  await assert.rejects(
    inspectAttendanceEvidence({
      loadRegistrations: async () => rows,
      loadDirectory: async () => { scans++; },
    }),
    { code: 'incomplete_operational_data' },
  );
  assert.equal(scans, 0);
});

test('directory failure cannot produce a successful evidence report', async () => {
  const failure = new Error('synthetic-directory-failure');

  await assert.rejects(
    inspectAttendanceEvidence({
      loadRegistrations: async () => [],
      loadDirectory: async () => { throw failure; },
    }),
    error => error === failure,
  );
});

test('invalid readers are rejected before any reads', async () => {
  let reads = 0;

  await assert.rejects(
    inspectAttendanceEvidence({
      loadRegistrations: async () => { reads++; },
      loadDirectory: null,
    }),
    TypeError,
  );
  assert.equal(reads, 0);
});
test('invalid storage totals cannot produce a successful report', async () => {
  const valid = {
    photoBytes: 10,
    otherFileBytes: 2,
    totalFileBytes: 12,
    includesSubdirectories: false,
  };

  for (const storage of [
    undefined,
    { ...valid, photoBytes: -1 },
    { ...valid, otherFileBytes: NaN },
    { ...valid, totalFileBytes: 99 },
    { ...valid, totalFileBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, includesSubdirectories: true },
  ]) {
    await assert.rejects(
      inspectAttendanceEvidence({
        loadRegistrations: async () => [],
        loadDirectory: async () => ({
          filenames: [],
          ignoredEntries: 0,
          storage,
        }),
      }),
      { code: 'invalid_evidence_inventory', statusCode: 503 },
    );
  }
});