/* ==========================================================================
   dom.js — element factory, icon system, CSP-safe style application
   The server sends `style-src 'self'`, so inline style attributes are never
   used: every dynamic value is written through CSSOM (style.setProperty).
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'defs', 'clipPath', 'linearGradient', 'stop', 'use', 'tspan']);

/**
 * Hyperscript element factory.
 * props: { class, text, html, on:{}, attrs:{}, data:{}, aria:{}, vars:{}, ref }
 */
export function h(tag, props = null, ...children) {
  const node = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      switch (key) {
        case 'class':
          node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
          break;
        case 'text':
          node.textContent = String(value);
          break;
        case 'html':
          node.innerHTML = String(value);
          break;
        case 'on':
          for (const [type, handler] of Object.entries(value)) {
            if (typeof handler === 'function') node.addEventListener(type, handler);
            else if (handler) node.addEventListener(type, handler.handler, handler.options);
          }
          break;
        case 'attrs':
          for (const [name, val] of Object.entries(value)) setAttr(node, name, val);
          break;
        case 'data':
          for (const [name, val] of Object.entries(value)) {
            if (val === null || val === undefined || val === false) continue;
            node.dataset[name] = String(val);
          }
          break;
        case 'aria':
          for (const [name, val] of Object.entries(value)) setAttr(node, `aria-${name}`, val);
          break;
        case 'vars':
          setVars(node, value);
          break;
        case 'ref':
          if (typeof value === 'function') value(node);
          break;
        default:
          setAttr(node, key, value);
      }
    }
  }
  append(node, children);
  return node;
}

