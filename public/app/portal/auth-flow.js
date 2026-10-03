/** Only same-origin portal destinations are valid after member authentication. */
export function safePortalNext(value, fallback = '/me') {
  const path = String(value || '');
  if (!path.startsWith('/') || /^\/[/\\]/.test(path) || /[\\\x00-\x1f]/.test(path) || /%5c/i.test(path)) return fallback;
  if (/^\/(console|admin)(?:\/|\?|$)/.test(path)) return fallback;
  return path;
}
