import { h, icon } from '../../core/dom.js';
import { button, notice } from '../../ui/primitives.js';

export default async function morningComingSoonPage() {
  const node = h(
    'div',
    { class: 'view formpage' },
    h(
      'section',
      { class: 'panel panel--raised' },
      h(
        'div',
        { class: 'panel__body stack-4' },
        h('a', { class: 't-caption t-muted row-2', href: '/community' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回内建广场' })),
        h('div', { class: 'row-3 row-wrap' }, h('span', { class: 't-label', text: '内建广场' }), h('span', { class: 'badge badge--success' }, '已开放')),
        h('h1', { class: 't-h1', text: '早安晚安已开放' }),
        h('p', { class: 't-prose', text: '完成报名并经管理员审核后，可以进入同行广场浏览其他成员的名片，并在详情中留言。' }),
        notice('报名与同行广场已开放。请先报名，审核通过后进入广场浏览。', { tone: 'success', title: '可以开始' }),
        h('div', { class: 'row-3 row-wrap' },
          button({ label: '进入内建广场报名', variant: 'primary', iconName: 'heart', href: '/community' }),
          button({ label: '查看同行广场', variant: 'secondary', iconName: 'arrowRight', href: '/morning/plaza' }),
        ),
      ),
    ),
  );
  return { title: '早安晚安 · 已开放', node };
}