function setAttr(node, name, value) {
  if (value === null || value === undefined || value === false) {
    node.removeAttribute(name);
    return;
  }
  if (value === true) {
    node.setAttribute(name, '');
    return;
  }
  node.setAttribute(name, String(value));
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

/** CSS custom properties — the only sanctioned channel for dynamic styling. */
export function setVars(node, vars) {
  for (const [name, value] of Object.entries(vars)) {
    if (value === null || value === undefined) node.style.removeProperty(name.startsWith('--') ? name : `--${name}`);
    else node.style.setProperty(name.startsWith('--') ? name : `--${name}`, String(value));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function fill(node, ...children) {
  clear(node);
  return append(node, children);
}

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}

export function on(node, type, handler, options) {
  node.addEventListener(type, handler, options);
  return () => node.removeEventListener(type, handler, options);
}

/** Event delegation — keeps handler count flat for long lists. */
export function delegate(root, type, selector, handler) {
  return on(root, type, (event) => {
    const match = event.target instanceof Element ? event.target.closest(selector) : null;
    if (match && root.contains(match)) handler(event, match);
  });
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function focusFirst(scope) {
  // Prefer an explicit target, then a real input, and only then a button so
  // opening a drawer lands the caret where typing is expected.
  const target =
    scope.querySelector('[data-autofocus]') ||
    scope.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])') ||
    scope.querySelector('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
  if (target) target.focus();
}

/** Focus trap for modal surfaces. Returns a release function. */
export function trapFocus(scope) {
  const previous = document.activeElement;
  const handler = (event) => {
    if (event.key !== 'Tab') return;
    const nodes = qsa('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', scope)
      .filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  scope.addEventListener('keydown', handler);
  return () => {
    scope.removeEventListener('keydown', handler);
    if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
  };
}

/* ==========================================================================
   Icon system — a single stroke-based geometric set, no emoji anywhere
   ========================================================================== */
const ICONS = {
  dashboard: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  gauge: ['M4 18a8 8 0 1 1 16 0', 'M12 18l4.2-6.2'],
  box: ['M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z', 'M3.5 7.5 12 12l8.5-4.5', 'M12 12v9'],
  calendar: ['M4 6.5h16v14H4z', 'M8 3.5v5', 'M16 3.5v5', 'M4 11.5h16'],
  heart: ['M12 20.2S4.8 15.9 4.8 10.9A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7.2 2.7c0 5-7.2 9.3-7.2 9.3z'],
  megaphone: ['M4 10v4.2l12 3.8V6.2z', 'M16 8.6h1.8a3 3 0 0 1 0 6.8H16', 'M7.4 14.7V19.5'],
  link: ['M10.5 13.5 13.5 10.5', 'M9.5 15.5a3.2 3.2 0 0 1 0-4.5l2-2', 'M14.5 8.5a3.2 3.2 0 0 1 0 4.5l-2 2'],
  table: ['M3.5 5h17v14h-17z', 'M3.5 10h17', 'M3.5 15h17', 'M9.5 5v14'],
  settings: ['M12 9.4a2.6 2.6 0 1 0 0 5.2a2.6 2.6 0 1 0 0-5.2', 'M12 3.2v2.6', 'M12 18.2v2.6', 'M4.6 7.4l2.3 1.3', 'M17.1 15.3l2.3 1.3', 'M4.6 16.6l2.3-1.3', 'M17.1 8.7l2.3-1.3'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14', 'M16.1 16.1 21 21'],
  bell: ['M7 10.3a5 5 0 0 1 10 0c0 3.9 1.5 5.4 1.5 5.4h-13s1.5-1.5 1.5-5.4z', 'M10.2 19a2 2 0 0 0 3.6 0'],
  check: ['M5 12.6 9.6 17.2 19 7.4'],
  close: ['M6.2 6.2 17.8 17.8', 'M17.8 6.2 6.2 17.8'],
  chevronRight: ['M9.6 5.6 16 12l-6.4 6.4'],
  chevronLeft: ['M14.4 5.6 8 12l6.4 6.4'],
  chevronDown: ['M5.6 9.6 12 16l6.4-6.4'],
  chevronUp: ['M5.6 14.4 12 8l6.4 6.4'],
  arrowRight: ['M4 12h15', 'M13.4 6.6 19.8 12l-6.4 5.4'],
  arrowUp: ['M12 20V4.6', 'M6.6 10 12 4.6 17.4 10'],
  arrowDown: ['M12 4v15.4', 'M6.6 14 12 19.4 17.4 14'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  alert: ['M12 3.8 21 19.4H3z', 'M12 10v4.2', 'M12 16.8v.2'],
  info: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', 'M12 11v5.2', 'M12 8.1v.2'],
  clock: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', 'M12 7.8v4.6l3.2 1.9'],
  pin: ['M12 20.8s5.9-5.6 5.9-9.8a5.9 5.9 0 1 0-11.8 0c0 4.2 5.9 9.8 5.9 9.8z', 'M12 9.1a2.1 2.1 0 1 0 0 4.2a2.1 2.1 0 1 0 0-4.2'],
  user: ['M12 4.4a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 1 0 0-7.2', 'M4.8 20c0-3.4 3.2-5.6 7.2-5.6s7.2 2.2 7.2 5.6'],
  users: ['M9 4.8a3.1 3.1 0 1 0 0 6.2a3.1 3.1 0 1 0 0-6.2', 'M2.4 20c0-3 3-5.1 6.6-5.1s6.6 2.1 6.6 5.1', 'M16.2 5.3a3.1 3.1 0 0 1 0 5.2', 'M17.8 15.2c2.4.7 3.9 2.4 3.9 4.8'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2.6v2.6H14z', 'M19.6 14H21.8', 'M14 19.6v2.2', 'M18 18h3.8v3.8H18z'],
  download: ['M12 4v11.2', 'M7.4 11 12 15.6 16.6 11', 'M4.6 19.6h14.8'],
  upload: ['M12 15.6V4.4', 'M7.4 9 12 4.4 16.6 9', 'M4.6 19.6h14.8'],
  refresh: ['M20.2 12a8.2 8.2 0 1 1-2.7-6.1', 'M20.2 4v4.2h-4.2'],
  external: ['M14 4.6h5.4V10', 'M19.4 4.6 11 13', 'M18 14v5.4H4.6V6h5.4'],
  filter: ['M4 6.6h16', 'M7 12h10', 'M10 17.4h4'],
  sortArrow: ['M12 18.4V5.6', 'M7.6 10 12 5.6 16.4 10'],
  kanban: ['M4 4.6h4.4v14.8H4z', 'M10.8 4.6h4.4v9.2h-4.4z', 'M17.6 4.6H21v12.2h-3.4z'],
  shield: ['M12 3.4 19.6 6v6.1c0 4.2-3.3 7.4-7.6 8.5-4.3-1.1-7.6-4.3-7.6-8.5V6z', 'M9.1 12.2 11.3 14.5 15.3 10'],
  file: ['M6 3.6h7L18.4 9v11.4H6z', 'M12.8 3.6V9h5.6'],
  image: ['M4 5.6h16v12.8H4z', 'M4 15l4.6-4 4 3.4 3.4-3.2 4 3.4', 'M8.4 9.6a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 1 0 0-2.6'],
  send: ['M21 3.8 3 11l7.1 3 3 7z', 'M10.1 14 14 10.1'],
  edit: ['M15.4 5.4 18.6 8.6 9 18.2H5.8v-3.2z', 'M13.4 7.4 16.6 10.6'],
  trash: ['M5.4 7.4h13.2', 'M9 7.4V4.8h6v2.6', 'M7 7.4 7.8 20h8.4L17 7.4'],
  logout: ['M14 5.4H5.8v13.2H14', 'M10.8 12h9.4', 'M16.6 8 20.6 12l-4 4'],
  lock: ['M6.4 10.4h11.2V20H6.4z', 'M9 10.4V8a3 3 0 0 1 6 0v2.4'],
  sparkle: ['M12 3.8 13.9 9 19.2 10.8 13.9 12.6 12 17.8 10.1 12.6 4.8 10.8 10.1 9z'],
  flow: ['M4.4 6.4h5', 'M14.6 6.4h5', 'M4.4 17.6h5', 'M14.6 17.6h5', 'M12 6.4v11.2'],
  list: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
  inbox: ['M3.6 12 6.2 5h11.6L20.4 12v7.4H3.6z', 'M3.6 12h4.8l1 2.6h5.2l1-2.6h4.8'],
  activity: ['M3.4 13h4L10 5.8l3.6 12.4L16.2 13h4.4'],
  scan: ['M4 8.4V4.6h3.8', 'M20 8.4V4.6h-3.8', 'M4 15.6v3.8h3.8', 'M20 15.6v3.8h-3.8', 'M4 12h16'],
  door: ['M6.4 20.2V4.4h8v15.8', 'M14.4 11.4h3.8v8.8', 'M9.8 12v.2'],
  copy: ['M8.6 8.6h10.8v10.8H8.6z', 'M15.4 5.4H4.6v10.8'],
  help: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', 'M9.8 9.6a2.3 2.3 0 1 1 3.1 2.1c-.6.3-.9.9-.9 1.6', 'M12 16.6v.2'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  sidebar: ['M3.6 5h16.8v14H3.6z', 'M9.6 5v14'],
  eye: ['M2.8 12S6.2 6.4 12 6.4 21.2 12 21.2 12 17.8 17.6 12 17.6 2.8 12 2.8 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5'],
  star: ['M12 4.4 14.3 9.3 19.6 10 15.7 13.8l1 5.3L12 16.5l-4.7 2.6 1-5.3L4.4 10l5.3-.7z'],
  bolt: ['M13.4 3.6 6.6 13.4h4.4l-1.4 7 7.4-10h-4.4z'],
  target: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', 'M12 8.4a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 1 0 0-7.2', 'M12 11.4v1.2'],
  mail: ['M3.6 6h16.8v12H3.6z', 'M3.6 6.8 12 13l8.4-6.2'],
  cube: ['M12 3.4 20 7.6v8.8L12 20.6 4 16.4V7.6z', 'M4 7.6 12 12l8-4.4', 'M12 12v8.6'],
  archive: ['M3.6 5h16.8v4H3.6z', 'M5.4 9v10h13.2V9', 'M9.6 13h4.8'],
  handshake: ['M3.6 10.4 7.4 7l3.4 2.6 2.4-2.4 3.4 3.2', 'M3.6 10.4 8.8 16l2-1.8 2 1.8 5.2-5.6', 'M20.4 10.4 17 7'],
};

export function icon(name, className = 'ico') {
  const paths = ICONS[name] || ICONS.info;
  const svg = h('svg', { class: className, attrs: { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' } });
  for (const d of paths) svg.append(h('path', { attrs: { d } }));
  return svg;
}

export function hasIcon(name) {
  return Boolean(ICONS[name]);
}
