import { h, icon } from '../core/dom.js';
import { plazaHero } from './plaza-hero.js';
import { activityEmblem } from './activity-emblem.js';
import { ACTIVITY_CATEGORY_OPTIONS } from '../shared/activity-taxonomy.js';
import { EVENTS_SLIDES } from './plaza-slides.js';

const HERO_COPY = { title: '把善意，化作行动', motto: '人道 · 博爱 · 奉献', description: '从校园出发，\n让每一份热情都有回应。' };
export const EVENT_SLIDES = EVENTS_SLIDES;

export function eventsHero({ slides = EVENT_SLIDES } = {}) {
  return plazaHero({
    label: 'NJU RED CROSS · 活动广场',
    ariaLabel: '活动广场精选',
    slides,
    copy: HERO_COPY,
    actions: [h('a', { class: 'btn btn--primary', href: '/me' }, icon('user', 'ico'), h('span', { text: '我的报名' }))],
  });
}

export function eventsCategories(onSelect) {
  const descriptions = {
    '主席团专项':'凝聚骨干力量', '博爱中心':'传递人道关怀', '生命中心':'守护生命健康',
    '综事中心':'共建有序校园', '一加助残专项':'携手温暖同行',
    '献血车专项':'汇聚热血力量', '排班专项':'协力值守校园',
  };
  const categories = [...ACTIVITY_CATEGORY_OPTIONS];
  const node = h('nav', { class: 'events-categories', aria: { label: '活动类别快捷筛选' } },
    ...categories.map(category => h('button', { class: 'events-category', type: 'button', aria: { pressed: 'false' }, data: { category }, on: { click: () => onSelect(category) } },
      activityEmblem(category), h('strong', { text: category }), h('span', { text: descriptions[category], title: descriptions[category] }))));
  return { node, setValue: value => [...node.children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === value))) };
}

export function eventsGuide() {
  return h('aside', { class: 'events-guide', aria: { label: '参与流程' } }, h('h2', { text: '参与流程' }),
    h('ol', {}, ...[['选择活动', '浏览感兴趣的活动'], ['提交报名', '填写并提交报名信息'], ['等待确认', '查看审核结果'], ['到场参与', '按时参加活动']].map(([title, detail], i) =>
      h('li', {}, h('b', { text: String(i + 1) }), h('div', {}, h('strong', { text: title }), h('span', { text: detail }))))));
}
