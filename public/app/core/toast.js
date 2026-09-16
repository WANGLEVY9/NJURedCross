/* ==========================================================================
   toast.js — stacked notifications with progress, actions and de-duplication.
   Replaces alert()/confirm() entirely.
   ========================================================================== */

import { h, icon, setVars } from './dom.js';
import { prefersReducedMotion } from './motion.js';

const ICON_BY_TONE = { success: 'check', warning: 'alert', error: 'alert', info: 'info', neutral: 'info' };
const DEFAULT_DURATION = { success: 3600, info: 4200, warning: 6000, error: 8000, neutral: 4200 };
const MAX_STACK = 4;

let root = null;
const live = new Map();

function ensureRoot() {
  if (!root) root = document.getElementById('toast-root');
  return root;
}

function dismiss(node) {
  if (!node || node.dataset.closing === 'true') return;
  node.dataset.closing = 'true';
  const key = node.dataset.key;
  if (key) live.delete(key);
  const remove = () => node.remove();
  if (prefersReducedMotion()) remove();
  else setTimeout(remove, 220);
}

/**
 * @param {object} options
 * @param {'success'|'warning'|'error'|'info'|'neutral'} [options.tone]
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {{label:string,onClick:Function}} [options.action]
 * @param {number|null} [options.duration] null keeps it until dismissed
 * @param {string} [options.key] identical keys replace instead of stacking
 */
export function toast({ tone = 'neutral', title, description = '', action = null, duration, key = '' } = {}) {
  const host = ensureRoot();
  if (!host || !title) return () => {};

  const dedupeKey = key || `${tone}:${title}`;
  const existing = live.get(dedupeKey);
  if (existing) dismiss(existing);

  while (host.children.length >= MAX_STACK) dismiss(host.firstElementChild);

  const ttl = duration === undefined ? DEFAULT_DURATION[tone] : duration;

  const node = h(
    'div',
    { class: ['toast', `toast--${tone}`], attrs: { role: tone === 'error' ? 'alert' : 'status' }, data: { key: dedupeKey } },
    h('span', { class: 'toast__icon' }, icon(ICON_BY_TONE[tone] || 'info', 'ico ico--sm')),
    h(
      'div',
      { class: 'toast__text' },
      h('b', { class: 't-secondary t-strong', text: title }),
      description ? h('p', { class: 't-caption', text: description }) : null,
    ),
    h(
      'div',
      { class: 'row-2' },
      action
        ? h('button', {
            class: 'btn btn--sm btn--ghost',
            type: 'button',
            text: action.label,
            on: {
              click: () => {
                action.onClick?.();
                dismiss(node);
              },
            },
          })
        : null,
      h('button', {
        class: 'icon-btn',
        type: 'button',
        aria: { label: '关闭通知' },
        on: { click: () => dismiss(node) },
      }, icon('close', 'ico ico--sm')),
    ),
  );

  if (ttl) {
    const bar = h('span', { class: 'toast__bar' });
    setVars(bar, { '--dur': `${ttl}ms` });
    bar.style.animationDuration = `${ttl}ms`;
    node.append(bar);
    let timer = setTimeout(() => dismiss(node), ttl);
    node.addEventListener('pointerenter', () => {
      clearTimeout(timer);
      bar.style.animationPlayState = 'paused';
    });
    node.addEventListener('pointerleave', () => {
      bar.style.animationPlayState = 'running';
      timer = setTimeout(() => dismiss(node), 1200);
    });
  }

  live.set(dedupeKey, node);
  host.append(node);
  return () => dismiss(node);
}

export const notify = {
  success: (title, description, extra) => toast({ tone: 'success', title, description, ...extra }),
  info: (title, description, extra) => toast({ tone: 'info', title, description, ...extra }),
  warning: (title, description, extra) => toast({ tone: 'warning', title, description, ...extra }),
  error: (title, description, extra) => toast({ tone: 'error', title, description, ...extra }),
};

/** Normalises an ApiError into a user-facing toast. */
export function reportError(error, fallbackTitle = '操作未完成') {
  if (error?.name === 'AbortError') return;
  const offline = error?.status === 0;
  notify.error(offline ? '网络连接中断' : fallbackTitle, error?.message || '请稍后重试，或联系平台管理员。', {
    duration: 8000,
  });
}
