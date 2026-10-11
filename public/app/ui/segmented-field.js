import { h } from '../core/dom.js';
import { segmented } from './primitives.js';

let sequence = 0;

export function segmentedField({
  name,
  label,
  options,
  value = '',
  required = false,
  hint = '',
  ariaLabel = label,
  onChange = null,
} = {}) {
  let current = value;
  const errorId = `seg-${name}-${sequence += 1}-error`;
  const error = h('p', { class: 'field__error', id: errorId, role: 'alert', hidden: true });
  const control = segmented({
    items: options,
    value,
    ariaLabel,
    role: 'radiogroup',
    describedBy: errorId,
    onChange: (next) => {
      current = next;
      error.hidden = true;
      control.setValue(next);
      reflectSelection();
      onChange?.(next);
    },
  });
  /**
   * 没选中任何一项时把滑块藏起来。`segmented` 在没有选中项时会把指示块停在第一格，
   * 但那一格并不是选中状态（aria-checked=false），于是红底配灰字，看起来像重影。
   */
  const thumb = control.querySelector('.segmented__thumb');
  const reflectSelection = () => { if (thumb) thumb.style.opacity = current ? '' : '0'; };
  reflectSelection();
  const field = h(
    'div',
    { class: 'field campus-segmented-field', data: { fieldName: name } },
    h('p', { class: 'field__label' }, h('span', { text: label }), required ? h('span', { class: 'field__req', text: '必填' }) : null),
    control,
    hint ? h('p', { class: 'field__hint', text: hint }) : null,
    error,
  );
  field.getValue = () => current;
  field.setValue = (next) => {
    current = next;
    control.setValue(next);
    reflectSelection();
  };
  field.setError = (message) => {
    if (message) {
      error.textContent = message;
      error.hidden = false;
      control.setAttribute('aria-invalid', 'true');
    } else {
      error.textContent = '';
      error.hidden = true;
      control.removeAttribute('aria-invalid');
    }
  };
  field.focus = () => control.querySelector('button')?.focus();
  field.control = { focus: field.focus };
  return field;
}
