import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvidenceManifest } from '../lib/events/evidence-manifest.js';

try {
  const args = process.argv.slice(2);
  if (
    args.length !== 1
    || !args[0].startsWith('--directory=')
  ) {
    throw new Error('Explicit directory argument required');
  }

  const directory = args[0].slice('--directory='.length);
  if (!directory.trim() || !isAbsolute(directory)) {
    throw new Error('Absolute directory required');
  }

  const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
  const insidePublic = relative(publicDirectory, resolve(directory));

  if (
    insidePublic === ''
    || (!isAbsolute(insidePublic)
      && insidePublic !== '..'
      && !insidePublic.startsWith(`..${sep}`))
  ) {
    throw new Error('Public evidence directory forbidden');
  }

  const manifest = await createEvidenceManifest(directory);

  console.log(JSON.stringify({
    ...manifest,
    generatedAt: new Date().toISOString(),
  }, null, 2));
} catch {
  console.error(
    '照片校验清单导出失败。请指定有效私有目录并检查文件及读取上限；未执行文件写入或删除。',
  );
  process.exitCode = 1;
}