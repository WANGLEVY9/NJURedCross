import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materialOperationIdentity,
  assertSameMaterialOperation,
} from '../lib/materials/operation.js';

const input = {
  idempotencyKey: 'synthetic-operation',
  applicationId: 'synthetic-application',
  assetCode: 'synthetic-asset',
  operation: '出库',
  quantity: 2,
  lossQuantity: 0,
  actor: 'synthetic-admin',
  destination: 'synthetic-event',
  note: 'synthetic-note',
  photoHash: 'a'.repeat(64),
};

test('identical material requests have a stable fingerprint', () => {
  const first = materialOperationIdentity(input);
  const retry = materialOperationIdentity({ ...input });

  assert.equal(first.fingerprint, retry.fingerprint);
  assert.doesNotThrow(() => assertSameMaterialOperation(first, retry));
});

test('changed material operation content is rejected for the same key', () => {
  const original = materialOperationIdentity(input);
  const changes = [
    { applicationId: 'another-application' },
    { assetCode: 'another-asset' },
    { operation: '归还' },
    { quantity: 3 },
    { lossQuantity: 1 },
    { actor: 'another-admin' },
    { destination: 'another-event' },
    { note: 'another-note' },
    { photoHash: 'b'.repeat(64) },
  ];

  for (const change of changes) {
    const changed = materialOperationIdentity({ ...input, ...change });
    assert.throws(
      () => assertSameMaterialOperation(original, changed),
      error => error.statusCode === 409
        && error.code === 'material_operation_conflict',
    );
  }
});

test('different operation keys cannot be treated as the same receipt', () => {
  const first = materialOperationIdentity(input);
  const second = materialOperationIdentity({
    ...input,
    idempotencyKey: 'another-operation',
  });

  assert.equal(first.fingerprint, second.fingerprint);
  assert.throws(
    () => assertSameMaterialOperation(first, second),
    error => error.code === 'material_operation_conflict',
  );
});

test('invalid quantities and missing identifiers are rejected', () => {
  const changes = [
    { idempotencyKey: '' },
    { applicationId: '' },
    { assetCode: '' },
    { actor: '' },
    { operation: '未知操作' },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: NaN },
    { quantity: Number.MAX_SAFE_INTEGER + 1 },
    { lossQuantity: -1 },
    { lossQuantity: 3 },
    { photoHash: 'invalid-hash' },
  ];

  for (const change of changes) {
    assert.throws(
      () => materialOperationIdentity({ ...input, ...change }),
      error => error.statusCode === 400,
    );
  }
});

test('surrounding text whitespace is normalized consistently', () => {
  const first = materialOperationIdentity(input);
  const second = materialOperationIdentity({
    ...input,
    applicationId: ` ${input.applicationId} `,
    assetCode: ` ${input.assetCode} `,
    destination: ` ${input.destination} `,
    note: ` ${input.note} `,
  });

  assert.equal(first.fingerprint, second.fingerprint);
});