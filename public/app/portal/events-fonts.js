const PORTAL_FONT_URLS = [
  '/assets/fonts/roles/sans-400-core.woff2?v=c3b8c7a054198b82c1cd805797f6186a79d6dbae5f2cb002830d6b0400e4c449',
  '/assets/fonts/roles/sans-700-core.woff2?v=89121e0f350123190fd6d4c5e53098c583518dcfec357447dbbad2e27aa12d4f',
  '/assets/fonts/events/wordmark.woff2',
];

function preloadFonts(urls) {
  for (const href of urls) {
    if ([...document.querySelectorAll('link[rel="preload"][as="font"]')].some(link => link.getAttribute('href') === href)) continue;
    const link = document.createElement('link');
    Object.assign(link, { rel: 'preload', as: 'font', type: 'font/woff2', href, crossOrigin: 'anonymous' });
    document.head.append(link);
  }
}

export function prepareEventsFonts() {
  document.documentElement.dataset.eventsTypography = 'true';
  preloadFonts([...PORTAL_FONT_URLS, '/assets/fonts/events/title.woff2']);
}

preloadFonts(PORTAL_FONT_URLS);
if (location.pathname === '/events' || location.pathname === '/design/events-plaza.html') prepareEventsFonts();
