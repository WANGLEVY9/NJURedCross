/* ==========================================================================
   motion.js — the platform motion system.
   Rules: animate transform/opacity only, respect prefers-reduced-motion,
   keep durations inside 90–620ms, and never animate for decoration alone.
   ========================================================================== */

import { setVars, qsa } from './dom.js';

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reduceQuery.matches;

export const DUR = { instant: 90, fast: 140, base: 200, slow: 280, slower: 380, reveal: 620 };
export const EASE = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.45, 0, 0.25, 1)',
  spring: 'cubic-bezier(0.34, 1.42, 0.52, 1)',
};

/* --------------------------------------------------------------------------
   Pointer-reactive surfaces
   -------------------------------------------------------------------------- */

/** Faint radial highlight that follows the cursor across a panel. */
export function spotlight(node) {
  if (prefersReducedMotion()) return () => {};
  let frame = 0;
  const move = (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      setVars(node, { '--px': `${((event.clientX - rect.left) / rect.width) * 100}%`, '--py': `${((event.clientY - rect.top) / rect.height) * 100}%` });
    });
  };
  node.addEventListener('pointermove', move);
  return () => {
    node.removeEventListener('pointermove', move);
    cancelAnimationFrame(frame);
  };
}

/** Magnetic attraction for a primary action — subtle, max 3px. */
export function magnetic(node, strength = 3) {
  if (prefersReducedMotion()) return () => {};
  const move = (event) => {
    const rect = node.getBoundingClientRect();
    const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    setVars(node, { '--btn-dx': `${Math.max(-1, Math.min(1, dx)) * strength}px`, '--btn-dy': `${Math.max(-1, Math.min(1, dy)) * strength}px` });
  };
  const reset = () => setVars(node, { '--btn-dx': '0px', '--btn-dy': '0px' });
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', reset);
  return () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerleave', reset);
  };
}

/**
 * Very shallow pointer parallax. `layers` maps a CSS variable pair to depth.
 * Depth is capped so the effect reads as air, not as movement.
 */
export function parallax(node, layers) {
  if (prefersReducedMotion()) return () => {};
  let frame = 0;
  const move = (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const nx = event.clientX / window.innerWidth - 0.5;
      const ny = event.clientY / window.innerHeight - 0.5;
      for (const layer of layers) {
        setVars(layer.target || node, {
          [layer.x]: `${(-nx * layer.depth).toFixed(2)}px`,
          [layer.y]: `${(-ny * layer.depth).toFixed(2)}px`,
        });
      }
    });
  };
  window.addEventListener('pointermove', move, { passive: true });
  return () => {
    window.removeEventListener('pointermove', move);
    cancelAnimationFrame(frame);
  };
}

/* --------------------------------------------------------------------------
   Animated counters
   -------------------------------------------------------------------------- */

