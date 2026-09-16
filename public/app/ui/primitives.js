/* ==========================================================================
   primitives.js — the component vocabulary shared by portal and console.
   Every factory returns a real DOM node so pages compose rather than template.
   ========================================================================== */

import { h, icon, setVars, frag, qsa } from '../core/dom.js';
import { keyCaps } from '../core/keys.js';
import { magnetic, spotlight, countTo } from '../core/motion.js';
import * as fmt from '../core/format.js';

/* --------------------------------------------------------------------------
   Buttons
   -------------------------------------------------------------------------- */
export function button({
  label,
  variant = 'secondary',
  size = 'md',
  iconName = null,
  iconAfter = null,
  iconMotion = 'pop',
  onClick,
  href = null,
  type = 'button',
  disabled = false,
  loading = false,
  block = false,
  keys = null,
  title = null,
  ariaLabel = null,
  data = {},
} = {}) {
  const classes = ['btn', `btn--${variant}`];
  if (size !== 'md') classes.push(`btn--${size}`);
  if (block) classes.push('btn--block');
  if (!label) classes.push('btn--icon');

  const children = [
    iconName ? icon(iconName, `ico ico--sm ico--${iconMotion}`) : null,
    label ? h('span', { text: label }) : null,
    iconAfter ? icon(iconAfter, `ico ico--sm ico--${iconMotion}`) : null,
    keys ? h('span', { class: 'btn__kbd' }, ...keyCaps(keys).map((cap) => h('span', { text: cap }))) : null,
  ];

  const props = {
    class: classes,
    data: { ...data, loading: loading ? 'true' : null },
    aria: { label: ariaLabel || (label ? null : title), disabled: disabled ? 'true' : null },
    title,
    on: {
      click: (event) => {
        if (disabled || loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      },
      pointermove: (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setVars(event.currentTarget, {
          '--px': `${((event.clientX - rect.left) / rect.width) * 100}%`,
          '--py': `${((event.clientY - rect.top) / rect.height) * 100}%`,
        });
      },
    },
  };

  const node = href
    ? h('a', { ...props, href }, ...children)
    : h('button', { ...props, type, disabled: disabled || undefined }, ...children);

  if (variant === 'primary' && size === 'lg') magnetic(node);
  return node;
}

/** Toggles a button into and out of its loading state around an async task. */
export async function runWithLoading(node, task) {
  node.dataset.loading = 'true';
  try {
    return await task();
  } finally {
    delete node.dataset.loading;
  }
}

export function iconButton({ iconName, label, onClick, variant = '', badge = false, expanded = null, keys = null, data = {} } = {}) {
  const node = h(
    'button',
    {
      class: ['icon-btn', variant].filter(Boolean),
      type: 'button',
      aria: { label, expanded: expanded === null ? null : String(expanded) },
      data,
      on: { click: onClick },
    },
    icon(iconName, 'ico ico--sm'),
    badge ? h('span', { class: 'icon-btn__dot' }) : null,
  );
  if (label) tooltip(node, { text: label, keys });
  return node;
}

/* --------------------------------------------------------------------------
   Tooltip — shows the shortcut alongside the label
   -------------------------------------------------------------------------- */
let activeTip = null;

export function tooltip(node, { text, keys = null, placement = 'bottom' } = {}) {
  if (!text) return () => {};
  let timer = 0;

  const hide = () => {
    clearTimeout(timer);
    if (activeTip) {
      activeTip.remove();
      activeTip = null;
    }
  };

  const show = () => {
    hide();
    const tip = h(
      'div',
      { class: 'tip', attrs: { role: 'tooltip' } },
      h('span', { text }),
      ...(keys ? keyCaps(keys).map((cap) => h('span', { class: 'kbd', text: cap })) : []),
    );
    document.body.append(tip);
    activeTip = tip;
    const anchor = node.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const gap = 7;
    let top = placement === 'top' ? anchor.top - size.height - gap : anchor.bottom + gap;
    let left = anchor.left + anchor.width / 2 - size.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - size.width - 8));
    if (top + size.height > window.innerHeight - 8) top = anchor.top - size.height - gap;
    tip.style.top = `${Math.max(8, top)}px`;
    tip.style.left = `${left}px`;
  };

  const enter = () => {
    timer = setTimeout(show, 340);
  };

  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
  node.addEventListener('click', hide);
  return hide;
}

