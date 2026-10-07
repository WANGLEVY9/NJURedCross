import { h, icon } from '../core/dom.js';
import { activityPresentation } from './activity-presentation.js';

/** One entrance for the entire programme; weeks and shifts belong in its calendar. */
export function bloodEntry(events) {
  const { summary } = activityPresentation(events);
  const dates = summary.dates;
  const period = dates.length ? `${dates[0].slice(5).replace('-', '/')} – ${dates.at(-1).slice(5).replace('-', '/')}` : '查看最新排班';
  return h('a', { class: 'blood-entry', href: '/workflow-events?type=blood', data: { flipKey: 'blood-programme' } },
    h('div', { class: 'blood-entry__top' },
      h('span', { class: 'blood-entry__icon' }, icon('calendar')),
      h('span', { class: 'blood-entry__availability', text: summary.remaining ? `${summary.remaining} 个可报名名额` : '查看班次与空位提醒' })),
    h('div', { class: 'blood-entry__body' },
      h('h3', { text: '献血车志愿服务' }),
      h('p', { text: '在日历中选择周次、点位和班次，查看报名进度。' })),
    h('div', { class: 'blood-entry__facts' },
      h('span', {}, icon('clock', 'ico ico--sm'), h('span', { text: period })),
      h('span', {}, icon('pin', 'ico ico--sm'), h('span', { text: `${summary.points} 个点位 · ${summary.shifts} 个班次` }))),
    h('div', { class: 'blood-entry__action' }, h('span', { text: '打开报名日历' }), icon('arrowRight')));
}
