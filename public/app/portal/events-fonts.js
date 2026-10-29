// Deferred font faces load only the glyphs used on this page. Large global
// preloads must not compete with the first photograph or delay startup.
export function prepareEventsFonts() {
  document.documentElement.dataset.eventsTypography = 'true';
}

if (location.pathname === '/events' || location.pathname === '/design/events-plaza.html') prepareEventsFonts();
