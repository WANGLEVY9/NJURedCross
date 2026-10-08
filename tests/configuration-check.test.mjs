import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPlatformConfiguration } from '../lib/maintenance/configuration-check.js';

const uuid = '00000000-0000-4000-8000-000000000001';

function development(overrides = {}) {
  return {
    NODE_ENV: 'development',
    SEATABLE_API_TOKEN: 'synthetic-private-business-token',
    PLATFORM_SESSION_SECRET: 'synthetic-private-session-secret-at-least-32-characters',
    ...overrides,
  };
}

function production(overrides = {}) {
  return development({
    NODE_ENV: 'production',
    SEATABLE_BUSINESS_BASE_UUID: uuid,
    SEATABLE_IDENTITY_API_TOKEN: 'synthetic-private-identity-token',
    SEATABLE_IDENTITY_BASE_UUID: uuid,
    PLATFORM_WRITE_STATE_DIR: '/synthetic/private-state',
    PLATFORM_SESSION_REVOCATIONS_FILE: '/synthetic/session/revocations.json',
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'synthetic@example.test',
    SMTP_PASSWORD: 'synthetic-private-smtp-password',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    ...overrides,
  });
}

function hasError(result, field, code) {
  return result.errors.some(item => item.field === field && item.code === code);
}

test('development configuration reports expected warnings without failing', () => {
  const result = inspectPlatformConfiguration(development());

  assert.equal(result.ok, true);
  assert.equal(result.writes, 0);
  assert.equal(result.production, false);
  assert.deepEqual(result.warnings.map(item => item.code), [
    'local_bootstrap_only',
    'development_console_transport',
  ]);
});

test('complete production configuration passes static checks', () => {
  const result = inspectPlatformConfiguration(production());

  assert.equal(result.ok, true);
  assert.equal(result.production, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('missing credentials and placeholder secrets are rejected', () => {
  const result = inspectPlatformConfiguration(development({
    SEATABLE_API_TOKEN: 'replace-with-your-api-token',
    PLATFORM_SESSION_SECRET: 'replace-with-at-least-32-random-characters',
  }));

  assert.equal(result.ok, false);
  assert.equal(hasError(result, 'SEATABLE_API_TOKEN', 'missing_or_placeholder'), true);
  assert.equal(hasError(result, 'PLATFORM_SESSION_SECRET', 'invalid_session_secret'), true);
});

test('production requires private identity, business UUID and explicit storage', () => {
  const result = inspectPlatformConfiguration(production({
    SEATABLE_BUSINESS_BASE_UUID: '',
    SEATABLE_IDENTITY_API_TOKEN: '',
    SEATABLE_IDENTITY_BASE_UUID: '',
    PLATFORM_WRITE_STATE_DIR: '',
    PLATFORM_SESSION_REVOCATIONS_FILE: '',
  }));

  for (const field of [
    'SEATABLE_BUSINESS_BASE_UUID',
    'SEATABLE_IDENTITY_API_TOKEN',
    'SEATABLE_IDENTITY_BASE_UUID',
    'PLATFORM_WRITE_STATE_DIR',
    'PLATFORM_SESSION_REVOCATIONS_FILE',
  ]) {
    assert.equal(result.errors.some(item => item.field === field), true);
  }
});

test('invalid URLs, UUIDs and feature flags are reported', () => {
  const result = inspectPlatformConfiguration(development({
    SEATABLE_SERVER_URL: 'https://user:password@example.test',
    SEATABLE_BUSINESS_BASE_UUID: 'invalid',
    PLATFORM_AUDIT_RECONCILIATION_ENABLED: 'yes',
    MATERIALS_REMINDER_ENABLED: '1',
    PLATFORM_TEST_WORKFLOW: 'TRUE',
  }));

  assert.equal(result.errors.length, 5);
  assert.equal(result.ok, false);
});

test('production refuses insecure SeaTable URLs', () => {
  const result = inspectPlatformConfiguration(production({
    SEATABLE_SERVER_URL: 'http://example.test',
  }));

  assert.equal(hasError(result, 'SEATABLE_SERVER_URL', 'invalid_server_url'), true);
});

test('SMTP completeness, port and secure flag are checked', () => {
  assert.equal(
    hasError(
      inspectPlatformConfiguration(development({ SMTP_HOST: 'smtp.example.test' })),
      'SMTP',
      'incomplete_smtp_configuration',
    ),
    true,
  );

  const result = inspectPlatformConfiguration(production({
    SMTP_PORT: '65536',
    SMTP_SECURE: 'yes',
  }));

  assert.equal(hasError(result, 'SMTP_PORT', 'invalid_port'), true);
  assert.equal(hasError(result, 'SMTP_SECURE', 'invalid_boolean'), true);
});

test('output contains only problem metadata and never configuration values', () => {
  const env = production({
    SEATABLE_SERVER_URL: 'https://synthetic-user:synthetic-password@example.test',
  });
  const before = structuredClone(env);
  const output = JSON.stringify(inspectPlatformConfiguration(env));

  for (const privateValue of [
    env.SEATABLE_API_TOKEN,
    env.PLATFORM_SESSION_SECRET,
    env.SEATABLE_IDENTITY_API_TOKEN,
    env.SMTP_USER,
    env.SMTP_PASSWORD,
    'synthetic-password',
  ]) {
    assert.equal(output.includes(privateValue), false);
  }

  assert.deepEqual(env, before);
});