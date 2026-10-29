// Deferred font faces load only the glyphs used on this page. Large global
// preloads must not compete with the first photograph or delay startup.
//
// The brand subsets weigh ~350 KB, so the stylesheet is attached only where the
// typography is actually required (the activity plaza and its design page).
// Other surfaces keep the system stack and never pay for these downloads.
const FONT_HREF = '/styles/events-fonts.css';
const usesEventsTypography = () => location.pathname === '/events'
  || location.pathname.startsWith('/events/')
  || location.pathname === '/design/events-plaza.html';

export function prepareEventsFonts() {
  document.documentElement.dataset.eventsTypography = 'true';
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  // media=print keeps the request off the first paint path; boot flips it.
  link.media = 'print';
  link.dataset.deferredStyle = '';
  link.addEventListener('load', () => { link.media = 'all'; link.dataset.deferredStyle = 'loaded'; });
  link.addEventListener('error', () => { link.dataset.deferredStyle = 'error'; });
  document.head.append(link);
}

if (usesEventsTypography()) prepareEventsFonts();
