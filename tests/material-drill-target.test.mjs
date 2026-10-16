import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMaterialDrillTarget } from '../lib/maintenance/material-drill-target.js';

function target(overrides = {}) {
  return {
    expectedUuid: 'synthetic-test-base',
    configuredUuid: 'synthetic-test-base',
    actualUuid: 'synthetic-test-base',
    nodeEnv: 'development',
    ...overrides,
  };
}

test('matching explicit test target is accepted', () => {
  assert.equal(
    assertMaterialDrillTarget(target()),
    'synthetic-test-base',
  );
});

test('production mode is always refused', () => {
  assert.throws(
    () => assertMaterialDrillTarget(target({ nodeEnv: 'production' })),
    /production/,
  );
});

test('missing explicit test UUID is refused', () => {
  assert.throws(
    () => assertMaterialDrillTarget(target({ expectedUuid: '' })),
    /必须明确指定/,
  );
});

test('different configured business Base is refused', () => {
  assert.throws(
    () => assertMaterialDrillTarget(target({
      configuredUuid: 'another-base',
    })),
    /UUID 不一致/,
  );
});

test('unexpected authenticated Base is refused', () => {
  assert.throws(
    () => assertMaterialDrillTarget(target({
      actualUuid: 'another-base',
    })),
    /UUID 不一致/,
  );
});