import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function invalid() {
  return Object.assign(
    new Error('审计核对配置无效，请检查开关、业务 UUID 和私有状态目录。'),
    { code: 'audit_configuration_invalid' },
  );
}

export function auditReconciliationConfig(env, publicDir) {
  const flag = env.PLATFORM_AUDIT_RECONCILIATION_ENABLED?.trim() || 'false';

  if (!['true', 'false'].includes(flag)) throw invalid();
  if (flag === 'false') return null;

  const baseUuid = env.SEATABLE_BUSINESS_BASE_UUID?.trim() || '';
  const directory = env.PLATFORM_WRITE_STATE_DIR?.trim() || '';

  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
      .test(baseUuid)
    || !directory
    || typeof publicDir !== 'string'
    || !publicDir
  ) {
    throw invalid();
  }

  const privateDirectory = resolve(directory);
  const publicDirectory = resolve(publicDir);
  const location = relative(publicDirectory, privateDirectory);

  if (
    location === ''
    || (!isAbsolute(location)
      && location !== '..'
      && !location.startsWith(`..${sep}`))
  ) {
    throw invalid();
  }

  return {
    baseUuid,
    directory: privateDirectory,
    file: join(privateDirectory, 'audit-reconciliation.sqlite'),
  };
}