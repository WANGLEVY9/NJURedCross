import { h, icon } from '../core/dom.js';
import { badge, statusIndicator } from '../ui/primitives.js';
import { registrationActions } from './registration-actions.js';
import * as fmt from '../core/format.js';

export function eventRow(event) {
  const node = h(
    'article',
    {class:'event-row',data:{flipKey:event.eventId}},
    h(
      'div',
      { class: 'event-row__date' },
      h('b', { text: fmt.dayOfMonth(event.startAt || event.registrationEnd) }),
      h('span', { text: fmt.monthLabel(event.startAt || event.registrationEnd) || '待定' }),
    ),
    h(
      'div',
      { class: 'event-row__body' },
      h(
        'div',
        { class: 'row-2 row-wrap' },
        badge(event.type || '公益活动', { tone: 'accent' }),
        event.status === '报名中'
          ? statusIndicator(event.full ? (event.workflowId ? '名额已满' : '名额已满 · 可候补') : `剩余 ${event.remaining} 个名额`, { tone: event.full ? 'warning' : 'success', live: true })
          : statusIndicator(event.status, { tone: event.status === '进行中' ? 'info' : 'idle' }),
      ),
      h('h3', { class: 't-h3 t-clamp-1', text: event.name }),
      h(
        'div',
        { class: 'row-4 row-wrap' },
        h('span', { class: 'event__fact' }, icon('clock', 'ico ico--sm'), h('span', { text: event.schedule || fmt.dateRange(event.startAt, event.endAt) })),
        h('span', { class: 'event__fact' }, icon('pin', 'ico ico--sm'), h('span', { text: [event.campus, event.location].filter(Boolean).join(' · ') || '地点待公布' })),
        event.sessions?.length > 1 ? h('span', { class: 'event__fact' }, icon('list', 'ico ico--sm'), h('span', { text: `${event.sessions.length} 个场次` })) : null,
      ),
    ),
    registrationActions({
      className: 'event-row__action',
      label: event.status === '报名中' && !event.full ? '查看并报名' : '查看详情',
      href: `/events/${encodeURIComponent(event.eventId)}`,
    }),
  );
  return node;
}

