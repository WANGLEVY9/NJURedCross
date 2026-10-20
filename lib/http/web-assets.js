import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Delivery-time front-end assembly.
 *
 * The index shell declares one stylesheet per feature surface, which means the
 * browser must complete ~20 round trips before first paint. On the links this
 * platform serves (hundreds of milliseconds of round trip each) that dominates
 * load time, so the shell is rewritten at delivery time to a single concatenated
 * stylesheet. `public/index.html` stays the single source of truth — the ordered
 * list is read from it, never duplicated here.
 */

const STYLE_TAG = /<link\b[^>]*\brel="stylesheet"[^>]*>/g;
const STYLES_PREFIX = '/styles/';

export const STYLE_BUNDLE_PATH = '/styles/app.css';

/** Modules every surface reaches for; preloading them flattens the import waterfall. */
const COMMON_PRELOAD = [
  '/app/core/format.js',
  '/app/core/store.js',
  '/app/core/telemetry.js',
  '/app/core/public-read-cache.js',
  '/app/ui/overlay.js',
];

const SURFACE_PRELOAD = {
  console: [
    '/app/console/shell.js',
    '/app/console/navigation.js',
    '/app/console/task-route.js',
    '/app/console/scroll-state.js',
    '/app/ui/theme-picker.js',
    '/app/ui/chart.js',
  ],
  portal: [
    '/app/portal/navigation.js',
    '/app/portal/page-art.js',
    '/app/ui/theme-picker.js',
    '/app/ui/select.js',
  ],
};

function hrefOf(tag) {
  const match = tag.match(/href="([^"]+)"/);
  return match ? match[1] : null;
}

function bundleTags(source) {
  const tags = (source.match(STYLE_TAG) || []).filter(tag => {
    const href = hrefOf(tag);
    return href?.startsWith(STYLES_PREFIX) && !['/styles/boot.css','/styles/font-faces.css'].includes(href);
  });
  const deferred = tags.filter(tag => /\bdata-deferred-style\b/.test(tag));
  // The startup stylesheet remains independently render-blocking. Preserve
  // page-specific/lazy links rather than promoting them into the shared bundle.
  return deferred.length ? deferred : tags;
}

// Deliberately support a small CSS grammar. Unsupported imports must leave the
// original linked stylesheets in charge rather than silently change semantics.
async function inlineStyles(root, href, budget, ancestors = []) {
  if (ancestors.length >= 16 || ++budget.files > 256) throw new Error('CSS import limit exceeded');
  const base = new URL('https://local.invalid/styles/');
  const url = new URL(href, base);
  if (url.origin !== base.origin || url.search || url.hash || !url.pathname.startsWith(STYLES_PREFIX)) {
    throw new Error('Only local styles may be bundled');
  }
  const stylesRoot = await realpath(resolve(root, 'styles'));
  const file = await realpath(resolve(root, `.${decodeURIComponent(url.pathname)}`));
  const within = relative(stylesRoot, file);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !file.endsWith('.css')) {
    throw new Error('CSS import escapes styles directory');
  }
  if (ancestors.includes(file)) throw new Error('Cyclic CSS import');
  const info = await stat(file);
  budget.bytes += info.size;
  if (info.size > 2_000_000 || budget.bytes > 8_000_000) throw new Error('CSS import size limit exceeded');
  const source = await readFile(file, 'utf8');
  // Consume comments and strings as complete tokens so apparent imports within
  // either are never interpreted. url() tokens also retain their source base.
  const tokens = /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|url\(\s*(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^()]*)\s*\)|@import\b|[^\s]/gi;
  let result = '', cursor = 0, importsAllowed = true;
  for (let token; (token = tokens.exec(source));) {
    const value = token[0];
    if (value.startsWith('/*')) continue;
    if (value.toLowerCase() === '@import') {
      if (!importsAllowed) throw new Error('CSS import after rules');
      const rest = source.slice(tokens.lastIndex);
      const match = rest.match(/^\s*(?:"([^"\\]*)"|'([^'\\]*)'|url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s()'"\\]+))\s*\))\s*([^;{}]*);/i);
      if (!match) throw new Error('Unsupported CSS import');
      const target = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
      const media = match[6].trim();
      if (!target || /[\\\u0000-\u0020]/.test(target) || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) throw new Error('Unsupported CSS import URL');
      if (/\b(?:layer|supports)\b/i.test(media) || /[^\w\s(),.:/<>=%-]/.test(media)) throw new Error('Unsupported CSS import condition');
      let parentheses = 0;
      for (const char of media) {
        if (char === '(') parentheses++;
        if (char === ')' && --parentheses < 0) throw new Error('Invalid CSS media condition');
      }
      if (parentheses) throw new Error('Invalid CSS media condition');
      const childUrl = new URL(target, url);
      const child = await inlineStyles(root, childUrl.href, budget, [...ancestors, file]);
      result += source.slice(cursor, token.index) + (media ? `@media ${media}{\n${child}\n}` : child);
      cursor = tokens.lastIndex + match[0].length;
      tokens.lastIndex = cursor;
      continue;
    }
    importsAllowed = false;
    if (value === '@' && /^\s*(?:charset|namespace|import)\b/i.test(source.slice(tokens.lastIndex))) throw new Error('Unsupported CSS directive');
    if (/^url\(/i.test(value)) {
      const raw = value.slice(4, -1).trim();
      const target = /^['"]/.test(raw) ? raw.slice(1, -1) : raw;
      if (target.includes('\\')) throw new Error('Unsupported escaped CSS URL');
      if (target && !target.startsWith('/') && !target.startsWith('#') && !/^[a-z][\w+.-]*:/i.test(target)) {
        const asset = new URL(target, url);
        result += source.slice(cursor, token.index) + `url(${JSON.stringify(asset.pathname + asset.search + asset.hash)})`;
        cursor = tokens.lastIndex;
      }
    }
  }
  return result + source.slice(cursor);
}