/* --------------------------------------------------------------------------
   Badges, status, chips
   -------------------------------------------------------------------------- */
export function badge(label, { tone = 'neutral', iconName = null, count = false } = {}) {
  return h(
    'span',
    { class: ['badge', tone !== 'neutral' ? `badge--${tone}` : null, count ? 'badge--count' : null].filter(Boolean) },
    iconName ? icon(iconName, 'ico ico--sm') : null,
    h('span', { text: String(label) }),
  );
}

/** Status is always colour + text (+ motion when live), never colour alone. */
export function statusIndicator(label, { tone = 'idle', live = false } = {}) {
  return h(
    'span',
    { class: ['status', `status--${tone}`, live ? 'status--live' : null].filter(Boolean) },
    h('span', { class: 'status__dot' }),
    h('span', { text: String(label) }),
  );
}

export function statusFor(value, { live = false } = {}) {
  const tone = fmt.statusTone(value);
  const mapped = tone === 'neutral' ? 'idle' : tone;
  return statusIndicator(fmt.text(value, '未标注'), { tone: mapped, live: live && (tone === 'info' || tone === 'warning') });
}

export function chip(label, { selected = false, onClick, iconName = null, count = null } = {}) {
  return h(
    'button',
    {
      class: 'chip',
      type: 'button',
      aria: { pressed: String(Boolean(selected)) },
      on: { click: onClick },
    },
    iconName ? icon(iconName, 'ico ico--sm') : null,
    h('span', { text: label }),
    count !== null ? h('span', { class: 't-data t-faint', text: String(count) }) : null,
  );
}

export function kbd(combo) {
  return h('span', { class: 'row-2' }, ...keyCaps(combo).map((cap) => h('span', { class: 'kbd', text: cap })));
}

export function progressRing(value = 0) {
  const circumference = 2 * Math.PI * 7;
  const node = h(
    'svg',
    { class: 'ring', attrs: { viewBox: '0 0 16 16', 'aria-hidden': 'true' } },
    h('circle', { class: 'ring__track', attrs: { cx: 8, cy: 8, r: 7 } }),
    h('circle', {
      class: 'ring__fill',
      attrs: {
        cx: 8,
        cy: 8,
        r: 7,
        'stroke-dasharray': circumference.toFixed(2),
        'stroke-dashoffset': (circumference * (1 - Math.max(0, Math.min(1, value)))).toFixed(2),
      },
    }),
  );
  return node;
}

export function liveDots() {
  return h('span', { class: 'dots' }, h('i'), h('i'), h('i'));
}

/* --------------------------------------------------------------------------
   Fields
   -------------------------------------------------------------------------- */
export function field({
  label,
  name,
  type = 'text',
  value = '',
  placeholder = '',
  hint = '',
  required = false,
  multiline = false,
  rows = 4,
  options = null,
  disabled = false,
  iconName = null,
  min = null,
  max = null,
  step = null,
  autocomplete = null,
  onInput = null,
  maxlength = null,
} = {}) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  let control;

  if (options) {
    control = h(
      'select',
      { class: 'select', id, name, disabled: disabled || undefined, on: onInput ? { change: onInput } : null },
      ...options.map((option) => {
        const optionValue = typeof option === 'string' ? option : option.value;
        const optionLabel = typeof option === 'string' ? option : option.label;
        return h('option', { value: optionValue, selected: String(optionValue) === String(value) || undefined, text: optionLabel });
      }),
    );
  } else if (multiline) {
    control = h('textarea', {
      class: 'textarea',
      id,
      name,
      rows,
      placeholder,
      maxlength,
      disabled: disabled || undefined,
      on: onInput ? { input: onInput } : null,
    });
    control.value = value ?? '';
  } else {
    control = h('input', {
      class: 'input',
      id,
      name,
      type,
      placeholder,
      value: value ?? '',
      min,
      max,
      step,
      maxlength,
      autocomplete,
      disabled: disabled || undefined,
      on: onInput ? { input: onInput } : null,
    });
  }

  const errorSlot = h('p', { class: 'field__error', hidden: true });

  const wrapper = h(
    'div',
    { class: 'field', data: { fieldName: name } },
    label
      ? h(
          'label',
          { class: 'field__label', for: id },
          h('span', { text: label }),
          required ? h('span', { class: 'field__req', text: '必填' }) : null,
        )
      : null,
    options
      ? h('div', { class: 'select-wrap' }, control, icon('chevronDown', 'ico ico--sm'))
      : iconName && !multiline
        ? h('div', { class: 'input-group' }, icon(iconName, 'ico ico--sm'), control)
        : control,
    hint ? h('p', { class: 'field__hint', text: hint }) : null,
    errorSlot,
  );

  wrapper.control = control;
  wrapper.setError = (message) => {
    if (message) {
      errorSlot.hidden = false;
      errorSlot.replaceChildren(icon('alert', 'ico ico--sm'), h('span', { text: message }));
      control.setAttribute('aria-invalid', 'true');
    } else {
      errorSlot.hidden = true;
      errorSlot.replaceChildren();
      control.removeAttribute('aria-invalid');
    }
  };
  return wrapper;
}

