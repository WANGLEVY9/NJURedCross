/* ==========================================================================
   portal/pages/showcase-board.js
   Shared showcase-board renderer (宣传展示内容流). Used by BOTH:
     · /outreach — 宣传广场页内嵌的展示板块（要求1：三板块合并）
     · /showcase — 保留的独立展示墙直达页
   Feed comes from 宣传展示表 (manual import + WeChat sync, same schema).
   Covers resolve via /api/public/showcase/covers/:id (302 to a fresh Box link).
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { emptyState, errorState, skeletonBlock } from '../../ui/primitives.js';
import { stagger } from '../../core/motion.js';

export function sourceLabel(source) {
  if (source === '公众号抓取') return '公众号文章';
  if (source === '手动导入') return '精选推荐';
  return source || '';
}

/** Rectangular card mirroring the events-square visual language. */
export function showcaseCard(item) {
  const cover = item.coverUrl
    ? h('img', {
        class: 'showcase-card__cover',
        attrs: { src: item.coverUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' },
      })
    : h('div', { class: 'showcase-card__cover showcase-card__cover--empty' }, icon('image', 'ico ico--lg'));

  // A cover that fails to load degrades to the icon placeholder, not a broken glyph.
  if (cover instanceof HTMLImageElement) {
    cover.addEventListener('error', () => {
      cover.replaceWith(h('div', { class: 'showcase-card__cover showcase-card__cover--empty' }, icon('image', 'ico ico--lg')));
    });
  }

  return h(
    'a',
    { class: 'showcase-card', href: item.link, attrs: { target: '_blank', rel: 'noopener noreferrer' } },
    cover,
    h('div', { class: 'showcase-card__body' },
      sourceLabel(item.source) ? h('p', { class: 'showcase-card__source', text: sourceLabel(item.source) }) : null,
      h('h3', { class: 't-h3 t-clamp-2', text: item.title })),
    h('span', { class: 'showcase-card__action' }, h('span', { text: '阅读原文' }), icon('external', 'ico ico--sm')));
}

/**
 * Fetch the feed and render groups into `slot`.
 * @param {HTMLElement} slot
 * @param {{emptyAction?: object|null, onRetry?: Function|null}} [options]
 */
export async function renderShowcaseFeed(slot, { emptyAction = null, onRetry = null } = {}) {
  slot.replaceChildren(skeletonBlock('220px'), skeletonBlock('220px'));
  let payload;
  try {
    payload = await publicApi.showcaseFeed();
  } catch (error) {
    slot.replaceChildren(errorState({ title: '展示墙暂时无法加载', error, onRetry: onRetry || undefined }));
    return;
  }
  const groups = payload.groups || [];
  if (!groups.length) {
    slot.replaceChildren(emptyState({
      iconName: 'megaphone',
      title: '展示墙还在准备中',
      description: '内容发布后会自动出现在这里，包括公众号文章与人工精选的链接。',
      actions: emptyAction ? [emptyAction] : [],
    }));
    return;
  }
  const sections = groups.map((group) => h(
    'section', { class: 'stack-4' },
    h('div', { class: 'row-3 row-between' },
      h('h2', { class: 't-h3', text: group.name }),
      h('span', { class: 't-caption t-faint', text: `${group.items.length} 条` })),
    h('div', { class: 'showcase-grid' }, ...group.items.map(showcaseCard))));
  stagger(slot);
  slot.replaceChildren(...sections);
}
