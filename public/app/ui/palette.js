/* ==========================================================================
   palette.js — ⌘K command palette doubling as spotlight search.
   Sources are registered by the shell, so the palette always reflects what the
   current surface can actually do.
   ========================================================================== */

import { h, icon, trapFocus, clear } from '../core/dom.js';
import { bindKey, keyCaps } from '../core/keys.js';
import { prefersReducedMotion } from '../core/motion.js';
import { prefs } from '../core/store.js';

const RECENT_KEY = 'palette.recent';
const providers = [];
let instance = null;

/**
 * @param {() => Array<{id,title,subtitle,group,iconName,keywords,keys,run}>} provider
 * Static providers run synchronously; async providers may return a promise.
 */
export function registerCommands(provider) {
  providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

export function clearCommands() {
  providers.length = 0;
}

function score(item, query) {
  if (!query) return 1;
  const haystack = `${item.title} ${item.subtitle || ''} ${(item.keywords || []).join(' ')} ${item.group || ''}`.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.includes(needle)) return 100 - haystack.indexOf(needle);
  // fuzzy: every character of the query must appear in order
  let cursor = 0;
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor === -1) return 0;
    cursor += 1;
  }
  return 10;
}

function rememberUse(id) {
  const recent = prefs.get(RECENT_KEY, []);
  const next = [id, ...recent.filter((entry) => entry !== id)].slice(0, 6);
  prefs.set(RECENT_KEY, next);
}

export async function openPalette({ initialQuery = '' } = {}) {
  if (instance) {
    instance.input.focus();
    instance.input.select();
    return instance;
  }

  const collected = [];
  for (const provider of providers) {
    try {
      const result = await provider();
      if (Array.isArray(result)) collected.push(...result.filter(Boolean));
    } catch {
      /* a failing provider must not break the palette */
    }
  }

  const recent = prefs.get(RECENT_KEY, []);
  const input = h('input', {
    type: 'text',
    value: initialQuery,
    placeholder: '搜索页面、执行操作、跳转对象…',
    autocomplete: 'off',
    spellcheck: 'false',
    attrs: { 'aria-label': '命令面板搜索', role: 'combobox', 'aria-expanded': 'true' },
  });

  const list = h('div', { class: 'palette__list', attrs: { role: 'listbox' } });
  const palette = h(
    'div',
    { class: 'palette', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' } },
    h('div', { class: 'palette__search' }, icon('search', 'ico'), input, h('span', { class: 'kbd', text: 'Esc' })),
    list,
    h(
      'footer',
      { class: 'palette__foot' },
      h('span', { class: 'row-2' }, h('span', { class: 'kbd', text: '↑' }), h('span', { class: 'kbd', text: '↓' }), h('span', { class: 't-caption', text: '选择' })),
      h('span', { class: 'row-2' }, h('span', { class: 'kbd', text: '↵' }), h('span', { class: 't-caption', text: '执行' })),
      h('span', { class: 'spacer' }),
      h('span', { class: 't-caption t-faint', text: '南京大学红十字会平台' }),
    ),
  );

  const scrim = h('div', { class: 'palette-scrim' });
  scrim.append(palette);
  document.getElementById('overlay-root').append(scrim);

  let items = [];
  let active = 0;

  const close = () => {
    if (!instance) return;
    instance = null;
    releaseFocus();
    releaseKey();
    scrim.dataset.closing = 'true';
    const remove = () => scrim.remove();
    if (prefersReducedMotion()) remove();
    else setTimeout(remove, 160);
  };

  const run = (item) => {
    rememberUse(item.id);
    close();
    item.run?.();
  };

  const render = () => {
    const query = input.value.trim();
    const ranked = collected
      .map((item) => ({ item, weight: score(item, query) }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => {
        if (!query) {
          const ra = recent.indexOf(a.item.id);
          const rb = recent.indexOf(b.item.id);
          if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
        }
        return b.weight - a.weight;
      })
      .map((entry) => entry.item)
      .slice(0, 40);

    items = ranked;
    active = 0;
    clear(list);

    if (!ranked.length) {
      list.append(
        h(
          'div',
          { class: 'stack-2', attrs: { role: 'presentation' } },
          h('p', { class: 'palette__group t-label', text: '没有匹配结果' }),
          h('p', { class: 'palette__item t-caption', text: `没有与「${query}」匹配的页面或操作，可尝试更短的关键词。` }),
        ),
      );
      return;
    }

    let lastGroup = null;
    ranked.forEach((item, index) => {
      const group = query ? '搜索结果' : recent.includes(item.id) ? '最近使用' : item.group || '操作';
      if (group !== lastGroup) {
        list.append(h('p', { class: 'palette__group t-label', text: group }));
        lastGroup = group;
      }
      list.append(
        h(
          'button',
          {
            class: 'palette__item',
            type: 'button',
            attrs: { role: 'option', 'aria-selected': String(index === 0) },
            data: { active: index === 0 ? 'true' : null, index },
            on: {
              click: () => run(item),
              pointerenter: () => setActive(index),
            },
          },
          icon(item.iconName || 'arrowRight', 'ico ico--sm'),
          h(
            'span',
            { class: 'palette__text' },
            h('span', { class: 't-secondary', text: item.title }),
            item.subtitle ? h('span', { class: 't-caption t-clamp-1', text: item.subtitle }) : null,
          ),
          item.keys ? h('span', { class: 'row-2' }, ...keyCaps(item.keys).map((cap) => h('span', { class: 'kbd', text: cap }))) : null,
          h('span', { class: 'palette__go' }, icon('arrowRight', 'ico ico--sm')),
        ),
      );
    });
  };

  const setActive = (index) => {
    const nodes = [...list.querySelectorAll('.palette__item')];
    if (!nodes.length) return;
    active = (index + nodes.length) % nodes.length;
    nodes.forEach((node, i) => {
      if (i === active) {
        node.dataset.active = 'true';
        node.setAttribute('aria-selected', 'true');
        node.scrollIntoView({ block: 'nearest' });
      } else {
        delete node.dataset.active;
        node.setAttribute('aria-selected', 'false');
      }
    });
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[active];
      if (item) run(item);
    }
  });
  scrim.addEventListener('pointerdown', (event) => {
    if (event.target === scrim) close();
  });

  const releaseFocus = trapFocus(palette);
  const releaseKey = bindKey('escape', close, { label: '关闭命令面板', group: '通用', allowInInput: true });

  instance = { close, input };
  render();
  requestAnimationFrame(() => input.focus());
  return instance;
}

export function closePalette() {
  instance?.close();
}

export function isPaletteOpen() {
  return Boolean(instance);
}
