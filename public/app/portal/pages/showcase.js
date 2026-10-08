/* ==========================================================================
   portal/pages/showcase.js
   Task: the showcase board (宣传展示板块) — a pure, public display of
   rectangular cards (cover + title + outbound link). Feed comes from the
   宣传展示表, which is fed by two interchangeable sources: manual batch
   import (scripts/import-showcase.mjs) and WeChat official-account article
   sync (lib/attachment/showcase-source.js). Both land in the same schema,
   so this page renders them identically — no branching per source.
   Covers resolve through /api/public/showcase/covers/:id, which 302s to a
   fresh NJU Box direct link each time (CSP img-src allows https:).
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { button, emptyState, errorState, skeletonBlock } from '../../ui/primitives.js';
import { navigate } from '../../core/router.js';
import { stagger } from '../../core/motion.js';

function sourceLabel(source) {
  if (source === '公众号抓取') return '公众号文章';
  if (source === '手动导入') return '精选推荐';
  return source || '';
}

/** Rectangular card mirroring the events-square visual language. */
function showcaseCard(item) {
  const cover = item.coverUrl
    ? h('img', {
        class: 'showcase-card__cover',
        attrs: { src: item.coverUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' },
      })
    : h('div', { class: 'showcase-card__cover showcase-card__cover--empty' },
        icon('image', 'ico ico--lg'));

  // A cover that fails to load (Box not configured, file moved) degrades to
  // the icon placeholder instead of a broken-image glyph.
  if (cover instanceof HTMLImageElement) {
    cover.addEventListener('error', () => {
      cover.replaceWith(h('div', { class: 'showcase-card__cover showcase-card__cover--empty' }, icon('image', 'ico ico--lg')));
    });
  }

  return h(
    'a',
    {
      class: 'showcase-card',
      href: item.link,
      attrs: { target: '_blank', rel: 'noopener noreferrer' },
    },
    cover,
    h(
      'div',
      { class: 'showcase-card__body' },
      sourceLabel(item.source) ? h('p', { class: 'showcase-card__source', text: sourceLabel(item.source) }) : null,
      h('h3', { class: 't-h3 t-clamp-2', text: item.title }),
    ),
    h('span', { class: 'showcase-card__action' }, h('span', { text: '阅读原文' }), icon('external', 'ico ico--sm')),
  );
}

export default async function showcasePage() {
  const listSlot = h(
    'div',
    { class: 'stack-6' },
    skeletonBlock('220px'),
    skeletonBlock('220px'),
  );

  const node = h(
    'div',
    { class: 'view' },
    h(
      'section',
      { class: 'psection psection--tight' },
      h(
        'div',
        { class: 'psection__head' },
        h(
          'div',
          { class: 'psection__head-text' },
          h('p', { class: 't-label', text: '宣传展示' }),
          h('h1', { class: 't-h1', text: '来自南京大学红十字会的精选内容' }),
          h('p', { class: 't-secondary', text: '公众号文章与精选推荐在这里汇成一块展示墙，点击卡片即可跳转阅读。' }),
        ),
      ),
      listSlot,
    ),
  );

  publicApi
    .showcaseFeed()
    .then((payload) => {
      const groups = payload.groups || [];
      if (!groups.length) {
        listSlot.replaceChildren(
          emptyState({
            iconName: 'megaphone',
            title: '展示墙还在准备中',
            description: '内容发布后会自动出现在这里，包括公众号文章与人工精选的链接。',
            actions: [button({ label: '去活动广场看看', variant: 'secondary', href: '/events' })],
          }),
        );
        return;
      }
      const sections = groups.map((group) =>
        h(
          'section',
          { class: 'stack-4' },
          h('div', { class: 'row-3 row-between' },
            h('h2', { class: 't-h3', text: group.name }),
            h('span', { class: 't-caption t-faint', text: `${group.items.length} 条` })),
          h('div', { class: 'showcase-grid' }, ...group.items.map(showcaseCard)),
        ),
      );
      stagger(listSlot);
      listSlot.replaceChildren(...sections);
    })
    .catch((error) => {
      listSlot.replaceChildren(errorState({ title: '展示墙暂时无法加载', error, onRetry: () => navigate('/showcase', { replace: true }) }));
    });

  return { title: '宣传展示', node };
}
