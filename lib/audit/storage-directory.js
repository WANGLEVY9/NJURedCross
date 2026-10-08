import { validatePrivateStateDirectory } from '../http/private-state-directory.js';

/** Preserve the optional audit interface and its public error code. */
export async function validateAuditStorageDirectory(config, publicDir) {
  if (config === null) return;

  try {
    await validatePrivateStateDirectory(config, publicDir);
  } catch {
    throw Object.assign(
      new Error('审计私有状态目录无法安全确认，已停止启动。'),
      { code: 'audit_storage_directory_unavailable' },
    );
  }
}