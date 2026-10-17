import { registrationActions } from './registration-actions.js';
import { h, icon } from '../core/dom.js';
import { badge, statusIndicator } from '../ui/primitives.js';
import { activityPresentation } from './activity-presentation.js';
import { eventCenterLabel } from './event-center.js';
import { eventRow } from './activity-row.js';

/** One entrance for the entire programme; weeks and shifts belong in its calendar. */
export function bloodEntry(events, { list = false } = {}) {
  const { summary } = activityPresentation(events);
  const dates = summary.dates;
  const points = [...new Set(events.map(event => event.location).filter(Boolean))];
  const period = dates.length ? `${dates[0].slice(5).replace('-', '/')} – ${dates.at(-1).slice(5).replace('-', '/')}` : '查看最新排班';
  if (list) {
    const row = eventRow({
      eventId: 'blood-programme', name: '献血车志愿服务', type: '献血车专项',
      startAt: dates[0], endAt: dates.at(-1), schedule: period,
      location: points.join(' / '), remaining: summary.remaining, full: !summary.remaining,
      status: events.some(event => event.status === '报名中') ? '报名中' : events.some(event => event.status === '进行中') ? '进行中' : '已结束',
      workflowId: 'blood-programme',
    }, {
      href: '/workflow-events?type=blood',
      actionLabel: summary.remaining ? '查看并报名' : '查看班次',
      sessionLabel: `${summary.points} 个点位 · ${summary.shifts} 个班次`,
      plaza: true,
    });
    row.dataset.programme = 'blood';
    return row;
  }
  return h('article', { class: 'blood-entry', data: { flipKey: 'blood-programme' } },
    h('div', { class: 'blood-entry__top' },
      badge(eventCenterLabel(events[0] || { blood: true }), { tone: 'accent' }),
      statusIndicator(summary.remaining ? `剩余 ${summary.remaining} 个名额` : '名额已满 · 可订阅提醒', { tone: summary.remaining ? 'success' : 'warning' })),
    h('div', { class: 'blood-entry__body' },
      h('h3', { text: '献血车志愿服务' }),
      h('p', { text: '选一个合适的班次，让爱心在城市里流动。' })),
    h('div', { class: 'blood-entry__facts' },
      h('span', {}, icon('clock', 'ico ico--sm'), h('span', null, h('small',{text:'服务日期'}), h('strong', { text: period }))),
      h('span', {}, icon('pin', 'ico ico--sm'), h('span', null, h('small',{text:`${summary.points} 个点位 · ${summary.shifts} 个班次`}), h('strong', { text: points.join(' / ') || '点位待公布' })))),
    registrationActions({ className: 'blood-entry__action', label: summary.remaining ? '查看并报名' : '查看班次', href: '/workflow-events?type=blood' }));
}
