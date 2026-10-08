import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sealAuditPayload,
  openAuditPayload,
} from '../lib/audit/payload.js';

const options = {
  secret: 'synthetic-audit-secret-at-least-32-characters',
  baseUuid: '00000000-0000-4000-8000-000000000001',
};

function row() {
  return {
    审计ID: 'AUD-synthetic-001',
    时间: '2026-01-01T00:00:00.000Z',
    操作人: 'synthetic-private-actor',
    角色: 'platform_admin',
    动作: 'materials.synthetic',
    对象: 'synthetic-private-target',
    结果: 'success',
    IP: 'synthetic-private-address',
    备注: '{"quantity":2}',
  };
}

function rejectsPayload(operation) {
  assert.throws(operation, error => {
    assert.equal(error.code, 'audit_payload_unavailable');
    assert.equal(error.message.includes('synthetic-private'), false);
    return true;
  });
}

test('audit records survive encryption and decryption without plaintext fields', () => {
  const input = row();
  const envelope = sealAuditPayload(input, options);

  assert.deepEqual(openAuditPayload(envelope, options), input);
  assert.equal(envelope.auditId, input['审计ID']);
  assert.match(envelope.fingerprint, /^[a-f0-9]{64}$/);

  const encoded = JSON.stringify(envelope);
  for (const field of ['操作人', '对象', 'IP', '备注']) {
    assert.equal(encoded.includes(input[field]), false);
  }
});

test('fresh random IVs produce different ciphertext for the same audit record', () => {
  const first = sealAuditPayload(row(), options);
  const second = sealAuditPayload(row(), options);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.data, second.data);
  assert.deepEqual(openAuditPayload(first, options), row());
  assert.deepEqual(openAuditPayload(second, options), row());
});

test('wrong secrets and different Bases cannot recover the payload', () => {
  const envelope = sealAuditPayload(row(), options);

  rejectsPayload(() => openAuditPayload(envelope, {
    ...options,
    secret: 'another-synthetic-secret-at-least-32-characters',
  }));
  rejectsPayload(() => openAuditPayload(envelope, {
    ...options,
    baseUuid: '00000000-0000-4000-8000-000000000002',
  }));
});

test('tampering with identity, fingerprint or encrypted data is rejected', () => {
  const envelope = sealAuditPayload(row(), options);
  const changedData = (envelope.data[0] === 'a' ? 'b' : 'a')
    + envelope.data.slice(1);

  for (const changed of [
    { ...envelope, auditId: 'AUD-synthetic-other' },
    { ...envelope, fingerprint: '0'.repeat(64) },
    { ...envelope, iv: '0'.repeat(24) },
    { ...envelope, tag: '0'.repeat(32) },
    { ...envelope, data: changedData },
  ]) {
    rejectsPayload(() => openAuditPayload(changed, options));
  }
});

test('malformed or oversized encrypted envelopes are rejected', () => {
  const envelope = sealAuditPayload(row(), options);

  for (const invalid of [
    null,
    { ...envelope, version: 2 },
    { ...envelope, auditId: '' },
    { ...envelope, data: 'invalid' },
    { ...envelope, data: 'ab'.repeat(65537) },
  ]) {
    rejectsPayload(() => openAuditPayload(invalid, options));
  }
});

test('invalid audit records cannot be sealed', () => {
  const input = row();
  const missingField = { ...input };
  delete missingField['IP'];

  for (const invalid of [
    null,
    [],
    missingField,
    { ...input, 时间: 'invalid-date' },
    { ...input, 操作人: 123 },
    { ...input, unexpected: 'value' },
    { ...input, 备注: 'x'.repeat(64 * 1024) },
  ]) {
    rejectsPayload(() => sealAuditPayload(invalid, options));
  }
});

test('invalid secrets and Base identifiers are rejected before sealing', () => {
  for (const invalid of [
    {},
    { ...options, secret: 'short' },
    { ...options, baseUuid: '' },
    { ...options, baseUuid: 'invalid-base' },
  ]) {
    rejectsPayload(() => sealAuditPayload(row(), invalid));
  }
});