export function checkbox({ name, label, description = '', checked = false, required = false, onChange = null } = {}) {
  const input = h('input', { type: 'checkbox', name, checked: checked || undefined, required: required || undefined });
  const node = h(
    'label',
    { class: 'check', data: { checked: String(Boolean(checked)) } },
    input,
    h('span', { class: 'check__box' }, icon('check', 'ico')),
    h(
      'span',
      { class: 'check__text' },
      h('b', { class: 't-secondary t-strong', text: label }),
      description ? h('p', { class: 't-caption', text: description }) : null,
    ),
  );
  input.addEventListener('change', () => {
    node.dataset.checked = String(input.checked);
    onChange?.(input.checked);
  });
  // HTMLLabelElement.control is a read-only native accessor that already
  // resolves to the labelled input, so callers can use `.control` uniformly
  // with field(). Assigning to it would throw in strict mode.
  return node;
}

export function toggle({ label, checked = false, onChange = null } = {}) {
  const control = h('button', {
    class: 'toggle',
    type: 'button',
    role: 'switch',
    aria: { checked: String(Boolean(checked)), label },
    on: {
      click: (event) => {
        const next = event.currentTarget.getAttribute('aria-checked') !== 'true';
        event.currentTarget.setAttribute('aria-checked', String(next));
        onChange?.(next);
      },
    },
  });
  return label
    ? h('label', { class: 'row-between' }, h('span', { class: 't-secondary', text: label }), control)
    : control;
}

export function segmented({ items, value, onChange, ariaLabel = '视图切换' } = {}) {
  const thumb = h('span', { class: 'segmented__thumb' });
  const buttons = items.map((item) =>
    h('button', {
      type: 'button',
      role: 'tab',
      text: item.label,
      data: { value: item.value },
      aria: { selected: String(item.value === value) },
      on: { click: () => onChange?.(item.value) },
    }),
  );
  const node = h('div', { class: 'segmented', attrs: { role: 'tablist', 'aria-label': ariaLabel } }, thumb, ...buttons);

  const position = () => {
    const active = buttons.find((b) => b.getAttribute('aria-selected') === 'true') || buttons[0];
    if (!active) return;
    setVars(thumb, { '--thumb-x': `${active.offsetLeft - 2}px`, '--thumb-w': `${active.offsetWidth}px` });
  };
  node.reposition = position;
  requestAnimationFrame(position);
  node.setValue = (next) => {
    buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.value === next)));
    position();
  };
  return node;
}

/* --------------------------------------------------------------------------
   Structure
   -------------------------------------------------------------------------- */
