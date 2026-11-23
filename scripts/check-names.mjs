/** Filename convention gate for new source and documentation files. */
import { execFileSync } from 'node:child_process';
import { extname, posix } from 'node:path';

const root = new URL('../', import.meta.url);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const baseline = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean));

const roots = ['lib/', 'public/', 'scripts/', 'tests/', 'docs/', 'ops/', 'reports/'];
const trackedSet = new Set(tracked);
const extensions = new Set(['.js', '.mjs', '.cjs', '.py', '.sh', '.md']);

// Historical names stay reachable; paths already in HEAD keep their names.
const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)*$/;
const pythonModule = /^[a-z][a-z0-9_]*(?:_[a-z0-9]+)*$/;
const reportName = /^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{4}-\d{2}-\d{2}\.md$/;
const errors = [];

for (const name of tracked) {
  if (baseline.has(name)) continue;
  if (!roots.some(prefix => name.startsWith(prefix)) || !extensions.has(extname(name))) continue;
  const basename = posix.basename(name);
  const stem = basename.slice(0, -extname(basename).length);
  let valid = kebab.test(stem);
  if (extname(name) === '.py' && !/^tests\//.test(name)) valid = kebab.test(stem);
  if (extname(name) === '.py' && name.startsWith('tests/')) valid = pythonModule.test(stem) && stem.endsWith('_test');
  if (name.startsWith('reports/') && extname(name) === '.md' && /[A-Z]/.test(stem)) valid = reportName.test(basename);
  if (!valid) errors.push(name);
}

if (errors.length) {
  console.error('Filename convention violations:');
  for (const name of errors) console.error(`  ${name}`);
  console.error('See docs/NAMING.md; add a justified exception only for historical paths.');
  process.exitCode = 1;
} else {
  console.log('Source and documentation filenames verified.');
}
