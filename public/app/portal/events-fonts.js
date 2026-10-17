/** Start only the three small first-screen subsets; other glyphs load via CSS. */
export function preloadEventFonts() {
  for (const name of ['sans', 'serif', 'running']) {
    const href = `/assets/fonts/plaza/${name}-core.woff2`;
    if (document.head.querySelector(`link[rel="preload"][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preload';link.as = 'font';link.type = 'font/woff2';
    link.crossOrigin = 'anonymous';link.href = href;
    document.head.append(link);
  }
  document.documentElement.dataset.eventsTypography = 'true';
}

if (location.pathname === '/events') preloadEventFonts();
