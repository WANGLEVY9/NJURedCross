// Import authorized plaza photographs into the managed media pipeline.
//
// 授权照片按广场分目录存放（例如 ~/Desktop/平台新照片/宣传广场/…）。本脚本把
// 它们转成同站一致的托管媒体：一张 1600w 的源图 + 320/480/960/1600 四档 webp
// 变体，并把条目并入 public/app/portal/media-manifest.js。
//
// 原图与变体都属于托管媒体（不入库，见 .gitignore 的 /public/assets/ 段），
// 生成后需要上传到生产主机；清单本身随源码发布。
//
// Usage: node scripts/import-plaza-photos.mjs [sourceDir] [--alt=alt.json]
import sharp from 'sharp';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';

const HOME = process.env.HOME || '/tmp';
const source = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : `${HOME}/Desktop/平台新照片`);
const altFile = process.argv.find(arg => arg.startsWith('--alt='))?.slice(6);
const widths = [320, 480, 960, 1600];
const SOURCE_WIDTH = 1600;

/** 目录名 → 产物前缀。新增广场只要在这里加一行。 */
const GROUPS = [
  ['活动广场', 'events'],
  ['宣传广场', 'outreach'],
  ['内建广场', 'community'],
  ['物资广场', 'materials'],
  ['管理端', 'console'],
];
const IMAGE = /\.(jpe?g|png|webp|avif|tiff?)$/i;

const previous = await import(`../public/app/portal/media-manifest.js?import=${Date.now()}`)
  .then(module => module.MEDIA || {})
  .catch(() => ({}));
const altOverrides = altFile ? JSON.parse(await readFile(altFile, 'utf8')) : {};

const output = resolve('public/assets/volunteers/optimized');
const sourceDir = resolve('public/assets/plaza');
await mkdir(output, { recursive: true });
await mkdir(sourceDir, { recursive: true });

const manifest = { ...previous };
const added = [];

for (const [label, slug] of GROUPS) {
  let files;
  try {
    files = (await readdir(resolve(source, label))).filter(name => IMAGE.test(name) && !name.startsWith('.')).sort();
  } catch {
    continue; // 这一轮没有提供该广场的照片，保留清单里的既有条目。
  }
  for (const [index, name] of files.entries()) {
    const key = `${slug}-${index + 1}`;
    const input = resolve(source, label, name);
    const rotated = await sharp(input, { limitInputPixels: 400_000_000 }).rotate().toBuffer();
    const metadata = await sharp(rotated).metadata();
    // 源图：页面回退与手动引用时使用，压到 1600w 已足够。
    const sourceBytes = await sharp(rotated).resize({ width: SOURCE_WIDTH, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toBuffer();
    const sourceName = `${key}.webp`;
    await writeFile(resolve(sourceDir, sourceName), sourceBytes);

    const variants = [];
    for (const width of widths) {
      if (width > metadata.width) continue;
      const bytes = await sharp(rotated).resize({ width, withoutEnlargement: true }).webp({ quality: 78, effort: 6 }).toBuffer();
      const hash = createHash('sha256').update(bytes).digest('hex');
      const file = `${key}-${width}-${hash.slice(0, 16)}.webp`;
      await writeFile(resolve(output, file), bytes);
      variants.push({ width, src: `/assets/volunteers/optimized/${file}?v=${hash}`, bytes: bytes.length });
    }
    const standard = variants.find(variant => variant.width >= 960) || variants.at(-1);
    const path = `/assets/plaza/${sourceName}`;
    manifest[path] = {
      src: standard.src,
      srcset: variants.map(variant => `${variant.src} ${variant.width}w`).join(', '),
      width: metadata.width,
      height: metadata.height,
    };
    added.push({ group: label, slug, path, from: name, alt: altOverrides[key] || '', bytes: sourceBytes.length, variants: variants.length });
  }
}

await writeFile(
  'public/app/portal/media-manifest.js',
  '// Generated from authorized originals by scripts/build-public-media.mjs.\n'
  + '// Images are managed media, excluded from Git and code deployment archives.\n'
  + 'export const MEDIA = ' + JSON.stringify(manifest, null, 2) + ';\n',
);

console.log(JSON.stringify({ source, entries: Object.keys(manifest).length, added }, null, 1));
console.log('\n把下面这些条目填进 public/app/portal/plaza-slides.js（alt 需按照片内容校对）:');
for (const item of added) console.log(`  ${item.slug}: { image: '${item.path}', alt: '…', position: '50% 50%' }  // 来自 ${item.from}`);