export function panel({ title = '', description = '', actions = [], body = null, footer = null, variant = '', flush = false, spotlight: withSpotlight = false } = {}) {
  const node = h(
    'section',
    { class: ['panel', variant ? `panel--${variant}` : null, withSpotlight ? 'spotlight' : null].filter(Boolean) },
    title || actions.length
      ? h(
          'header',
          { class: 'panel__head' },
          h(
            'div',
            { class: 'section-head__text' },
            h('h2', { class: 't-h3', text: title }),
            description ? h('p', { class: 't-caption', text: description }) : null,
          ),
          h('span', { class: 'spacer' }),
          ...actions,
        )
      : null,
    h('div', { class: ['panel__body', flush ? 'panel__body--flush' : null].filter(Boolean) }, body),
    footer ? h('footer', { class: 'panel__foot' }, footer) : null,
  );
  if (withSpotlight) spotlight(node);
  return node;
}

export function sectionHead({ label = '', title, description = '', actions = [] } = {}) {
  return h(
    'div',
    { class: 'section-head' },
    h(
      'div',
      { class: 'section-head__text' },
      label ? h('p', { class: 't-label', text: label }) : null,
      h('h2', { class: 't-h2', text: title }),
      description ? h('p', { class: 't-secondary', text: description }) : null,
    ),
    h('span', { class: 'spacer' }),
    ...actions,
  );
}

export function pageHead({ label = '', title, description = '', actions = [], meta = [] } = {}) {
  return h(
    'header',
    { class: 'pagehead' },
    h(
      'div',
      { class: 'pagehead__text' },
      label ? h('p', { class: 't-label', text: label }) : null,
      h('h1', { class: 't-h1', text: title }),
      description ? h('p', { class: 't-secondary', text: description }) : null,
      meta.length ? h('div', { class: 'row-4 row-wrap' }, ...meta) : null,
    ),
    h('span', { class: 'spacer' }),
    actions.length ? h('div', { class: 'pagehead__actions' }, ...actions) : null,
  );
}

/* --------------------------------------------------------------------------
   Metrics
   -------------------------------------------------------------------------- */
export function metric({ label, value, unit = '', hint = null, tone = '', onClick = null, decimals = 0, animate = true } = {}) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const valueNode = h('span', {
    class: 'metric__value',
    text: numeric && animate ? '0' : String(value),
    data: numeric && animate ? { count: value, countDecimals: decimals } : {},
  });

  const node = h(
    onClick ? 'button' : 'div',
    {
      class: ['metric', tone ? `metric--${tone}` : null].filter(Boolean),
      type: onClick ? 'button' : null,
      data: { clickable: onClick ? 'true' : null },
      on: onClick ? { click: onClick } : null,
    },
    h('p', { class: 't-label', text: label }),
    h('div', { class: 'row-base row-2' }, valueNode, unit ? h('span', { class: 'metric__unit', text: unit }) : null),
    h('div', { class: 'metric__foot' }, hint),
    onClick ? h('span', { class: 'metric__go' }, icon('arrowRight', 'ico ico--sm')) : null,
  );
  node.setValue = (next) => countTo(valueNode, next, { format: (v) => fmt.int(v) });
  return node;
}

export function metricRow(metrics, { columns = null } = {}) {
  const node = h('div', { class: 'metrics' }, ...metrics);
  setVars(node, { '--metric-cols': columns || metrics.length });
  return node;
}

/* --------------------------------------------------------------------------
   Task queue
   -------------------------------------------------------------------------- */
export function queueRow({ type, title, detail = '', priority = 'low', action = null, onClick = null, meta = [] } = {}) {
  return h(
    onClick ? 'button' : 'div',
    {
      class: 'queue__row',
      type: onClick ? 'button' : null,
      data: { priority },
      on: onClick ? { click: onClick } : null,
    },
    h('span', { class: 'queue__rail' }),
    h(
      'div',
      { class: 'queue__body' },
      h(
        'div',
        { class: 'row-2 row-wrap' },
        h('span', { class: 't-label', text: type }),
        ...meta,
      ),
      h('p', { class: 't-secondary t-strong t-clamp-1', text: title }),
      detail ? h('p', { class: 't-caption t-clamp-1', text: detail }) : null,
    ),
    action ? h('div', { class: 'queue__action' }, action) : null,
  );
}

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */
export function timeline(items) {
  return h(
    'div',
    { class: 'timeline' },
    ...items.map((item) =>
      h(
        'div',
        { class: 'timeline__item', data: { state: item.state || 'pending' } },
        h('span', { class: 'timeline__node' }, icon(item.iconName || (item.state === 'done' ? 'check' : item.state === 'blocked' ? 'close' : 'clock'), 'ico')),
        h(
          'div',
          { class: 'timeline__body' },
          h(
            'div',
            { class: 'row-2 row-wrap' },
            h('b', { class: 't-secondary t-strong', text: item.title }),
            item.badge || null,
          ),
          item.description ? h('p', { class: 't-caption', text: item.description }) : null,
          item.at ? h('p', { class: 't-caption t-faint', text: fmt.fullDateTime(item.at) }) : null,
          item.extra || null,
        ),
      ),
    ),
  );
}

