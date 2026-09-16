/* ==========================================================================
   overlay.js — drawers, bottom sheets, modals, context menus.
   Selection rules used across the product:
     Drawer  → contextual create/edit flows that keep the list in view
     Sheet   → the same flows on narrow screens
     Modal   → irreversible confirmations only
     Menu    → object-scoped actions (right click or overflow button)
   ========================================================================== */

import { h, icon, setVars, trapFocus, focusFirst, clear } from '../core/dom.js';
import { bindKey } from '../core/keys.js';
import { button, iconButton } from './primitives.js';
import { prefersReducedMotion, shake } from '../core/motion.js';

const overlayRoot = () => document.getElementById('overlay-root');
const stack = [];

function lockScroll() {
  if (stack.length === 1) document.documentElement.style.setProperty('overflow', 'hidden');
}
function unlockScroll() {
  if (!stack.length) document.documentElement.style.removeProperty('overflow');
}

function teardown(entry) {
  const index = stack.indexOf(entry);
  if (index >= 0) stack.splice(index, 1);
  entry.releaseFocus?.();
  entry.releaseKey?.();
  entry.surface.dataset.closing = 'true';
  entry.scrim.dataset.closing = 'true';
  const remove = () => {
    entry.scrim.remove();
    unlockScroll();
  };
  if (prefersReducedMotion()) remove();
  else setTimeout(remove, 240);
  entry.onClosed?.();
}

function mountOverlay({ surface, dismissible = true, onClose = null, labelledBy = null }) {
  const scrim = h('div', { class: 'scrim' });
  const entry = { surface, scrim, onClosed: onClose };

  const close = () => teardown(entry);
  entry.close = close;

  if (dismissible) {
    scrim.addEventListener('pointerdown', (event) => {
      if (event.target === scrim) close();
    });
  }
  scrim.append(surface);
  surface.setAttribute('role', 'dialog');
  surface.setAttribute('aria-modal', 'true');
  if (labelledBy) surface.setAttribute('aria-labelledby', labelledBy);

  overlayRoot().append(scrim);
  stack.push(entry);
  lockScroll();

  entry.releaseFocus = trapFocus(surface);
  entry.releaseKey = bindKey('escape', () => {
    if (stack[stack.length - 1] === entry && dismissible) close();
  }, { label: '关闭当前面板', group: '面板', allowInInput: true });

  requestAnimationFrame(() => focusFirst(surface));
  return { close, surface, scrim };
}

/* --------------------------------------------------------------------------
   Drawer / sheet
   -------------------------------------------------------------------------- */

/**
 * @param {object} config
 * @param {string} config.title
 * @param {string} [config.eyebrow]
 * @param {Node|Node[]} config.body
 * @param {Node[]} [config.footer]
 * @param {number} [config.width]
 */
export function openDrawer({ title, eyebrow = '', description = '', body, footer = [], width = 480, dismissible = true, onClose = null } = {}) {
  const narrow = window.matchMedia('(max-width: 720px)').matches;
  const titleId = `ov-${Math.random().toString(36).slice(2, 8)}`;

  const bodyNode = h('div', { class: 'drawer__body' });
  const footNode = footer.length ? h('footer', { class: 'drawer__foot' }, ...footer) : null;

  const head = h(
    'header',
    { class: 'drawer__head' },
    h(
      'div',
      { class: 'stack-1 spacer' },
      eyebrow ? h('p', { class: 't-label', text: eyebrow }) : null,
      h('h2', { class: 't-h2', id: titleId, text: title }),
      description ? h('p', { class: 't-caption', text: description }) : null,
    ),
    iconButton({ iconName: 'close', label: '关闭', onClick: () => controller.close() }),
  );

  const surface = narrow
    ? h('aside', { class: 'sheet' }, h('span', { class: 'sheet__grip' }), head, bodyNode, footNode)
    : h('aside', { class: 'drawer' }, head, bodyNode, footNode);

  if (!narrow) setVars(surface, { '--drawer-w': `${width}px` });

  const nodes = Array.isArray(body) ? body : [body];
  for (const node of nodes) if (node) bodyNode.append(node);

  const controller = mountOverlay({ surface, dismissible, onClose, labelledBy: titleId });
  controller.body = bodyNode;
  controller.setBody = (...children) => {
    clear(bodyNode);
    for (const child of children.flat()) if (child) bodyNode.append(child);
  };
  controller.setFooter = (...children) => {
    if (!footNode) return;
    clear(footNode);
    for (const child of children.flat()) if (child) footNode.append(child);
  };
  return controller;
}

/* --------------------------------------------------------------------------
   Modal — reserved for confirmation of consequential writes
   -------------------------------------------------------------------------- */
