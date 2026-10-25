import { createHome } from '../home-experience.js';
/* ==========================================================================
   portal/pages/home.js
   Homepage entry; eventCard remains shared with existing activity surfaces.
   ========================================================================== */

import { h, icon, setVars } from '../../core/dom.js';
import { rememberOrigin } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { badge, statusIndicator, barTrack } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';

export function eventCard(event, { compact = false } = {}) {
  const seatRatio = event.capacity ? fmt.ratio(event.confirmed, event.capacity) : 0;
  const until = fmt.daysUntil(event.registrationEnd);
  const node = h(
    'a',
    {
      class: 'event',
      href: `/events/${encodeURIComponent(event.eventId)}`,
      data: { flipKey: event.eventId },
      on: {
        click: (e) => {
          e.preventDefault();
          navigate(`/events/${encodeURIComponent(event.eventId)}`, { state: { origin: rememberOrigin(node) } });
        },
      },
    },
    h(
      'div',
      { class: 'event__meta' },
      badge(event.type || '公益活动', { tone: 'accent' }),
      event.status === '报名中'
        ? statusIndicator(event.full ? (event.workflowId ? '名额已满' : '名额已满 · 可候补') : '报名中', { tone: event.full ? 'warning' : 'success', live: true })
        : statusIndicator(event.status || '未标注', { tone: event.status === '进行中' ? 'info' : 'idle' }),
      until !== null && until >= 0 && event.status === '报名中'
        ? h('span', { class: 't-caption t-muted', text: until === 0 ? '今天截止报名' : `还有 ${until} 天截止` })
        : null,
    ),
    h(
      'div',
      { class: 'stack-2' },
      h('h3', { class: 'event__title t-clamp-2', text: event.name }),
      !compact && event.description ? h('p', { class: 't-secondary t-clamp-2', text: event.description }) : null,
    ),
    h(
      'div',
      { class: 'event__facts' },
      h('span', { class: 'event__fact' }, icon('clock', 'ico ico--sm'), h('span', { text: fmt.timeSlot(event.schedule) || fmt.dateRange(event.startAt, event.endAt) })),
      h('span', { class: 'event__fact' }, icon('pin', 'ico ico--sm'), h('span', { class: 'truncate', text: [event.campus, event.location].filter(Boolean).join(' · ') || '地点待公布' })),
    ),
    h(
      'div',
      { class: 'event__foot' },
      h(
        'div',
        { class: 'event__capacity' },
        h(
          'div',
          { class: 'row-2 row-between' },
          h('span', { class: 't-caption t-muted', text: event.capacity ? `已确认 ${event.confirmed} / ${event.capacity}` : '容量不限' }),
          event.waitlisted ? h('span', { class: 't-caption t-muted', text: `候补 ${event.waitlisted}` }) : null,
        ),
        event.capacity
          ? barTrack([
              { label: '已确认', value: event.confirmed, color: event.full ? 'var(--warning)' : 'var(--accent)' },
              { label: '剩余', value: Math.max(0, event.capacity - event.confirmed), color: 'transparent' },
            ])
          : null,
      ),
      h('span', { class: 'event__go' }, icon('arrowRight', 'ico')),
    ),
  );
  if (event.capacity) setVars(node, { '--seat': seatRatio });
  return node;
}

export default createHome;
