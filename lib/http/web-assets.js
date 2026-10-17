import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

function renderShell(shellSource, version, surface) {
  let seen = 0;
  const withBundle = shellSource.replace(STYLE_TAG, tag => {
    const href = hrefOf(tag);
    if (!href || !href.startsWith(STYLES_PREFIX)) return tag;
    seen += 1;
    return seen === 1 ? `<link rel="stylesheet" href="${STYLE_BUNDLE_PATH}?v=${version}" />` : '';
  });
  const preloads = [...COMMON_PRELOAD, ...(SURFACE_PRELOAD[surface] || [])]
    .map(href => `<link rel="modulepreload" href="${href}" />`)
    .join('');
  return withBundle.replace('</head>', `${preloads}</head>`);
}

export function createWebAssets(publicDir) {
  const root = resolve(publicDir);
  let built = null;

  async function build() {
    const shellSource = await readFile(resolve(root, 'index.html'), 'utf8');
    const hrefs = [];
    for (const tag of shellSource.match(STYLE_TAG) || []) {
      const href = hrefOf(tag);
      if (href && href.startsWith(STYLES_PREFIX)) hrefs.push(href);
    }

    const chunks = [];
    for (const href of hrefs) {
      // Stylesheet url() references are all absolute (/assets/...), so head-order
      // concatenation preserves both the cascade and asset resolution.
      chunks.push(`/* ${href} */\n${await readFile(resolve(root, `.${href}`), 'utf8')}`);
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

  function assets() {
    if (!built) {
      built = build().catch(error => {
        built = null;
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