/* --------------------------------------------------------------------------
   Skeletons — structure first, data second
   -------------------------------------------------------------------------- */
export function skeletonLine(widthClass = '') {
  return h('div', { class: ['sk', 'sk--line', widthClass].filter(Boolean) });
}

export function skeletonMetrics(count = 4) {
  return metricRow(
    Array.from({ length: count }, () =>
      h(
        'div',
        { class: 'metric' },
        h('div', { class: 'sk sk--text sk-w-55' }),
        h('div', { class: 'sk sk--num' }),
        h('div', { class: 'sk sk--text sk-w-40' }),
      ),
    ),
    { columns: count },
  );
}

export function skeletonRows(count = 6) {
  return h(
    'div',
    { class: 'stack-3' },
    ...Array.from({ length: count }, (_, index) =>
      h(
        'div',
        { class: 'row-4' },
        h('div', { class: 'sk sk--circle sk--avatar' }),
        h('div', { class: 'stack-2 spacer' }, skeletonLine(index % 2 ? 'sk-w-70' : 'sk-w-85'), skeletonLine('sk-w-40')),
      ),
    ),
  );
}

export function skeletonBlock(minHeight = '180px') {
  const node = h('div', { class: 'sk sk--block' });
  node.style.minHeight = minHeight;
  return node;
}

/* --------------------------------------------------------------------------
   Empty / error states
   -------------------------------------------------------------------------- */
export function emptyState({ iconName = 'inbox', title, description = '', actions = [] } = {}) {
  return h(
    'div',
    { class: 'state' },
    h('div', { class: 'state__art' }, icon(iconName, 'ico')),
    h(
      'div',
      { class: 'state__text' },
      h('h3', { class: 't-h3', text: title }),
      description ? h('p', { class: 't-secondary', text: description }) : null,
    ),
    actions.length ? h('div', { class: 'state__actions' }, ...actions) : null,
  );
}

export function errorState({ title = '这个区域暂时无法显示', error = null, onRetry = null, onBack = null, hint = '' } = {}) {
  const cause = error?.isOffline
    ? '浏览器与平台服务之间的连接中断。'
    : error?.isAuth
      ? '登录会话已过期，需要重新登录。'
      : error?.isForbidden
        ? '当前账号没有访问该数据的权限。'
        : error?.isRateLimited
          ? '请求过于频繁，已被平台限流保护拦截。'
          : error?.status >= 500
            ? '数据服务返回了内部错误。'
            : '请求被数据服务拒绝。';

  return h(
    'div',
    { class: 'state state--error' },
    h('div', { class: 'state__art' }, icon('alert', 'ico')),
    h(
      'div',
      { class: 'state__text' },
      h('h3', { class: 't-h3', text: title }),
      h('p', { class: 't-secondary', text: error?.message || '未知错误' }),
      h('p', { class: 't-caption', text: hint || cause }),
    ),
    h(
      'div',
      { class: 'state__actions' },
      onRetry ? button({ label: '重新加载', variant: 'primary', iconName: 'refresh', iconMotion: 'spin', onClick: onRetry }) : null,
      onBack ? button({ label: '返回', variant: 'ghost', iconName: 'chevronLeft', onClick: onBack }) : null,
    ),
    error
      ? h(
          'details',
          { class: 'state__debug' },
          h('summary', { text: '技术细节' }),
          h('pre', {
            text: JSON.stringify(
              { path: error.path || null, status: error.status ?? null, message: error.message, detail: error.detail || null },
              null,
              2,
            ),
          }),
        )
      : null,
  );
}