function renderShell(shellSource, version, surface) {
  const selected = bundleTags(shellSource);
  const hrefs = selected.map(hrefOf);
  const deferred = selected.some(tag => /\bdata-deferred-style\b/.test(tag));
  let seen = 0;
  const withBundle = shellSource.replace(STYLE_TAG, tag => {
    if (!selected.includes(tag)) return tag;
    seen += 1;
    const activation = deferred ? ` media="print" data-deferred-style data-bundled-styles="${hrefs.join(' ')}" fetchpriority="high"` : '';
    return seen === 1 ? `<link rel="stylesheet" href="${STYLE_BUNDLE_PATH}?v=${version}"${activation} />` : '';
  });
  const preloads = [...COMMON_PRELOAD, ...(SURFACE_PRELOAD[surface] || [])]
    .map(href => `<link rel="modulepreload" href="${href}" />`)
    .join('');
  return withBundle.replace('</head>', `${preloads}</head>`);
}

export function createWebAssets(publicDir, { refreshIntervalMs = 500 } = {}) {
  const root = resolve(publicDir);
  let built = null;
  let signature = '';
  let checkedAt = Number.NEGATIVE_INFINITY;

  async function styleFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) files.push(...await styleFiles(path));
      else if (entry.isFile() && entry.name.endsWith('.css')) files.push(path);
    }
    return files;
  }

  async function sourceSignature() {
    const indexPath = resolve(root, 'index.html');
    const indexInfo = await stat(indexPath);
    const files = [indexPath, ...await styleFiles(resolve(root, 'styles'))];
    const rows = [];
    for (const file of files) {
      const info = await stat(file);
      rows.push(`${relative(root, file)}:${info.size}:${info.mtimeMs}`);
    }
    return rows.join('|');
  }

  async function build() {
    const shellSource = await readFile(resolve(root, 'index.html'), 'utf8');
    const hrefs = bundleTags(shellSource).map(hrefOf);

    const chunks = [];
    const budget = { files: 0, bytes: 0 };
    for (const href of hrefs) {
      chunks.push(`/* ${href} */\n${await inlineStyles(root, href, budget)}`);
    }
    const bundle = chunks.join('\n');
    // The token pins the shell to the bundle it was built against, so the bundle
    // can be cached immutably while index.html keeps `no-store`.
    const version = createHash('sha256').update(bundle).update(shellSource).digest('hex').slice(0, 12);

    return {
      version,
      bundle,
      stylesheetCount: hrefs.length,
      shell: {
        portal: renderShell(shellSource, version, 'portal'),
        console: renderShell(shellSource, version, 'console'),
      },
    };
  }

  async function assets() {
    const now = Date.now();
    if (built && now - checkedAt < refreshIntervalMs) return built;
    const currentSignature = await sourceSignature();
    checkedAt = now;
    if (!built || currentSignature !== signature) {
      signature = currentSignature;
      built = build().catch(error => {
        built = null;
        checkedAt = Number.NEGATIVE_INFINITY;
        throw error;
      });
    }
    return built;
  }

  return {
    async shell(surface) {
      const current = await assets();
      return { html: current.shell[surface === 'console' ? 'console' : 'portal'], version: current.version };
    },
    async bundle() {
      const current = await assets();
      return { body: current.bundle, version: current.version };
    },
  };
}
