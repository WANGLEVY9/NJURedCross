/**
 * The activity detail owns its own scrollable form. Keep wheel deltas inside
 * that form until it reaches either edge, then let the browser chain to the
 * console scroll container instead of losing every subsequent gesture.
 */
export function bindActivityWorkspaceScroll(form, { enabled = () => true } = {}) {
  let released = false;

  const onWheel = event => {
    if (released || !enabled() || event.ctrlKey || event.defaultPrevented || !event.deltaY) return;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(form) : null;
    if (style && !['auto', 'scroll'].includes(style.overflowY)) return;
    const maximum = Math.max(0, form.scrollHeight - form.clientHeight);
    const atTop = form.scrollTop <= 0 && event.deltaY < 0;
    const atBottom = form.scrollTop >= maximum - 1 && event.deltaY > 0;
    if (atTop || atBottom) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? form.clientHeight : 1);
    form.scrollTop = Math.min(maximum, Math.max(0, form.scrollTop + delta));
  };

  form.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    released = true;
    form.removeEventListener('wheel', onWheel);
  };
}
