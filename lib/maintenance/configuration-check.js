const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function text(env, field) {
  return typeof env[field] === 'string' ? env[field].trim() : '';
}

export function inspectPlatformConfiguration(env) {
  const errors = [];
  const warnings = [];
  const production = text(env, 'NODE_ENV') === 'production';

  const report = (list, field, code) => {
    list.push({ field, code });
  };

  const token = text(env, 'SEATABLE_API_TOKEN');
  if (!token || token.startsWith('replace-with-')) {
    report(errors, 'SEATABLE_API_TOKEN', 'missing_or_placeholder');
  }

  const secret = env.PLATFORM_SESSION_SECRET;
  if (
    typeof secret !== 'string'
    || secret.length < 32
    || secret.startsWith('replace-with-')
  ) {
    report(errors, 'PLATFORM_SESSION_SECRET', 'invalid_session_secret');
  }

  const server = text(env, 'SEATABLE_SERVER_URL')
    || 'https://table.nju.edu.cn';

  try {
    const url = new URL(server);
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (production && url.protocol !== 'https:')
    ) {
      throw new Error('Invalid server URL');
    }
  } catch {
    report(errors, 'SEATABLE_SERVER_URL', 'invalid_server_url');
  }

  const businessUuid = text(env, 'SEATABLE_BUSINESS_BASE_UUID');
  if (
    (production && !businessUuid)
    || (businessUuid && !uuidPattern.test(businessUuid))
  ) {
    report(errors, 'SEATABLE_BUSINESS_BASE_UUID', 'invalid_or_missing_uuid');
  }

  const identityToken = text(env, 'SEATABLE_IDENTITY_API_TOKEN');
  const identityUuid = text(env, 'SEATABLE_IDENTITY_BASE_UUID');

  if (production || identityToken || identityUuid) {
    if (!identityToken || identityToken.startsWith('replace-with-')) {
      report(errors, 'SEATABLE_IDENTITY_API_TOKEN', 'missing_or_placeholder');
    }
    if (!uuidPattern.test(identityUuid)) {
      report(errors, 'SEATABLE_IDENTITY_BASE_UUID', 'invalid_or_missing_uuid');
    }
  } else {
    report(warnings, 'SEATABLE_IDENTITY_API_TOKEN', 'local_bootstrap_only');
  }

  for (const field of [
    'PLATFORM_AUDIT_RECONCILIATION_ENABLED',
    'MATERIALS_REMINDER_ENABLED',
    'PLATFORM_TEST_WORKFLOW',
  ]) {
    const value = text(env, field);
    if (value && !['true', 'false'].includes(value)) {
      report(errors, field, 'invalid_boolean');
    }
  }

  for (const field of [
    'PLATFORM_WRITE_STATE_DIR',
    'PLATFORM_SESSION_REVOCATIONS_FILE',
  ]) {
    if (production && !text(env, field)) {
      report(errors, field, 'missing_production_storage');
    }
  }

  const smtpFields = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];
  const smtpPresent = smtpFields.map(field => Boolean(text(env, field)));

  if (smtpPresent.some(Boolean) && !smtpPresent.every(Boolean)) {
    report(errors, 'SMTP', 'incomplete_smtp_configuration');
  } else if (!smtpPresent.some(Boolean)) {
    report(
      production ? errors : warnings,
      'SMTP',
      production ? 'production_mail_unavailable' : 'development_console_transport',
    );
  }

  if (smtpPresent.some(Boolean)) {
    const rawPort = text(env, 'SMTP_PORT') || '587';
    const port = Number(rawPort);
    if (
      !/^[1-9]\d{0,4}$/.test(rawPort)
      || !Number.isInteger(port)
      || port > 65535
    ) {
      report(errors, 'SMTP_PORT', 'invalid_port');
    }

    const secure = text(env, 'SMTP_SECURE');
    if (secure && !['true', 'false'].includes(secure)) {
      report(errors, 'SMTP_SECURE', 'invalid_boolean');
    }
  }

  return {
    mode: 'read-only',
    writes: 0,
    production,
    ok: errors.length === 0,
    errors,
    warnings,
  };
}