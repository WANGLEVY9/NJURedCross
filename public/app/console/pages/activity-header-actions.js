import { h } from '../../core/dom.js';

/** Keep two fixed controls and a single disclosure for all remaining tasks. */
export function activityHeaderActions({ view, edit, actions = [], more = [] }) {
  const stage = actions.filter(Boolean), extras = more.filter(Boolean);
  const menu = h('details', { class: 'activity-task-menu', on: {
    keydown: event => {
      if (event.key !== 'Escape') return;
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
      event.stopPropagation();
    },
    click: event => {
      if (event.target.closest('button:not(:disabled), a')) event.currentTarget.open = false;
    },
  } }, h('summary', { text: '更多操作' }),
  h('div', { class: 'activity-task-menu__items', role: 'group', 'aria-label': '活动其他操作' },
    h('div', { class: 'activity-stage-actions' }, ...stage), ...extras));
  return h('div', { class: 'activity-fixed-slots', role: 'group', 'aria-label': '活动常用操作' },
    h('div', { class: 'activity-primary-actions' }, view, edit, menu));
}