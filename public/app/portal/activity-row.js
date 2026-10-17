import { h, icon } from '../core/dom.js';
import { badge, statusIndicator } from '../ui/primitives.js';
import { registrationActions } from './registration-actions.js';
import { eventCenterLabel } from './event-center.js';
import { activityKind } from '../shared/activity-taxonomy.js';
import { activityEmblem } from './activity-emblem.js';
import * as fmt from '../core/format.js';

export function eventRow(event, { href, actionLabel, sessionLabel, plaza = false } = {}) {
  const category = eventCenterLabel(event) === '献血车专项' ? '献血车专项' : activityKind({...event,center:event.center||event.category});
  const emblem = activityEmblem(category);
  const capacity = Number(event.capacity), confirmed = Number(event.confirmed);
  const occupancy = plaza && event.capacity != null && event.confirmed != null && Number.isFinite(capacity) && capacity > 0 && Number.isFinite(confirmed) ? `${confirmed}/${capacity}` : null;
  const start = fmt.toDate(event.startAt), end = fmt.toDate(event.endAt);
  const sameDay = start && (!end || fmt.date(start) === fmt.date(end));
  const dateLabel = plaza && sameDay
    ? `${new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'}).format(start)}（${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(start)}）${/[ T]\d{2}:\d{2}/.test(String(event.startAt)) ? ` ${fmt.time(start)}${end ? ` - ${fmt.time(end)}` : ''}` : ''}`
    : fmt.activityDateRange(event.startAt, event.endAt);
  const action = registrationActions({className:'event-row__action',label:actionLabel || (event.status === '报名中' && !event.full ? '查看并报名' : '查看详情'),href:href || `/events/${encodeURIComponent(event.eventId)}`});
  const meta = sessionLabel || (event.serviceHours != null && event.serviceHours !== '' && Number.isFinite(Number(event.serviceHours)) ? `服务时长 ${Number(event.serviceHours)} 小时` : `${event.sessions?.length || 1} 个场次`);
  const node = h(
    'article',
    {class:`event-row event-row--category${plaza ? ' event-row--plaza' : ''}`,data:{flipKey:event.eventId,category,startAt:event.startAt || event.registrationEnd || ''}},
    h(
      'div',
      { class: 'event-row__date' },
      emblem,
      h('b', { text: fmt.dayOfMonth(event.startAt || event.registrationEnd) }),
      h('span', { text: fmt.monthLabel(event.startAt || event.registrationEnd) || '待定' }),
    ),
    h(
      'div',
      { class: 'event-row__body' },
      h(
        'div',
        { class: 'row-2 row-wrap' },
        badge(category==='未分类'?eventCenterLabel(event):category, { tone: 'accent' }),
        event.status === '报名中'
          ? statusIndicator(occupancy || (event.full ? (event.workflowId ? '名额已满' : '名额已满 · 可候补') : `剩余 ${event.remaining} 个名额`), { tone: occupancy ? 'success' : event.full ? 'warning' : 'success', live: true })
          : statusIndicator(event.status, { tone: event.status === '进行中' ? 'info' : 'idle' }),
      ),
      h('h3', { class: 't-h3 t-clamp-1', text: event.name }),
      h(
        'div',
        { class: 'event-row__facts' },
        h('div', { class: 'event__fact', data: { fact: 'date' } }, icon(plaza ? 'calendar' : 'clock', 'ico ico--sm'), h('span', { class: 'event-row__fact-label', text: '日期' }), h('span', { text: dateLabel })),
        h('div', { class: 'event__fact', data: { fact: 'location' } }, icon('pin', 'ico ico--sm'), h('span', { class: 'event-row__fact-label', text: '地点' }), h('span', { text: [event.campus, event.location].filter(Boolean).join(' · ') || '地点待公布' })),
        !plaza ? h('div', { class: 'event__fact', data: { fact: 'sessions' } }, icon('list', 'ico ico--sm'), h('span', { class: 'event-row__fact-label', text: '安排' }), h('span', { text: sessionLabel || `${event.sessions?.length || 1} 个场次` })) : null,
      ),
    ),
    event.description ? h('p', { class: 'event-row__summary', text: event.description }) : null,
    plaza ? h('div', {class:'event-row__footer'}, h('div',{class:'event-row__meta',data:{fact:'sessions'}},icon('clock','ico ico--sm'),h('span',{text:meta})),action) : action,
  );
  return node;
}