export function openModal({ title, body, footer = [], width = 440, dismissible = true, onClose = null, tone = 'neutral' } = {}) {
  const titleId = `ov-${Math.random().toString(36).slice(2, 8)}`;
  const surface = h(
    'div',
    { class: 'modal' },
    h(
      'header',
      { class: 'drawer__head' },
      h(
        'div',
        { class: 'row-3 spacer' },
        tone !== 'neutral'
          ? h('span', { class: ['state__art', 'modal__art'].join(' ') }, icon(tone === 'danger' ? 'alert' : 'info', 'ico ico--sm'))
          : null,
        h('h2', { class: 't-h3', id: titleId, text: title }),
      ),
      iconButton({ iconName: 'close', label: '关闭', onClick: () => controller.close() }),
    ),
    h('div', { class: 'modal__body' }, ...(Array.isArray(body) ? body : [body])),
    footer.length ? h('footer', { class: 'modal__foot' }, ...footer) : null,
  );
  setVars(surface, { '--modal-w': `${width}px` });
  const controller = mountOverlay({ surface, dismissible, onClose, labelledBy: titleId });
  return controller;
}

/**
 * Replaces window.confirm. Resolves true/false and supports a typed
 * confirmation phrase for destructive operations.
 */
export function confirmAction({
  title,
  description = '',
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'neutral',
  requirePhrase = null,
  details = [],
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      controller.close();
    };

    const phraseField = requirePhrase
      ? h('input', { class: 'input', placeholder: `输入 ${requirePhrase} 以确认`, autocomplete: 'off' })
      : null;

    const confirmButton = button({
      label: confirmLabel,
      variant: tone === 'danger' ? 'danger' : 'primary',
      onClick: () => {
        if (requirePhrase && phraseField.value.trim() !== requirePhrase) {
          shake(phraseField);
          phraseField.focus();
          return;
        }
        finish(true);
      },
    });

    const controller = openModal({
      title,
      tone,
      body: [
        description ? h('p', { class: 't-secondary' }, h('span', { text: description })) : null,
        details.length
          ? h('div', { class: 'stack-2' }, ...details.map((item) => (item instanceof Node ? item : h('p', { class: 't-caption', text: String(item) }))))
          : null,
        phraseField
          ? h('div', { class: 'stack-2' }, h('p', { class: 'field__label', text: '二次确认' }), phraseField)
          : null,
      ].filter(Boolean),
      footer: [
        button({ label: cancelLabel, variant: 'ghost', onClick: () => finish(false) }),
        h('span', { class: 'spacer' }),
        confirmButton,
      ],
      onClose: () => finish(false),
    });
  });
}

/* --------------------------------------------------------------------------
   Context menu — right click and overflow buttons share one implementation
   -------------------------------------------------------------------------- */
let openMenu = null;

export function closeMenu() {
  if (!openMenu) return;
  openMenu.release();
  openMenu.node.remove();
  openMenu = null;
}

/**
 * @param {{x:number,y:number}} position
 * @param {Array} items  {label, iconName, keys, onSelect, variant, disabled} or {separator:true} or {label, heading:true}
 */
export function showMenu(position, items) {
  closeMenu();
  const node = h('div', { class: 'menu', attrs: { role: 'menu' } });

  const actionable = [];
  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      node.append(h('div', { class: 'menu__sep' }));
      continue;
    }
    if (item.heading) {
      node.append(h('p', { class: 'menu__label t-label', text: item.label }));
      continue;
    }
    const entry = h(
      'button',
      {
        class: 'menu__item',
        type: 'button',
        attrs: { role: 'menuitem' },
        data: { variant: item.variant || null },
        disabled: item.disabled || undefined,
        on: {
          click: () => {
            closeMenu();
            item.onSelect?.();
          },
          pointerenter: (event) => {
            actionable.forEach((n) => delete n.dataset.active);
            event.currentTarget.dataset.active = 'true';
          },
        },
      },
      item.iconName ? icon(item.iconName, 'ico ico--sm') : null,
      h('span', { text: item.label }),
      item.keys ? h('span', { class: 'menu__kbd', text: item.keys }) : null,
    );
    actionable.push(entry);
    node.append(entry);
  }

  document.body.append(node);
  const rect = node.getBoundingClientRect();
  const left = Math.min(position.x, window.innerWidth - rect.width - 8);
  const top = Math.min(position.y, window.innerHeight - rect.height - 8);
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;
  setVars(node, { '--origin': `${top < position.y ? 'bottom' : 'top'} left` });

  let index = -1;
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      index = event.key === 'ArrowDown' ? (index + 1) % actionable.length : (index - 1 + actionable.length) % actionable.length;
      actionable.forEach((n, i) => {
        if (i === index) n.dataset.active = 'true';
        else delete n.dataset.active;
      });
      return;
    }
    if (event.key === 'Enter' && index >= 0) {
      event.preventDefault();
      actionable[index].click();
    }
  };
  const onPointerDown = (event) => {
    if (!node.contains(event.target)) closeMenu();
  };

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('blur', closeMenu);
  const release = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', closeMenu);
  };

  openMenu = { node, release };
  return closeMenu;
}

/** Attaches a right-click menu to a container using delegation. */
export function attachContextMenu(container, selector, buildItems) {
  const handler = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (!target) return;
    const items = buildItems(target, event);
    if (!items?.length) return;
    event.preventDefault();
    showMenu({ x: event.clientX, y: event.clientY }, items);
  };
  container.addEventListener('contextmenu', handler);
  return () => container.removeEventListener('contextmenu', handler);
}

/** Anchors a menu underneath a trigger button. */
export function menuFromTrigger(trigger, items) {
  const rect = trigger.getBoundingClientRect();
  return showMenu({ x: rect.left, y: rect.bottom + 6 }, items);
}
