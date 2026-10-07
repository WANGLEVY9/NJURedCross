import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectMailState,
  inspectMailTask,
} from '../lib/mail/inspection.js';

try {
  const args = process.argv.slice(2);
  let recordId = null;

  if (args.length === 1 && args[0].startsWith('--record-id=')) {
    recordId = args[0].slice('--record-id='.length);

    if (!recordId) throw new Error('缺少记录编号。');
  } else if (args.length !== 0) {
    throw new Error('不支持的参数。');
  }

  const root = fileURLToPath(new URL('../', import.meta.url));
  const configured = process.env.PLATFORM_WRITE_STATE_DIR?.trim();

  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('生产状态目录未指定。');
  }

  const directory = resolve(
    configured || join(root, '.write-state'),
  );

  const report = recordId
    ? inspectMailTask(directory, recordId)
    : inspectMailState(directory);

  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    '邮件只读诊断未完成。请检查参数、状态目录和数据库；本工具不会发送邮件或修改任务状态。',
  );
  process.exitCode = 1;
}