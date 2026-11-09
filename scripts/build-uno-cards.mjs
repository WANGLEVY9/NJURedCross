/**
 * Build web-sized UNO card faces from the original hand-drawn artwork.
 *
 * The source artwork (2104x3211 PNG, ~2.7 MB each, 147 MB in total) is far too
 * heavy for a web page. This script produces one 400px-wide WebP per distinct
 * face (54 faces + card back), which the game reuses for all 108 cards.
 *
 * Usage:
 *   node scripts/build-uno-cards.mjs --source "D:/校红会文件/卡牌/南小红 UNO 卡牌"
 *   node scripts/build-uno-cards.mjs --source <dir> --out public/assets/uno --width 400
 *
 * `--source` is intentionally required: the artwork is not part of this repo.
 */
import sharp from 'sharp';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const source = option('source', null);
if (!source) {
  console.error('缺少 --source <卡牌素材根目录>');
  process.exit(1);
}
const frontDir = join(source, '南小红UNO 正面：54张');
const backFile = join(source, '南小红UNO 包装及反面', '反面.png');
const outDir = resolve(option('out', 'public/assets/uno'));
const width = Number(option('width', 400));
const quality = Number(option('quality', 80));

if (!existsSync(frontDir)) throw new Error(`找不到正面目录：${frontDir}`);
if (!existsSync(backFile)) throw new Error(`找不到牌背：${backFile}`);

/** Chinese artwork filename -> stable ASCII asset name used by the game. */
const COLORS = [
  { cn: '红', key: 'r' },
  { cn: '绿', key: 'g' },
  { cn: '蓝', key: 'b' },
  { cn: '黄', key: 'y' },
];

const mapping = new Map();
for (const { cn, key } of COLORS) {
  for (let value = 0; value <= 9; value += 1) mapping.set(`${cn}${value}.png`, `${key}${value}.webp`);
  mapping.set(`加二${cn}.png`, `d2-${key}.webp`);
  mapping.set(`反转${cn}.png`, `rv-${key}.webp`);
  mapping.set(`禁止${cn}.png`, `sk-${key}.webp`);
}
mapping.set('变色.png', 'wild.webp');
mapping.set('加四.png', 'wild4.webp');

await mkdir(outDir, { recursive: true });
const available = new Set(await readdir(frontDir));
const missing = [...mapping.keys()].filter((name) => !available.has(name));
if (missing.length) throw new Error(`素材缺少 ${missing.length} 张：${missing.join('、')}`);

let total = 0;
const jobs = [
  ...[...mapping.entries()].map(([from, to]) => ({ from: join(frontDir, from), to })),
  { from: backFile, to: 'back.webp' },
];

for (const { from, to } of jobs) {
  const buffer = await sharp(from)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 5 })
    .toBuffer();
  await writeFile(join(outDir, to), buffer);
  total += buffer.length;
}

await writeFile(join(outDir, 'README.txt'), [
  'UNO 卡牌网页素材（由 scripts/build-uno-cards.mjs 生成，请勿手工编辑）',
  `源图：南京大学红十字会学生分会「南小红」原创手绘牌面`,
  `规格：宽 ${width}px WebP / quality ${quality}`,
  `文件：54 张正面 + 1 张牌背；游戏内按标准 UNO 108 张复用这些图片`,
  '命名：r/g/b/y = 红/绿/蓝/黄；d2=加二, rv=反转, sk=禁止, wild=变色, wild4=加四',
  '',
].join('\n'), 'utf8');

console.log(`已生成 ${jobs.length} 张 → ${outDir}`);
console.log(`合计 ${(total / 1024 / 1024).toFixed(2)} MB（原图约 147 MB，压缩至 ${(total / 147 / 1024 / 1024 * 100).toFixed(1)}%）`);
