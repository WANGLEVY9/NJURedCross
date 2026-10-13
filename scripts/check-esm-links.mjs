/**
 * ESM 具名导入链接体检（静态，不执行任何业务模块、不读 .env）。
 *
 * 为什么需要它：`scripts/check-project.mjs` 只做 `node --check` + 「相对导入目标文件是否存在」，
 * **不校验具名导入是否真的在目标模块里导出**。v2.2 就踩过这个坑——
 * `public/app/portal/pages/photos.js` 把 `getSessionState` 从 `core/store.js` 导入（该函数实际在 `core/api.js`），
 * 浏览器是**链接期**报 SyntaxError → 整个模块连带页面直接加载失败（不是局部报错）。
 *
 * 本脚本逐个模块比对「具名导入语句里写的每个符号」是否出现在目标模块的导出里。
 * （为避免被 check-project.mjs 的注释正则误判为真实导入，这里不写出完整的 import 语句。）
 *
 * 用法：node scripts/check-esm-links.mjs   （npm run check:links）
 * 退出码：有任一问题 → 1。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROOTS = ['public', 'lib', 'scripts', 'tests'];
const SELF = 'check-esm-links.mjs';

const files = [];
/** 统一成「相对仓库根、正斜杠」的键，保证缓存与文件遍历用的是同一套键。 */
function relativePosix(absolute, rootAbsolute) {
  const rootPosix = rootAbsolute.replace(/\\/g, '/').replace(/\/$/, '');
  const absPosix = absolute.replace(/\\/g, '/');
  return absPosix.startsWith(`${rootPosix}/`) ? absPosix.slice(rootPosix.length + 1) : absPosix;
}
function walk(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    const full = join(dir, name).replace(/\\/g, '/');
    if (statSync(join(ROOT, full)).isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(full);
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      files.push(full);
    }
  }
}
for (const root of ROOTS) walk(root);
// 排除本脚本自身（注释里含示例 import，会误报）。
const scanned = files.filter((file) => !file.endsWith(SELF));

/** 收集目标模块导出的具名符号（`export const/function/class` 与 `export { a, b as c }`）。 */
const exportCache = new Map();
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const source = readFileSync(file, 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = piece.split(/\s+as\s+/);
      names.add((alias[1] || alias[0]).trim());
    }
  }
  if (/^export\s+default/m.test(source)) names.add('default');
  exportCache.set(file, names);
  return names;
}

const problems = [];
for (const file of scanned) {
  const source = readFileSync(file, 'utf8');
  const pattern = /import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const spec = match[2];
    const target = resolve(dirname(join(ROOT, file)), spec).replace(/\\/g, "/");
    if (!existsSync(target)) {
      problems.push(`${file}: 找不到模块 ${spec}`);
      continue;
    }
    const available = exportsOf(relativePosix(target, ROOT));
    for (const raw of match[1].split(',')) {
      const piece = raw.trim();
      if (!piece) continue;
      const [imported] = piece.split(/\s+as\s+/);
      const name = imported.trim();
      if (!name || name === 'type') continue;
      if (!available.has(name)) problems.push(`${file}: 「${name}」未从 ${spec} 导出`);
    }
  }
}

if (problems.length) {
  console.error(`发现 ${problems.length} 处导入链接问题：`);
  for (const item of problems) console.error(`  × ${item}`);
  process.exitCode = 1;
} else {
  console.log(`ESM 具名导入链接检查通过（扫描 ${scanned.length} 个模块）`);
}