/* --------------------------------------------------------------------------
   Notices, impact preview, receipts
   -------------------------------------------------------------------------- */
export function notice(text, { tone = 'neutral', iconName = null, title = '' } = {}) {
  return h(
    'div',
    { class: ['notice', tone !== 'neutral' ? `notice--${tone}` : null].filter(Boolean) },
    icon(iconName || (tone === 'warning' || tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'), 'ico ico--sm'),
    h('div', { class: 'stack-1' }, title ? h('b', { class: 't-secondary t-strong', text: title }) : null, h('p', { text })),
  );
}

/** Shows what a write will change before it is committed. */
export function impactPreview({ label, from, to, unit = '' }) {
  return h(
    'div',
    { class: 'impact' },
    h('span', { class: 't-caption t-muted', text: label }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'impact__from', text: `${from}${unit}` }),
    icon('arrowRight', 'ico ico--sm impact__arrow'),
    h('span', { class: 'impact__to', text: `${to}${unit}` }),
  );
}

export function receipt({ title, rows = [], actions = [] }) {
  return h(
    'div',
    { class: 'receipt' },
    h('div', { class: 'row-2' }, icon('check', 'ico ico--sm'), h('b', { class: 't-title', text: title })),
    h(
      'dl',
      { class: 'receipt__rows' },
      ...rows.map(([term, description]) => h('div', { class: 'receipt__row' }, h('dt', { text: term }), h('dd', { text: String(description) }))),
    ),
    actions.length ? h('div', { class: 'row-2' }, ...actions) : null,
  );
}

export function barTrack(segments) {
  const total = segments.reduce((sum, segment) => sum + (Number(segment.value) || 0), 0) || 1;
  return h(
    'div',
    { class: 'bar-track', attrs: { role: 'img', 'aria-label': segments.map((s) => `${s.label} ${s.value}`).join('，') } },
    ...segments.map((segment) => {
      const span = h('span');
      setVars(span, { '--w': `${((Number(segment.value) || 0) / total) * 100}%`, '--c': segment.color || 'var(--accent)' });
      return span;
    }),
  );
}

export function steps(items, activeIndex) {
  return h(
    'div',
    { class: 'steps' },
    ...items.flatMap((item, index) => {
      const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
      const node = h(
        'div',
        { class: 'steps__item', data: { state } },
        h('span', { class: 'steps__dot' }, state === 'done' ? icon('check', 'ico') : h('span', { text: String(index + 1) })),
        h('span', { class: 'steps__name', text: item }),
      );
      return index < items.length - 1 ? [node, h('span', { class: 'steps__link' })] : [node];
    }),
  );
}

export function avatar(name, { large = false } = {}) {
  return h('span', { class: ['avatar', large ? 'avatar--lg' : null].filter(Boolean), text: fmt.initials(name) });
}

export function definitionList(rows) {
  return h(
    'dl',
    { class: 'dl' },
    ...rows
      .filter(Boolean)
      .map(([term, description]) =>
        h(
          'div',
          { class: 'dl__row' },
          h('dt', { class: 't-caption t-muted', text: term }),
          h('dd', { class: 't-secondary' }, description instanceof Node ? description : h('span', { text: String(description) })),
        ),
      ),
  );
}

/** Copy-to-clipboard affordance for codes and identifiers. */
export function copyableCode(value, { label = '复制' } = {}) {
  const node = h(
    'button',
    {
      class: 'row-2',
      type: 'button',
      on: {
        click: async () => {
          try {
            await navigator.clipboard.writeText(String(value));
            const { notify } = await import('../core/toast.js');
            notify.success('已复制到剪贴板', String(value));
          } catch {
            const { notify } = await import('../core/toast.js');
            notify.warning('无法访问剪贴板', '请手动选择文本后复制。');
          }
        },
      },
    },
    h('code', { class: 't-data', text: String(value) }),
    icon('copy', 'ico ico--sm t-faint'),
  );
  tooltip(node, { text: label });
  return node;
}

export { frag, qsa };
