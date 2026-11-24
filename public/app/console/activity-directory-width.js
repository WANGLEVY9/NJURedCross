import { prefs } from '../core/store.js';

const KEY = 'activityDirectoryWidth';
export const ACTIVITY_DIRECTORY_MIN_WIDTH = 300;
export const ACTIVITY_DIRECTORY_MAX_WIDTH = 460;
const STEP = 20;

/** Keep the user's width inside the supported responsive range. */
export function clampActivityDirectoryWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return ACTIVITY_DIRECTORY_MIN_WIDTH;
  return Math.min(ACTIVITY_DIRECTORY_MAX_WIDTH, Math.max(ACTIVITY_DIRECTORY_MIN_WIDTH, Math.round(width)));
}

/** Pointer and keyboard resize for the desktop master/detail split. */
export function bindActivityDirectoryWidth({ workspace, directory, handle, desktop }) {
  let width = clampActivityDirectoryWidth(prefs.get(KEY, ACTIVITY_DIRECTORY_MIN_WIDTH));
  let dragging = false;

  function apply(next, persist = false) {
    width = clampActivityDirectoryWidth(next);
    workspace.style.setProperty('--activity-directory-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    if (persist) prefs.set(KEY, width);
  }

  function visible() {
    return desktop.matches && !workspace.classList.contains('is-directory-collapsed');
  }

  function maxWidth() {
    const available = workspace.getBoundingClientRect().width;
    if (!available) return ACTIVITY_DIRECTORY_MAX_WIDTH;
    return Math.min(ACTIVITY_DIRECTORY_MAX_WIDTH, Math.max(ACTIVITY_DIRECTORY_MIN_WIDTH, Math.round(available * 0.48)));
  }

  function sync() {
    const limit = maxWidth();
    handle.hidden = !visible();
    workspace.classList.toggle('has-directory-resizer', visible());
    if (!desktop.matches) workspace.style.removeProperty('--activity-directory-width');
    else apply(Math.min(width, limit));
    handle.setAttribute('aria-valuemax', String(limit));
  }

  handle.addEventListener('pointerdown', event => {
    if (!visible() || event.button !== 0) return;
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = 'true';
    document.body.classList.add('is-resizing-activity-directory');
  });
  handle.addEventListener('pointermove', event => {
    if (!dragging) return;
    const bounds = workspace.getBoundingClientRect();
    apply(Math.min(event.clientX - bounds.left, maxWidth()));
  });
  const stop = event => {
    if (!dragging) return;
    dragging = false;
    delete handle.dataset.dragging;
    document.body.classList.remove('is-resizing-activity-directory');
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    prefs.set(KEY, width);
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  handle.addEventListener('keydown', event => {
    const delta = { ArrowLeft: -STEP, ArrowRight: STEP, Home: -Infinity, End: Infinity }[event.key];
    if (delta === undefined || !visible()) return;
    event.preventDefault();
    const limit = maxWidth();
    const next = delta === -Infinity ? ACTIVITY_DIRECTORY_MIN_WIDTH : delta === Infinity ? limit : Math.min(limit, width + delta);
    apply(next, true);
  });
  handle.addEventListener('dblclick', () => apply(ACTIVITY_DIRECTORY_MIN_WIDTH, true));
  const observer = new ResizeObserver(() => sync());
  observer.observe(workspace);
  desktop.addEventListener('change', sync);
  sync();
  return { sync, dispose: () => { observer.disconnect(); desktop.removeEventListener('change', sync); } };
}
