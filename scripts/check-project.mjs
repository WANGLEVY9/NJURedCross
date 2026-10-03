/** Portable syntax/import/documentation checks; never loads .env or application modules. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
async function files(directory) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}
const sources = ['server.js', 'eslint.config.js', ...await files('lib'), ...await files('public'), ...await files('scripts'), ...await files('tests')]
  .filter(path => ['.js', '.mjs'].includes(extname(path)));
let errors = 0;
for (const path of sources) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, path)], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(path, result.stderr || result.error); errors++; }
  const source = await readFile(resolve(root, path), 'utf8');
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
    try { await stat(resolve(dirname(resolve(root, path)), match[1])); }
    catch { console.error(`${path}: unresolved relative import ${match[1]}`); errors++; }
  }
}
const docs = [...(await readdir(root)).filter(path => path.endsWith('.md')), ...await files('docs'), ...await files('.github'), ...await files('lib'), ...await files('public'), ...await files('scripts'), ...await files('tests'), ...await files('reports')].filter(path => path.endsWith('.md'));
for (const path of docs) {
  const source = await readFile(resolve(root, path), 'utf8');
  for (const match of source.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    try { await stat(resolve(dirname(resolve(root, path)), decodeURIComponent(target))); }
    catch { console.error(`${path}: broken local link ${target}`); errors++; }
  }
}
console.log(`Checked ${sources.length} JavaScript modules and ${docs.length} Markdown documents; ${errors} errors.`);
process.exitCode = errors ? 1 : 0;