/** Rolls a number towards its target so data changes are perceptible. */
export function countTo(node, target, { duration = DUR.reveal, format = (v) => String(Math.round(v)), from = null } = {}) {
  const end = Number(target) || 0;
  const start = from === null ? Number(String(node.textContent).replace(/[^\d.-]/g, '')) || 0 : from;
  if (prefersReducedMotion() || start === end) {
    node.textContent = format(end);
    return () => {};
  }
  const t0 = performance.now();
  let raf = 0;
  const tick = (now) => {
    const progress = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = format(start + (end - start) * eased);
    if (progress < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Runs counters once the element scrolls into view. */
export function countOnVisible(root) {
  const nodes = qsa('[data-count]', root);
  if (!nodes.length) return () => {};
  const run = (node) => {
    const target = Number(node.dataset.count) || 0;
    const decimals = Number(node.dataset.countDecimals || 0);
    const formatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    countTo(node, target, { format: (value) => formatter.format(value) });
  };
  if (!('IntersectionObserver' in window)) {
    nodes.forEach(run);
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      run(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.2 });
  nodes.forEach((node) => observer.observe(node));
  return () => observer.disconnect();
}

/* --------------------------------------------------------------------------
   Layout transitions (FLIP) — used for filtering, sorting, reordering
   -------------------------------------------------------------------------- */

export function captureRects(nodes) {
  const map = new Map();
  for (const node of nodes) {
    const key = node.dataset.flipKey;
    if (key) map.set(key, node.getBoundingClientRect());
  }
  return map;
}

export function playFlip(nodes, previous, { duration = DUR.slower } = {}) {
  if (prefersReducedMotion()) return;
  for (const node of nodes) {
    const key = node.dataset.flipKey;
    const before = key ? previous.get(key) : null;
    const after = node.getBoundingClientRect();
    if (!before) {
      node.animate([{ opacity: 0, transform: 'translateY(8px) scale(0.99)' }, { opacity: 1, transform: 'none' }], { duration, easing: EASE.out });
      continue;
    }
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: EASE.out });
  }
}

/** Marks children with a --i index so CSS can stagger their entrance. */
export function stagger(container, selector = ':scope > *') {
  qsa(selector, container).forEach((node, index) => setVars(node, { '--i': index }));
  container.classList.add('stagger');
  return container;
}

/* --------------------------------------------------------------------------
   View transitions
   -------------------------------------------------------------------------- */

/** Cross-fades a container's contents instead of snapping the DOM. */
export async function swapView(container, nextNode, { direction = 1 } = {}) {
  const current = container.firstElementChild;
  if (!current || prefersReducedMotion()) {
    container.replaceChildren(nextNode);
    return;
  }
  const out = current.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-6 * direction}px)` }],
    { duration: DUR.fast, easing: EASE.inOut, fill: 'forwards' },
  );
  await out.finished.catch(() => {});
  container.replaceChildren(nextNode);
  nextNode.animate(
    [{ opacity: 0, transform: `translateY(${8 * direction}px)` }, { opacity: 1, transform: 'none' }],
    { duration: DUR.slow, easing: EASE.out },
  );
}

/**
 * Shared-element transition: expands the clicked card's geometry into the
 * destination surface so a list → detail navigation feels continuous.
 */
export function rememberOrigin(node) {
  if (!node || prefersReducedMotion()) return null;
  const rect = node.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function expandFromOrigin(node, origin) {
  if (!node || !origin || prefersReducedMotion()) return;
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scaleX = Math.max(0.2, Math.min(2, origin.width / rect.width));
  const scaleY = Math.max(0.2, Math.min(2, origin.height / rect.height));
  node.animate(
    [
      {
        transformOrigin: 'top left',
        transform: `translate(${origin.left - rect.left}px, ${origin.top - rect.top}px) scale(${scaleX}, ${scaleY})`,
        opacity: 0.55,
      },
      { transformOrigin: 'top left', transform: 'none', opacity: 1 },
    ],
    { duration: DUR.slower, easing: EASE.out },
  );
}

/** Collapses a node before removing it from the flow. */
export async function collapseOut(node) {
  if (prefersReducedMotion()) {
    node.remove();
    return;
  }
  const height = node.getBoundingClientRect().height;
  const animation = node.animate(
    [
      { opacity: 1, transform: 'none', maxHeight: `${height}px` },
      { opacity: 0, transform: 'translateX(12px)', maxHeight: '0px' },
    ],
    { duration: DUR.slow, easing: EASE.inOut, fill: 'forwards' },
  );
  await animation.finished.catch(() => {});
  node.remove();
}

/** Short attention nudge for validation failures. */
export function shake(node) {
  if (prefersReducedMotion()) return;
  node.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
    { duration: 260, easing: EASE.inOut },
  );
}

/** A single confirming pulse after an optimistic update lands. */
export function pulse(node) {
  if (prefersReducedMotion()) return;
  node.animate(
    [{ boxShadow: '0 0 0 0 var(--accent-ring)' }, { boxShadow: '0 0 0 6px transparent' }],
    { duration: DUR.reveal, easing: EASE.out },
  );
}
