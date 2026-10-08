import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { auditReconciliationConfig } from '../audit/config.js';
import { validatePrivateStateDirectory } from '../http/private-state-directory.js';

export async function inspectConfigurationStorage(env, { root }) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new TypeError('An absolute project root is required');
  }

  const publicDir = join(root, 'public');
  const production = env.NODE_ENV === 'production';
  const checks = [];

  async function check(field, operation) {
    try {
      await operation();
      checks.push({ field, status: 'passed' });
    } catch {
      checks.push({
        field,
        status: 'failed',
        code: 'storage_configuration_unavailable',
      });
    }
  }

  await check('PLATFORM_WRITE_STATE_DIR', async () => {
    const configured = env.PLATFORM_WRITE_STATE_DIR?.trim();

    if (production && !configured) throw new Error('Missing private directory');

    const directory = resolve(configured || join(root, '.write-state'));
    await validatePrivateStateDirectory({ directory }, publicDir);
  });

  await check('PLATFORM_SESSION_REVOCATIONS_FILE', async () => {
    const configured = env.PLATFORM_SESSION_REVOCATIONS_FILE?.trim();

    if (production && (!configured || !isAbsolute(configured))) {
      throw new Error('An absolute revocation file is required');
    }

    const file = resolve(
      configured || join(root, '.session-state', 'revocations.json'),
    );

    await validatePrivateStateDirectory(
      { directory: dirname(file) },
      publicDir,
    );

    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (
      info
      && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    ) {
      throw new Error('Invalid revocation file');
    }
  });

  await check('PLATFORM_AUDIT_RECONCILIATION_ENABLED', async () => {
    const config = auditReconciliationConfig(env, publicDir);
    if (config) await validatePrivateStateDirectory(config, publicDir);
  });

  return {
    ok: checks.every(item => item.status === 'passed'),
    checks,
  };
}