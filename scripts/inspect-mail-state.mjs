import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectMailState,
  inspectMailTask,
  listMailAttention,
} from '../lib/mail/inspection.js';

try {
  const args = process.argv.slice(2);
  let reportMode = 'summary';
  let recordId = null;
  let limit = 20;
  let after = null;

  if (args.length === 1 && args[0].startsWith('--record-id=')) {
    reportMode = 'task';
    recordId = args[0].slice('--record-id='.length);
    if (!recordId) throw new Error('缺少记录编号。');
  } else if (args[0] === '--attention') {
    reportMode = 'attention';
    const seen = new Set();

    for (const arg of args.slice(1)) {
      if (arg.startsWith('--limit=')) {
        if (seen.has('limit')) throw new Error('重复参数。');
        seen.add('limit');

        const value = arg.slice('--limit='.length);
        if (!/^[1-9]\d{0,2}$/.test(value)) {
          throw new Error('分页上限无效。');
        }
        limit = Number(value);
      } else if (arg.startsWith('--after=')) {
        if (seen.has('after')) throw new Error('重复参数。');
        seen.add('after');

        after = arg.slice('--after='.length);
        if (!after) throw new Error('缺少分页游标。');
      } else {
        throw new Error('不支持的参数。');
      }
    }
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

  let report;

  if (reportMode === 'task') {
    report = inspectMailTask(directory, recordId);
  } else if (reportMode === 'attention') {
    report = listMailAttention(directory, { limit, after });
  } else {
    report = inspectMailState(directory);
  }

  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    '邮件只读诊断未完成。请检查参数、状态目录和数据库；本工具不会发送邮件或修改任务状态。',
  );
  process.exitCode = 1;
}