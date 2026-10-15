import { h } from '../core/dom.js';
import { bindKey } from '../core/keys.js';

const instances = new WeakMap();
let sequence = 0;
const pad = (value, length = 2) => String(value).padStart(length, '0');
const daysInMonth = (year, month) => [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
const dateString = ({ year, month, day }) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

function parse(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(value => Number(value || 0));
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

// UTC is used only for Gregorian calendar arithmetic, never to parse or serialize
// the local datetime value. setUTCFullYear also preserves years 0001–0099.
function calendarDate(value) {
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  return date;
}

/**
 * Enhance a primitives.field() without replacing its .control or label.
 * Load /styles/date-time-picker.css separately. Repeated enhancement is a no-op.
 * Call field.disposeDateTimePicker() before removing an open field; it restores
 * the original step and removes all enhancement state. No business API is used.
 */
export function enhanceDateTimeField(fieldNode) {
  if (instances.has(fieldNode)) return fieldNode;
  const control = fieldNode?.control;
  if (!control || control.tagName !== 'INPUT' || control.type !== 'datetime-local' || !fieldNode.contains(control)) {
    throw new TypeError('enhanceDateTimeField requires a field with a datetime-local .control');
  }
  const id = `date-time-picker-${++sequence}`;
  const originalStep = control.getAttribute('step');
  const events = new AbortController();
  let releaseEscape = null;
  let draft;
  let selected;
  let returnFocus;
  const unavailable = () => control.matches(':disabled') || control.readOnly;
  const button = (text, label = text) => h('button', { type: 'button', text, 'aria-label': label });
  const trigger = button('选择日期与时间');
  trigger.className = 'date-time-picker__trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  const title = h('strong', { id: `${id}-title`, 'aria-live': 'polite' });
  const previous = button('‹', '上个月');
  const next = button('›', '下个月');
  const grid = h('div', { class: 'date-time-picker__grid', role: 'grid', 'aria-labelledby': title.id });
  const timeInputs = ['时', '分', '秒'].map((label, index) => h('input', {
    type: 'number', min: 0, max: index ? 59 : 23, step: 1, required: true,
    id: `${id}-time-${index}`, 'aria-label': label, inputmode: 'numeric',
  }));
  const error = h('p', { class: 'date-time-picker__error', role: 'alert', id: `${id}-error`, hidden: true });
  const apply = button('应用');
  apply.className = 'date-time-picker__apply';
  const cancel = button('取消');
  const popover = h('div', {
    id, class: 'date-time-picker__popover', role: 'dialog', 'aria-label': '选择日期与时间', hidden: true,
  }, h('div', { class: 'date-time-picker__heading' }, previous, title, next), grid,
  h('div', { class: 'date-time-picker__time' }, ...timeInputs.map((input, index) => h('label', { for: input.id }, ['时', '分', '秒'][index], input))),
  error, h('div', { class: 'date-time-picker__actions' }, cancel, apply));

  function close(restore = false) {
    if (popover.hidden) return;
    popover.hidden = true;
    // Hidden required draft inputs must not participate in parent form validation.
    timeInputs.forEach(input => { input.disabled = true; });
    trigger.setAttribute('aria-expanded', 'false');
    releaseEscape?.();
    releaseEscape = null;
    if (restore && returnFocus?.isConnected) returnFocus.focus();
  }

  function render(focus = false) {
    title.textContent = `${pad(draft.year, 4)}年${draft.month}月`;
    previous.disabled = draft.year === 1 && draft.month === 1;
    next.disabled = draft.year === 9999 && draft.month === 12;
    const headings = h('div', { role: 'row' }, ...['一', '二', '三', '四', '五', '六', '日'].map(text => h('span', { role: 'columnheader', text })));
    const offset = (calendarDate({ ...draft, day: 1 }).getUTCDay() + 6) % 7;
    const count = daysInMonth(draft.year, draft.month);
    const rows = [headings];
    for (let start = 0; start < offset + count; start += 7) {
      const row = h('div', { role: 'row' });
      for (let column = 0; column < 7; column++) {
        const day = start + column - offset + 1;
        const cell = h('div', { role: 'gridcell' });
        if (day > 0 && day <= count) {
          const value = dateString({ ...draft, day });
          const dayButton = button(String(day), value);
          dayButton.dataset.day = String(day);
          dayButton.tabIndex = day === draft.day ? 0 : -1;
          cell.setAttribute('aria-selected', String(value === selected));
          cell.append(dayButton);
        }
        row.append(cell);
      }
      rows.push(row);
    }
    grid.replaceChildren(...rows);
    if (focus) grid.querySelector('[tabindex="0"]').focus();
  }

  function moveMonth(delta, focus = false) {
    const monthIndex = (draft.year - 1) * 12 + draft.month - 1 + delta;
    if (monthIndex < 0 || monthIndex >= 9999 * 12) return;
    draft.year = Math.floor(monthIndex / 12) + 1;
    draft.month = monthIndex % 12 + 1;
    draft.day = Math.min(draft.day, daysInMonth(draft.year, draft.month));
    render(focus);
  }

  function open() {
    if (unavailable()) return;
    if (!popover.hidden) { close(true); return; }
    const now = new Date();
    draft = parse(control.value) || parse(control.min) || {
      year: Math.max(1, Math.min(9999, now.getFullYear())), month: now.getMonth() + 1,
      day: now.getDate(), hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds(),
    };
    selected = dateString(draft);
    returnFocus = document.activeElement === control ? control : trigger;
    timeInputs.forEach((input, index) => {
      input.disabled = false;
      input.value = pad([draft.hour, draft.minute, draft.second][index]);
    });
    error.hidden = true;
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // The app's overlay shortcuts run in window capture. Shadow its Escape
    // binding while open so the containing drawer remains open.
    releaseEscape = bindKey('escape', event => {
      event.stopImmediatePropagation();
      close(true);
    }, { allowInInput: true });
    render(true);
  }

  const listen = (node, type, handler) => node.addEventListener(type, handler, { signal: events.signal });
  listen(trigger, 'click', open);
  listen(previous, 'click', () => moveMonth(-1));
  listen(next, 'click', () => moveMonth(1));
  listen(cancel, 'click', () => close(true));
  listen(grid, 'click', event => {
    const target = event.target.closest('[data-day]');
    if (!target) return;
    draft.day = Number(target.dataset.day);
    selected = dateString(draft);
    render(true);
  });
  listen(grid, 'keydown', event => {
    if (!event.target.matches('[data-day]') || event.altKey || event.ctrlKey || event.metaKey) return;
    const weekday = (calendarDate(draft).getUTCDay() + 6) % 7;
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    if (!(event.key in deltas) && !['PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key.startsWith('Page')) {
      moveMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1), true);
    } else {
      const date = calendarDate(draft);
      date.setUTCDate(date.getUTCDate() + deltas[event.key]);
      if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return;
      Object.assign(draft, { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
      render(true);
    }
  });
  listen(control, 'keydown', event => {
    if ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4') {
      event.preventDefault();
      open();
    }
  });
  listen(fieldNode, 'focusout', event => {
    // During native focus transfer activeElement can temporarily be body.
    // Prefer relatedTarget so moving between draft controls doesn't dismiss.
    if (event.relatedTarget) {
      if (!fieldNode.contains(event.relatedTarget)) close();
      return;
    }
    queueMicrotask(() => {
      if (!fieldNode.contains(document.activeElement)) close();
    });
  });
  listen(popover, 'keydown', event => {
    // Enter in a draft time field must not submit the containing form.
    if (event.key === 'Enter' && timeInputs.includes(event.target)) {
      event.preventDefault();
      apply.click();
    }
  });
  listen(apply, 'click', () => {
    if (unavailable()) { close(); return; }
    const invalid = timeInputs.find(input => !input.validity.valid || !Number.isInteger(input.valueAsNumber));
    if (invalid) {
      error.textContent = '请输入有效时间：时 0–23，分和秒 0–59。';
      error.hidden = false;
      invalid.focus();
      return;
    }
    // Apply the focused calendar date as well as explicitly clicked dates.
    const value = `${dateString(draft)}T${timeInputs.map(input => pad(input.valueAsNumber)).join(':')}`;
    const probe = control.cloneNode();
    probe.value = value;
    if (!parse(value) || !probe.validity.valid) {
      error.textContent = '所选日期与时间不在允许范围内。';
      error.hidden = false;
      return;
    }
    const changed = control.value !== probe.value;
    control.value = value;
    close(true);
    if (changed) {
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  control.step = '1';
  control.classList.add('date-time-picker__native');
  fieldNode.classList.add('date-time-picker');
  fieldNode.append(trigger, popover);
  timeInputs.forEach(input => { input.disabled = true; });
  const syncDisabled = () => {
    trigger.disabled = unavailable();
    if (trigger.disabled) close();
  };
  // Watch the input only; ancestor fieldset disabled semantics are native for
  // the trigger, and open/apply also check effective :disabled state.
  const observer = new MutationObserver(syncDisabled);
  observer.observe(control, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
  syncDisabled();
  fieldNode.disposeDateTimePicker = () => {
    close(document.activeElement === trigger || popover.contains(document.activeElement));
    if (document.activeElement === trigger) control.focus();
    events.abort();
    observer.disconnect();
    trigger.remove();
    popover.remove();
    control.classList.remove('date-time-picker__native');
    fieldNode.classList.remove('date-time-picker');
    if (originalStep === null) control.removeAttribute('step'); else control.setAttribute('step', originalStep);
    instances.delete(fieldNode);
    delete fieldNode.disposeDateTimePicker;
  };
  instances.set(fieldNode, true);
  return fieldNode;
}
