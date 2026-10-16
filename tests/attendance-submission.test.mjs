import test from 'node:test';
import assert from 'node:assert/strict';
import { submitAttendancePhoto } from '../lib/events/attendance-submission.js';

test('successful attendance submission uses the stored photo ID', async () => {
  const req = {};
  const calls = [];
  const expected = { submitted: true };

  const result = await submitAttendancePhoto(req, {
    store: async received => {
      assert.equal(received, req);
      calls.push('store');
      return 'synthetic-photo';
    },
    submit: async photoId => {
      assert.equal(photoId, 'synthetic-photo');
      calls.push('submit');
      return expected;
    },
  });

  assert.equal(result, expected);
  assert.deepEqual(calls, ['store', 'submit']);
});

test('storage failure stops before any attendance write', async () => {
  const failure = new Error('synthetic-storage-failure');
  let writes = 0;

  await assert.rejects(
    submitAttendancePhoto({}, {
      store: async () => { throw failure; },
      submit: async () => { writes++; },
    }),
    error => error === failure,
  );

  assert.equal(writes, 0);
});

test('an uncertain remote acknowledgement preserves referenced evidence', async () => {
  const files = new Set();
  const registration = {};
  const failure = new Error('synthetic-response-lost');

  await assert.rejects(
    submitAttendancePhoto({}, {
      store: async () => {
        files.add('synthetic-photo');
        return 'synthetic-photo';
      },
      submit: async photoId => {
        registration.photoId = photoId;
        throw failure;
      },
    }),
    error => error === failure,
  );

  assert.equal(registration.photoId, 'synthetic-photo');
  assert.equal(files.has(registration.photoId), true);
});

test('a rejected submission retains unreferenced evidence for reconciliation', async () => {
  const files = new Set();
  const failure = Object.assign(new Error('synthetic-rejection'), {
    statusCode: 409,
  });

  await assert.rejects(
    submitAttendancePhoto({}, {
      store: async () => {
        files.add('synthetic-photo');
        return 'synthetic-photo';
      },
      submit: async () => { throw failure; },
    }),
    error => error === failure,
  );

  assert.equal(files.has('synthetic-photo'), true);
});

test('invalid dependencies are rejected before storing a photo', async () => {
  let stores = 0;

  await assert.rejects(
    submitAttendancePhoto({}, {
      store: async () => { stores++; },
      submit: null,
    }),
    TypeError,
  );

  await assert.rejects(
    submitAttendancePhoto({}, {
      store: null,
      submit: async () => {},
    }),
    TypeError,
  );

  assert.equal(stores, 0);
});