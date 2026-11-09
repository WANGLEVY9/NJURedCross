import { h, icon } from '../core/dom.js';
import { badge, statusIndicator } from '../ui/primitives.js';
import { registrationActions } from './registration-actions.js';
import * as fmt from '../core/format.js';
import {activityKind,activityRegion} from '../shared/activity-taxonomy.js';
import {activityEmblem} from './activity-emblem.js';
import {isClosedActivity} from './closed-activity.js';

export function eventRow(event, { href, actionLabel, sessionLabel, showDescription = true } = {}) {
  const category=activityKind(event),emblem=activityEmblem(category);
  const region=activityRegion(event)==='suzhou'?h('span',{id:`event-region-${crypto.randomUUID()}`,class:'event-row__region',text:'苏州'}):null;
  const node = h(
    'article',
    {class:'event-row event-row--category',data:{flipKey:event.eventId,category}},
    h(
      'div',
      { class: 'event-row__date' },
      emblem,
      h('b', { text:event.longTerm?'∞':fmt.dayOfMonth(event.startAt || event.registrationEnd) }),
      h('span', { text:event.longTerm?'长期':fmt.monthLabel(event.startAt || event.registrationEnd) || '待定' }),
    ),
    h(
      'div',
      { class: 'event-row__body' },
      h(
        'div',
        { class: 'row-2 row-wrap' },
        badge(category==='未分类'?'公益活动':category, { tone: 'accent' }),
        event.registryType&&event.status==='进行中'?statusIndicator('可登记',{tone:'success'}):event.status === '报名中'
          ? statusIndicator(event.statusLabel || (event.full ? (event.workflowId ? '名额已满' : '名额已满 · 可候补') : event.flexibleRegistration?`需求 ${event.capacity} 人 · 可报名`:`剩余 ${event.remaining} 个名额`), { tone: event.full ? 'warning' : 'success', live: true })
          : statusIndicator(event.status, { tone: event.status === '进行中' ? 'info' : 'idle' }),
      ),
      region
        ?h('h3',{class:'t-h3 event-row__heading',aria:{label:event.name,describedby:region.id}},event.name,region)
        :h('h3', { class: 't-h3 t-clamp-1', text: event.name }),
      h(
        'div',
        { class: 'event-row__facts' },
        h('div', { class: 'event__fact', data: { fact: 'date' } }, icon('clock', 'ico ico--sm'), h('span', { class: 'event-row__fact-label', text: '日期' }), h('span', { text:event.longTerm?'长期开放':fmt.activityDateRange(event.startAt, event.endAt) })),
        h('div', { class: 'event__fact', data: { fact: 'location' } }, icon('pin', 'ico ico--sm'), h('span', { class: 'event-row__fact-label', text: '地点' }), h('span', { text: [event.campus, event.location].filter(Boolean).join(' · ') || '地点待公布' })),
        h('div', { class: 'event__fact', data: { fact: 'sessions' } }, icon('list', 'ico ico--sm'), h('span', { class: 'event-row__fact-label', text: '安排' }), h('span', { text: event.registryType?'自主登记':sessionLabel || `${event.sessions?.length || 1} 个场次` })),
      ),
    ),
    showDescription && event.description ? h('p', { class: 'event-row__summary', text: event.description }) : null,
    registrationActions({
      className: 'event-row__action',
      label:event.registryType?(event.status==='进行中'?'查看并登记':'查看登记记录'):isClosedActivity(event) ? '查看活动' : actionLabel || '查看并报名',
      href: href || `/events/${encodeURIComponent(event.eventId)}`,
    }),
  );
  return node;
}
