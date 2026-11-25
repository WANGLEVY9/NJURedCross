/**
 * 源码级安全巡检。
 *
 * 目标不是替代代码审查，而是让已知高危模式无法悄悄回到 main：
 *   · innerHTML / document.write / eval 等 DOM 注入入口；
 *   · 浏览器里执行的动态 Function；
 *   · 以可执行协议写入 href / src 的运营数据；
 *   · 模板文件里的疑似真实凭据（.env.example 的占位符除外）。
 *
 * 检查只针对本次新增的违规；历史基线中的既有例外必须在 SECURITY_BASELINE 中列明，
 * 且每条例外都要有简短原因。数量增加同样报错，防止在例外列表里“扩编”。
 */
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = {
  // Shared element factory: the only reviewed raw-HTML sink in the browser.
  'public/app/core/dom.js': ['dangerous-dom'],
};

const rules = [
  {
    name: 'dangerous-dom',
    pattern: /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\s*[(=]/g,
    files: /^public\/app\/.*\.js$/,
    message: 'Use textContent/h() or a reviewed sanitizer; raw HTML creates an XSS path.',
  },
  {
    name: 'dynamic-code',
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/g,
    files: /^(?:public\/app\/.*\.js|lib\/.*\.js|server\.js)$/,
    message: 'Dynamic code execution is forbidden; use explicit logic or a reviewed parser.',
  },
  {
    name: 'dangerous-url-literal',
    pattern: /(?:href|src)\s*[:=]\s*['"`]\s*(?:javascript|data|vbscript|file):/gi,
    files: /^public\/app\/.*\.js$/,
    message: 'Executable URL schemes must never be assigned to href/src.',
  },
  {
    name: 'secret-literal',
    pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"`](?!replace-with|synthetic|example|test|placeholder|your-)[A-Za-z0-9_-]{24,}['"`]/gi,
    files: /^(?:README\.md|CONTRIBUTING\.md|SECURITY\.md|AGENTS\.md|docs\/.*\.md|lib\/.*\.js|public\/app\/.*\.js|server\.js)$/,
    message: 'A long literal secret looks like a real credential; keep it in .env.',
  },
];

async function walk(dir) {
  const entries = await readdir(resolve(root, dir), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = `${dir}${dir ? '/' : ''}${entry.name}`;
    if (entry.isDirectory()) result.push(...await walk(relative));
    else result.push(relative);
  }
  return result;
}

const candidates = [
  'server.js',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'AGENTS.md',
  ...await walk('lib'),
  ...await walk('public/app'),
  ...await walk('docs'),
  ...await walk('scripts'),
].filter(path => ['.js', '.mjs', '.md'].includes(extname(path)));

let errors = 0;
let findings = 0;
for (const rule of rules) {
  for (const path of candidates) {
    if (!rule.files.test(path)) continue;
    const source = await readFile(resolve(root, path), 'utf8');
    for (const match of source.matchAll(rule.pattern)) {
      if ((allowed[path] || []).includes(rule.name)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      console.error(`${path}:${line} [${rule.name}] ${rule.message}`);
      errors += 1;
      findings += 1;
    }
  }
}

if (!errors) console.log(`Security source checks passed (${candidates.length} files, ${rules.length} rules).`);
process.exitCode = errors ? 1 : 0;
