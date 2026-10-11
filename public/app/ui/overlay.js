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
let backgroundWasInert = false;

function syncInteractivity() {
  const background = document.getElementById('root');
  if (background) background.inert = stack.length ? true : backgroundWasInert;
  stack.forEach((entry, index) => { entry.scrim.inert = index !== stack.length - 1; });
}

function lockScroll() {
  if (stack.length === 1) document.documentElement.style.setProperty('overflow', 'hidden');
}
function unlockScroll() {
  if (!stack.length) document.documentElement.style.removeProperty('overflow');
}

function teardown(entry) {
  if (entry.closed) return;
  entry.closed = true;
  const index = stack.indexOf(entry);
  if (index >= 0) stack.splice(index, 1);
  syncInteractivity();
  entry.scrim.inert = true;
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

export function mountOverlay({ surface, dismissible = true, onClose = null, labelledBy = null, scrimClass = 'scrim' }) {
  closeMenu();
  const scrim = h('div', { class: scrimClass });
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

  entry.releaseFocus = trapFocus(surface);
  overlayRoot().append(scrim);
  if (!stack.length) backgroundWasInert = document.getElementById('root')?.inert || false;
  stack.push(entry);
  syncInteractivity();
  lockScroll();

  entry.releaseKey = bindKey('escape', () => {
    if (stack[stack.length - 1] === entry && dismissible) close();
  }, { label: '关闭当前面板', group: '面板', allowInInput: true });

  requestAnimationFrame(() => { if (!entry.closed && stack.at(-1) === entry && !surface.contains(document.activeElement)) focusFirst(surface); });
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

export function closeMenu({ restoreFocus = true } = {}) {
  if (!openMenu) return;
  const menu = openMenu;
  openMenu = null;
  menu.release();
  menu.node.remove();
  if (restoreFocus && menu.trigger?.isConnected) menu.trigger.focus({ preventScroll: true });
}

/**
 * @param {{x:number,y:number}} position
 * @param {Array} items  {label, iconName, keys, onSelect, variant, disabled} or {separator:true} or {label, heading:true}
 */
export function showMenu(position, items, trigger = document.activeElement) {
  closeMenu();
  const node = h('div', { class: 'menu', attrs: { role: 'menu' } });
  const menuButton = trigger?.matches('button, [role="button"]') ? trigger : null;

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
        tabindex: '-1',
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
    if (!item.disabled) actionable.push(entry);
    node.append(entry);
  }

  document.body.append(node);
  // Layout dimensions exclude the opening animation transform.
  const left = Math.min(position.x, document.documentElement.clientWidth - node.offsetWidth - 8);
  const top = Math.min(position.y, window.innerHeight - node.offsetHeight - 8);
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;
  setVars(node, { '--origin': `${top < position.y ? 'bottom' : 'top'} left` });

  let index = 0;
  const focusItem = (next) => {
    if (!actionable.length) return;
    index = (next + actionable.length) % actionable.length;
    actionable.forEach((entry, i) => {
      if (i === index) entry.dataset.active = 'true';
      else delete entry.dataset.active;
    });
    actionable[index].focus({ preventScroll: true });
    actionable[index].scrollIntoView({ block: 'nearest' });
  };
  const releaseEscape = bindKey('escape', (event) => {
    event.stopImmediatePropagation();
    closeMenu();
  }, { allowInInput: true });
  const onKey = (event) => {
    if (event.key === 'Tab') {
      closeMenu();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const focused = actionable.indexOf(document.activeElement);
      if (focused >= 0) index = focused;
      focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? actionable.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
    }
    // Enter and Space activate the actually focused button natively.
  };
  const onPointerDown = (event) => {
    if (!node.contains(event.target)) closeMenu({ restoreFocus: false });
  };

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  const dismiss = () => closeMenu({ restoreFocus: false });
  window.addEventListener('blur', dismiss);
  window.addEventListener('resize', dismiss);
  const release = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', dismiss);
    window.removeEventListener('resize', dismiss);
    releaseEscape();
    menuButton?.setAttribute('aria-expanded', 'false');
  };

  openMenu = { node, release, trigger };
  menuButton?.setAttribute('aria-haspopup', 'menu');
  menuButton?.setAttribute('aria-expanded', 'true');
  focusItem(0);
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
  return showMenu({ x: rect.left, y: rect.bottom + 6 }, items, trigger);
}
