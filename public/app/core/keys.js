/* ==========================================================================
   keys.js — global keyboard registry.
   Shortcuts are data, so they can be listed in the command palette and shown
   inside tooltips rather than being hidden knowledge.
   ========================================================================== */

const bindings = new Map();
let installed = false;

export const MOD = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? 'meta' : 'ctrl';
export const MOD_LABEL = MOD === 'meta' ? '⌘' : 'Ctrl';

/** "mod+k" → normalised signature independent of platform. */
function normalise(combo) {
  const parts = String(combo).toLowerCase().split('+').map((part) => part.trim()).filter(Boolean);
  const mods = new Set();
  let key = '';
  for (const part of parts) {
    if (part === 'mod') mods.add(MOD);
    else if (['meta', 'cmd', 'command'].includes(part)) mods.add('meta');
    else if (['ctrl', 'control'].includes(part)) mods.add('ctrl');
    else if (part === 'shift') mods.add('shift');
    else if (['alt', 'option'].includes(part)) mods.add('alt');
    else key = part;
  }
  return `${[...mods].sort().join('+')}|${key}`;
}

function signatureFromEvent(event) {
  const mods = new Set();
  if (event.metaKey) mods.add('meta');
  if (event.ctrlKey) mods.add('ctrl');
  if (event.shiftKey) mods.add('shift');
  if (event.altKey) mods.add('alt');
  const key = event.key === ' ' ? 'space' : String(event.key).toLowerCase();
  return `${[...mods].sort().join('+')}|${key}`;
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener(
    'keydown',
    (event) => {
      const signature = signatureFromEvent(event);
      const entries = bindings.get(signature);
      if (!entries?.length) return;
      const binding = entries[entries.length - 1];
      if (isTypingTarget(event.target) && !binding.allowInInput) return;
      if (binding.when && !binding.when()) return;
      event.preventDefault();
      binding.run(event);
    },
    { capture: true },
  );
}

/**
 * Registers a shortcut. Later registrations shadow earlier ones, which lets a
 * modal own Escape while it is open and release it on close.
 */
export function bindKey(combo, run, { label = '', group = '通用', when = null, allowInInput = false } = {}) {
  install();
  const signature = normalise(combo);
  const entry = { combo, run, label, group, when, allowInInput };
  const list = bindings.get(signature) || [];
  list.push(entry);
  bindings.set(signature, list);
  return () => {
    const current = bindings.get(signature) || [];
    const index = current.indexOf(entry);
    if (index >= 0) current.splice(index, 1);
    if (!current.length) bindings.delete(signature);
  };
}

export function bindKeys(definitions) {
  const releases = definitions.map(({ combo, run, ...meta }) => bindKey(combo, run, meta));
  return () => releases.forEach((release) => release());
}

/** Human-readable key caps, e.g. ["⌘", "K"]. */
export function keyCaps(combo) {
  return String(combo)
    .split('+')
    .map((part) => {
      const token = part.trim().toLowerCase();
      if (token === 'mod') return MOD_LABEL;
      if (token === 'meta' || token === 'cmd') return '⌘';
      if (token === 'ctrl') return 'Ctrl';
      if (token === 'shift') return '⇧';
      if (token === 'alt') return '⌥';
      if (token === 'enter') return '↵';
      if (token === 'escape' || token === 'esc') return 'Esc';
      if (token === 'arrowup') return '↑';
      if (token === 'arrowdown') return '↓';
      if (token === 'arrowleft') return '←';
      if (token === 'arrowright') return '→';
      if (token === 'space') return 'Space';
      if (token === '/') return '/';
      return token.toUpperCase();
    })
    .filter(Boolean);
}

export function listShortcuts() {
  const all = [];
  for (const entries of bindings.values()) {
    for (const entry of entries) if (entry.label) all.push(entry);
  }
  return all;
}
