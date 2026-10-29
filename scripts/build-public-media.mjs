// Media is published separately from source releases. Originals stay untouched.
//
// Usage:
//   node scripts/build-public-media.mjs /path/to/authorized-originals
//   node scripts/build-public-media.mjs --local-only          # 只用仓库与托管目录里已有的原图
//   node scripts/build-public-media.mjs --local-only --quality=78 --prune
//
// --local-only keeps every manifest entry whose original is unavailable on this
// machine (for example the licensed cover photographs), so a partial rebuild can
// never delete artwork the site still references.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, readdir, rm, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { HOME_CONTENT } from '../public/app/portal/home-content.js';

const args = process.argv.slice(2).filter(arg => !arg.startsWith('/'));
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => {
  const found = args.find(arg => arg.startsWith(`--${name}=`));
  return found ? Number(found.slice(name.length + 3)) : fallback;
};
const localOnly = flag('local-only');
const prune = flag('prune');
const quality = option('quality', Number(process.env.MEDIA_WEBP_QUALITY) || 78);
const widths = (process.env.MEDIA_WIDTHS || '320,480,960,1600').split(',').map(Number).filter(width => width > 0);

const input = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.cache/public-media-originals');
const output = resolve('public/assets/volunteers/optimized');
const manifestPath = resolve('public/app/portal/media-manifest.js');
await mkdir(output, { recursive: true });

const exists = async file => access(file).then(() => true, () => false);
const previous = await import(`../public/app/portal/media-manifest.js?build=${Date.now()}`)
  .then(module => module.MEDIA || {})
  .catch(() => ({}));

const candidates = [
  ...HOME_CONTENT.slides.map((item, i) => ({ source: item.image, file: resolve(input, `cover-${i + 1}.jpg`), name: `cover-${i + 1}`, crop: item.crop })),
  ...HOME_CONTENT.volunteers.map((item, i) => ({ source: item.image, file: resolve(input, `volunteer-0${i + 1}.jpg`), fallback: resolve(`public${item.image}`), name: `volunteer-${i + 1}` })),
  ...Array.from({ length: 6 }, (_, i) => ({ source: `/assets/events-carousel/activity-0${i + 1}.webp`, file: resolve(`public/assets/events-carousel/activity-0${i + 1}.webp`), name: `activity-${i + 1}` })),
];

const manifest = {};
const kept = [];
let originalBytes = 0, deliveredBytes = 0;
const perSource = [];
for (const item of candidates) {
  const file = await exists(item.file) ? item.file : (item.fallback && await exists(item.fallback) ? item.fallback : null);
  if (!file) {
    // 原始图不在这台机器上：保留既有条目，绝不删除站点仍在引用的作品。
    if (previous[item.source]) { manifest[item.source] = previous[item.source]; kept.push(item.name); }
    else if (!localOnly) throw new Error(`Missing original for ${item.name}: ${item.file}`);
    continue;
  }
  const original = await readFile(file);
  originalBytes += original.length;
  let pipeline = sharp(original).rotate();
  if (item.crop) pipeline = pipeline.extract({ left: item.crop.x, top: item.crop.y, width: item.crop.width, height: item.crop.height });
  const prepared = await pipeline.toBuffer();
  const metadata = await sharp(prepared).metadata();
  const sizes = [...new Set(widths.map(width => Math.min(width, metadata.width)))].sort((a, b) => a - b);
  const variants = [];
  for (const width of sizes) {
    const bytes = await sharp(prepared).resize({ width, withoutEnlargement: true }).webp({ quality, effort: 6 }).toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const name = `${item.name}-${width}-${hash.slice(0, 16)}.webp`;
    await writeFile(resolve(output, name), bytes);
    variants.push({ width, src: `/assets/volunteers/optimized/${name}?v=${hash}`, bytes: bytes.length });
  }
  const standard = variants.find(v => v.width >= 960) || variants.at(-1);
  deliveredBytes += standard.bytes;
  manifest[item.source] = { src: standard.src, srcset: variants.map(v => `${v.src} ${v.width}w`).join(', '), width: metadata.width, height: metadata.height, cropped: Boolean(item.crop) };
  perSource.push({ name: item.name, original: original.length, standard: standard.bytes });
}

let removed = 0;
if (prune) {
  const referenced = new Set();
  for (const entry of Object.values(manifest)) {
    referenced.add(new URL(entry.src, 'https://local').pathname.split('/').pop());
    for (const part of String(entry.srcset || '').split(',')) {
      const path = part.trim().split(' ')[0];
      if (path) referenced.add(new URL(path, 'https://local').pathname.split('/').pop());
    }
  }
  for (const file of await readdir(output)) {
    if (file.endsWith('.webp') && !referenced.has(file)) { await rm(resolve(output, file), { force: true }); removed += 1; }
  }
}

await writeFile(manifestPath, '// Generated from authorized originals by scripts/build-public-media.mjs.\n// Images are managed media, excluded from Git and code deployment archives.\nexport const MEDIA = ' + JSON.stringify(manifest, null, 2) + ';\n');
console.log(JSON.stringify({
  sources: Object.keys(manifest).length,
  rebuilt: perSource.length,
  kept,
  quality,
  widths,
  originalBytes,
  deliveredBytes,
  pruned: removed,
  perSource,
  output,
}, null, 1));
