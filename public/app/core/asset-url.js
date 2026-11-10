/** Pin a static asset to the release token published by the application shell.
 * The shell is `no-store`, so a deploy always hands out fresh URLs while the
 * assets themselves can be cached immutably. Node-side callers have no DOM and
 * keep the plain path, which keeps unit tests independent of delivery state.
 */
export function assetUrl(path) {
  const version = typeof document !== 'undefined' ? document.documentElement?.dataset?.assetVersion : '';
  if (!version || !path.startsWith('/') || /[?&]v=/.test(path)) return path;
  // Shared modules must keep their plain URL so the browser reuses one instance.
  if (!path.startsWith('/assets/') && !path.startsWith('/styles/') && !path.endsWith('/pages/uno.js')) return path;
  return `${path}${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}
