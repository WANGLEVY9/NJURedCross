import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { auditReconciliationConfig } from '../lib/audit/config.js';

const root = resolve('synthetic-audit-config');
const publicDir = join(root, 'public');
const baseUuid = '00000000-0000-4000-8000-000000000001';

function enabled(overrides = {}) {
  return {
    PLATFORM_AUDIT_RECONCILIATION_ENABLED: 'true',
    SEATABLE_BUSINESS_BASE_UUID: baseUuid,
    PLATFORM_WRITE_STATE_DIR: join(root, 'private-state'),
    ...overrides,
  };
}

test('disabled reconciliation needs no private store configuration', () => {
  assert.equal(auditReconciliationConfig({}, publicDir), null);
  assert.equal(auditReconciliationConfig({
    PLATFORM_AUDIT_RECONCILIATION_ENABLED: 'false',
  }, publicDir), null);
});

test('invalid feature flags stop configuration', () => {
  for (const flag of ['TRUE', '1', 'yes']) {
    assert.throws(
      () => auditReconciliationConfig(enabled({
        PLATFORM_AUDIT_RECONCILIATION_ENABLED: flag,
      }), publicDir),
      { code: 'audit_configuration_invalid' },
    );
  }
});

test('enabled reconciliation requires an explicit directory and valid UUID', () => {
  for (const overrides of [
    { PLATFORM_WRITE_STATE_DIR: '' },
    { PLATFORM_WRITE_STATE_DIR: '   ' },
    { SEATABLE_BUSINESS_BASE_UUID: '' },
    { SEATABLE_BUSINESS_BASE_UUID: 'invalid' },
  ]) {
    assert.throws(
      () => auditReconciliationConfig(enabled(overrides), publicDir),
      { code: 'audit_configuration_invalid' },
    );
  }
});

test('public directory and its descendants cannot hold audit state', () => {
  for (const directory of [
    publicDir,
    join(publicDir, 'private-state'),
    join(publicDir, 'nested', '..', 'private-state'),
  ]) {
    assert.throws(
      () => auditReconciliationConfig(enabled({
        PLATFORM_WRITE_STATE_DIR: directory,
      }), publicDir),
      { code: 'audit_configuration_invalid' },
    );
  }
});

test('private sibling directories produce an absolute database path', () => {
  const directory = join(root, 'public-private-state');
  const config = auditReconciliationConfig(enabled({
    PLATFORM_WRITE_STATE_DIR: directory,
  }), publicDir);

  assert.equal(config.baseUuid, baseUuid);
  assert.equal(config.directory, directory);
  assert.equal(config.file, join(directory, 'audit-reconciliation.sqlite'));
});