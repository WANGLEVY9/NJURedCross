import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWriteCoordinator } from '../materials/write-coordinator.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const maintenanceContext = new AsyncLocalStorage();

export function assertCoordinatedMaintenance({ write = true } = {}) {
  if (!write) return;
  if (!maintenanceContext.getStore()) {
    throw new Error(
      '写入维护脚本必须通过 scripts/run-coordinated-script.mjs 运行。',
    );
  }
}

const allowedScripts = new Set([
  'apply-account-schema.mjs',
  'apply-event-schema.mjs',
  'apply-notice-schema.mjs',
  'apply-state-schema.mjs',
  'apply-workflow-schema.mjs',
  'clean-test-rows.mjs',
  'extend-registration-profile-schema.mjs',
  'extend-volunteer-profile-schema.mjs',
  'migrate-private-identity.mjs',
  'retire-business-identity.mjs',
  'set-account-role.mjs',
  'smoke-workflow-test-base.mjs',
]);

export async function runCoordinatedScript({
  scriptName,
  args = [],
  root,
  stateDir,
  isProduction = false,
  createCoordinator = createWriteCoordinator,
  execute,
}) {
  if (!allowedScripts.has(scriptName)) {
    throw new Error('请指定支持协调运行的维护脚本文件名。');
  }
  if (typeof root !== 'string' || !root.trim()) {
    throw new TypeError('必须提供仓库根目录。');
  }
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new TypeError('脚本参数必须是字符串数组。');
  }
  if (typeof execute !== 'function') {
    throw new TypeError('必须提供脚本执行函数。');
  }

  const configuredDir = stateDir?.trim();
  if (isProduction && !configuredDir) {
    throw new Error('生产维护脚本必须配置 PLATFORM_WRITE_STATE_DIR。');
  }

  const directory = configuredDir || join(root, '.write-state');
  const withWriteLock = await createCoordinator(
    join(directory, 'write-lock.sqlite'),
  );
  const scriptUrl = pathToFileURL(join(root, 'scripts', scriptName));
  
  return withWriteLock(() => maintenanceContext.run(
    true,
    () => execute(scriptUrl, [...args]),
  ));
}