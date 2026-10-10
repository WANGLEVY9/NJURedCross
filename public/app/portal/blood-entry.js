import { registrationActions } from './registration-actions.js';
import { h, icon } from '../core/dom.js';
import { badge, statusIndicator } from '../ui/primitives.js';
import { activityPresentation } from './activity-presentation.js';

/** One entrance for the entire programme; weeks and shifts belong in its calendar. */
export function bloodEntry(events) {
  const { summary } = activityPresentation(events);
  const dates = summary.dates;
  const points = [...new Set(events.map(event => event.location).filter(Boolean))];
  const period = dates.length ? `${dates[0].slice(5).replace('-', '/')} – ${dates.at(-1).slice(5).replace('-', '/')}` : '查看最新排班';
  return h('article', { class: 'blood-entry', data: { flipKey: 'blood-programme' } },
    h('div', { class: 'blood-entry__top' },
      badge('献血车专项', { tone: 'accent' }),
      statusIndicator(summary.remaining ? `剩余 ${summary.remaining} 个名额` : '名额已满 · 可订阅提醒', { tone: summary.remaining ? 'success' : 'warning' })),
    h('div', { class: 'blood-entry__body' },
      h('h3', { text: '献血车志愿服务' }),
      h('p', { text: '选一个合适的班次，让爱心在城市里流动。' })),
    h('div', { class: 'blood-entry__facts' },
      h('span', {}, icon('clock', 'ico ico--sm'), h('span', null, h('small',{text:'服务日期'}), h('strong', { text: period }))),
      h('span', {}, icon('pin', 'ico ico--sm'), h('span', null, h('small',{text:`${summary.points} 个点位 · ${summary.shifts} 个班次`}), h('strong', { text: points.join(' / ') || '点位待公布' })))),
    registrationActions({ className: 'blood-entry__action', label: summary.remaining ? '查看并报名' : '查看班次', href: '/workflow-events?type=blood' }));
}
