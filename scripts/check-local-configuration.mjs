import { fileURLToPath } from 'node:url';
import { inspectPlatformConfiguration } from '../lib/maintenance/configuration-check.js';
import { inspectConfigurationStorage } from '../lib/maintenance/configuration-storage.js';

try {
  if (process.argv.slice(2).length !== 0) {
    throw new Error('Unsupported arguments');
  }

  const root = fileURLToPath(new URL('../', import.meta.url));
  const configuration = inspectPlatformConfiguration(process.env);
  const storage = await inspectConfigurationStorage(process.env, { root });
  const ok = configuration.ok && storage.ok;

  console.log(JSON.stringify({
    mode: 'read-only',
    writes: 0,
    networkRequests: 0,
    ok,
    production: configuration.production,
    errors: configuration.errors,
    warnings: configuration.warnings,
    storageChecks: storage.checks,
  }, null, 2));

  if (!ok) process.exitCode = 1;
} catch {
  console.error(
    '本地配置检查未完成；未输出配置值，未连接外部服务或创建状态文件。',
  );
  process.exitCode = 1;
}