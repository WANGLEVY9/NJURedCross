import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMailState } from '../lib/mail/inspection.js';

try {
  if (process.argv.slice(2).length !== 0) {
    throw new Error('不支持额外参数。');
  }

  const root = fileURLToPath(new URL('../', import.meta.url));
  const configured = process.env.PLATFORM_WRITE_STATE_DIR?.trim();

  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('生产状态目录未指定。');
  }

  const directory = resolve(
    configured || join(root, '.write-state'),
  );

  console.log(JSON.stringify(
    inspectMailState(directory),
    null,
    2,
  ));
} catch {
  console.error(
    '邮件只读诊断未完成。请检查状态目录和数据库；本工具不会发送邮件或修改任务状态。',
  );
  process.exitCode = 1;
}