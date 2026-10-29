// Media is published separately from source releases. Originals stay untouched.
// Usage: node scripts/build-public-media.mjs /path/to/authorized-originals
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { HOME_CONTENT } from '../public/app/portal/home-content.js';

const input = resolve(process.argv[2] || '.cache/public-media-originals');
const output = resolve('public/assets/volunteers/optimized');
await mkdir(output, { recursive: true });
const sources = [
  ...HOME_CONTENT.slides.map((item, i) => ({ source: item.image, file: resolve(input, `cover-${i + 1}.jpg`), name: `cover-${i + 1}`, crop: item.crop })),
  ...HOME_CONTENT.volunteers.map((item, i) => ({ source: item.image, file: resolve(input, `volunteer-0${i + 1}.jpg`), name: `volunteer-${i + 1}` })),
  ...Array.from({ length: 6 }, (_, i) => ({ source: `/assets/events-carousel/activity-0${i + 1}.webp`, file: resolve(`public/assets/events-carousel/activity-0${i + 1}.webp`), name: `activity-${i + 1}` })),
];
const manifest = {};
let originalBytes = 0, deliveredBytes = 0;
for (const item of sources) {
  const original = await readFile(item.file);
  originalBytes += original.length;
  let pipeline = sharp(original).rotate();
  if (item.crop) pipeline = pipeline.extract({ left: item.crop.x, top: item.crop.y, width: item.crop.width, height: item.crop.height });
  const prepared = await pipeline.toBuffer();
  const metadata = await sharp(prepared).metadata();
  const widths = [...new Set([480, 960, 1600].map(width => Math.min(width, metadata.width)))];
  const variants = [];
  for (const width of widths) {
    const bytes = await sharp(prepared).resize({ width, withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const name = `${item.name}-${width}-${hash.slice(0, 16)}.webp`;
    await writeFile(resolve(output, name), bytes);
    variants.push({ width, src: `/assets/volunteers/optimized/${name}?v=${hash}`, bytes: bytes.length });
  }
  const standard = variants.find(v => v.width >= 960) || variants.at(-1);
  deliveredBytes += standard.bytes;
  manifest[item.source] = { src: standard.src, srcset: variants.map(v => `${v.src} ${v.width}w`).join(', '), width: metadata.width, height: metadata.height, cropped: Boolean(item.crop) };
}
await writeFile('public/app/portal/media-manifest.js', '// Generated from authorized originals by scripts/build-public-media.mjs.\n// Images are managed media, excluded from Git and code deployment archives.\nexport const MEDIA = ' + JSON.stringify(manifest, null, 2) + ';\n');
console.log(JSON.stringify({ sources: sources.length, originalBytes, deliveredBytes, output }));
