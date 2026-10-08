/* ==========================================================================
   portal/pages/showcase.js
   The showcase board (宣传展示) — kept as a standalone direct-link page.
   宣传广场（/outreach）已内嵌同一内容流（要求1：三板块合并）；本页复用
   showcase-board.js 的渲染，保证两处完全一致。
   ========================================================================== */

import { h } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';
import { navigate } from '../../core/router.js';
import { renderShowcaseFeed } from './showcase-board.js';

export default async function showcasePage() {
  const listSlot = h('div', { class: 'stack-6' });

  const node = h('div', { class: 'view' },
    h('section', { class: 'psection psection--tight' },
      h('div', { class: 'psection__head' },
        h('div', { class: 'psection__head-text' },
          h('p', { class: 't-label', text: '宣传展示' }),
          h('h1', { class: 't-h1', text: '来自南京大学红十字会的精选内容' }),
          h('p', { class: 't-secondary', text: '公众号文章与精选推荐在这里汇成一块展示墙，点击卡片即可跳转阅读。' }))),
      listSlot));

  renderShowcaseFeed(listSlot, {
    emptyAction: button({ label: '去活动广场看看', variant: 'secondary', href: '/events' }),
    onRetry: () => navigate('/showcase', { replace: true }),
  });

  return { title: '宣传展示', node };
}
