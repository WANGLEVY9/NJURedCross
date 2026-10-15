import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { inspectMaterialState } from '../lib/materials/inspection.js';
import {
  validatePrivateStateDirectory,
} from '../lib/http/private-state-directory.js';

try {
  if (process.argv.length !== 2) {
    throw new Error('unsupported_arguments');
  }

  const root = fileURLToPath(new URL('../', import.meta.url));
  const configuredDirectory = process.env.PLATFORM_WRITE_STATE_DIR;

  if (
    process.env.NODE_ENV === 'production'
    && !configuredDirectory?.trim()
  ) {
    throw new Error('missing_production_directory');
  }

  const directory = resolve(
    configuredDirectory?.trim() || join(root, '.write-state'),
  );

  await validatePrivateStateDirectory(
    { directory },
    join(root, 'public'),
  );

  const result = inspectMaterialState(
    join(directory, 'material-receipts.sqlite'),
  );

  console.log(JSON.stringify(result, null, 2));
} catch {
  console.error(
    '物资凭据只读检查失败：请核对状态目录、数据库及命令参数。',
  );
  process.exitCode = 1;
}