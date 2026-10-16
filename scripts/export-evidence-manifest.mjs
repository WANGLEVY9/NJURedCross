import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvidenceManifest } from '../lib/events/evidence-manifest.js';
import { saveEvidenceManifest } from '../lib/events/evidence-manifest-save.js';

function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ''
    || (!isAbsolute(path)
      && path !== '..'
      && !path.startsWith(`..${sep}`));
}

try {
  const args = process.argv.slice(2);
  const options = new Map();

  for (const arg of args) {
    const match = arg.match(/^--(directory|output)=(.+)$/);
    if (!match || options.has(match[1]) || !isAbsolute(match[2])) {
      throw new Error('Invalid export arguments');
    }
    options.set(match[1], match[2]);
  }

  const directory = options.get('directory');
  const output = options.get('output');
  if (!directory || args.length < 1 || args.length > 2) {
    throw new Error('Explicit directory required');
  }

  const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
  if (isWithin(publicDirectory, directory)) {
    throw new Error('Public evidence directory forbidden');
  }

  if (output) {
    if (
      !output.toLowerCase().endsWith('.json')
      || isWithin(publicDirectory, output)
      || isWithin(directory, dirname(output))
    ) {
      throw new Error('A separate private JSON destination is required');
    }
  }

  const manifest = {
    ...await createEvidenceManifest(directory),
    generatedAt: new Date().toISOString(),
  };

  if (output) {
    const saved = await saveEvidenceManifest(output, manifest);
    console.log(JSON.stringify({
      ...saved,
      files: manifest.files.length,
      totalBytes: manifest.totalBytes,
      deletes: 0,
    }, null, 2));
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }
} catch {
  console.error(
    '照片校验清单导出失败。请检查私有目录、读取上限和输出路径；不覆盖已有清单，不删除照片。若指定输出，请核查目标文件状态。',
  );
  process.exitCode = 1;
}