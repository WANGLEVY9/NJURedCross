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
        h('div', { class: 'row-3 row-wrap' }, h('span', { class: 't-label', text: '内建广场' }), h('span', { class: 'badge badge--warning' }, '待开发')),
        h('h1', { class: 't-h1', text: '早安晚安正在准备中' }),
        h('p', { class: 't-prose', text: '报名名片、广场展示、评论互动和联系方式公开将在后续版本逐步开放。' }),
        notice('当前入口只用于说明功能状态，报名暂未开放。', { tone: 'warning', title: '待开发' }),
        h('div', { class: 'row-3 row-wrap' }, button({ label: '返回内建广场', variant: 'primary', iconName: 'heart', href: '/community' })),
      ),
    ),
  );
  return { title: '早安晚安 · 待开发', node };
}
