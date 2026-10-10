/* ==========================================================================
   portal/pages/showcase-board.js
   Shared showcase-board renderer (宣传展示内容流). Used by BOTH:
     · /outreach — 宣传广场页内的展示入口
     · /showcase — 独立展示墙直达页
   v3 第 14 项：展示墙拆两板块
     · 【公众号推文】按「展示分类」3 栏目分节（活动总结 / 暑期专项 / 新闻）
     · 【文创展示】按「文创类别」分节（徽章 / 贴纸 / 卡牌 / …）
   Feed comes from 宣传展示表（推文，手动导入 + 公众号同步）+ 已通过的文创设计投稿。
   Covers resolve via /api/public/showcase/covers/:id & /design-cover/:id (302 → Box).
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { chip, emptyState, errorState, skeletonBlock } from '../../ui/primitives.js';
import { stagger } from '../../core/motion.js';

export function sourceLabel(source) {
  if (source === '公众号抓取') return '公众号文章';
  if (source === '手动导入') return '精选推荐';
  return source || '';
}

/** 公众号推文卡片：封面 + 标题 + 阅读原文。 */
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

/** 文创作品卡片：缩略图 + 作品标题 + 笔名（匿名展示）。 */
export function designCard(item) {
  const cover = item.coverUrl
    ? h('img', {
        class: 'showcase-card__cover',
        attrs: { src: item.coverUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' },
      })
    : h('div', { class: 'showcase-card__cover showcase-card__cover--empty' }, icon('sparkle', 'ico ico--lg'));

  if (cover instanceof HTMLImageElement) {
    cover.addEventListener('error', () => {
      cover.replaceWith(h('div', { class: 'showcase-card__cover showcase-card__cover--empty' }, icon('sparkle', 'ico ico--lg')));
    });
  }

  return h(
    'article', { class: 'showcase-card showcase-card--design' },
    cover,
    h('div', { class: 'showcase-card__body' },
      h('p', { class: 'showcase-card__source', text: item.group || '文创设计' }),
      h('h3', { class: 't-h3 t-clamp-2', text: item.title }),
      h('p', { class: 'showcase-card__pen', text: `笔名 · ${item.penName || '匿名创作者'}` })),
    h('span', { class: 'showcase-card__action' }, h('span', { text: '文创设计' }), icon('sparkle', 'ico ico--sm')));
}

/** 单个展示板的 section（标题 + 分节）。 */
function boardSection(board, cardFn) {
  if (!board || !board.groups?.length) return null;
  return h('section', { class: 'stack-4 showcase-board' },
    h('div', { class: 'row-3 row-between' },
      h('h2', { class: 't-h2', text: board.title }),
      h('span', { class: 't-caption t-faint', text: `${board.total} 件` })),
    ...board.groups.map((group) => h(
      'section', { class: 'stack-3' },
      h('div', { class: 'row-3 row-between' },
        h('h3', { class: 't-h3', text: group.name }),
        h('span', { class: 't-caption t-faint', text: `${group.items.length} 条` })),
      h('div', { class: 'showcase-grid' }, ...group.items.map(cardFn)))));
}

/**
 * Fetch the feed and render the two boards into `slot`.
 * v3 第 15 项：公众号推文板加「栏目标签芯片筛选」（点栏目只看该栏目）。
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
  const boards = payload.boards || {};
  const postBoard = boards.posts;
  const designBoard = boards.designs;
  if ((!postBoard || !postBoard.groups?.length) && (!designBoard || !designBoard.groups?.length)) {
    slot.replaceChildren(emptyState({
      iconName: 'megaphone',
      title: '展示墙还在准备中',
      description: '内容发布后会自动出现在这里，包括公众号文章与已通过的文创作品。',
      actions: emptyAction ? [emptyAction] : [],
    }));
    return;
  }

  let activeCategory = '';
  const filterRow = h('div', { class: 'chip-row', attrs: { role: 'group', 'aria-label': '推文栏目筛选' } });
  const boardsWrap = h('div', { class: 'stack-6' });

  function renderBoards() {
    const filteredPosts = postBoard
      ? {
        ...postBoard,
        groups: activeCategory
          ? postBoard.groups.filter((group) => group.name === activeCategory)
          : postBoard.groups,
      }
      : null;
    const sections = [
      boardSection(filteredPosts, showcaseCard),
      boardSection(designBoard, designCard),
    ].filter(Boolean);
    boardsWrap.replaceChildren(...sections);
    stagger(boardsWrap);
  }

  // 栏目芯片：仅展示「公众号推文」板里实际出现的栏目（含「全部」）。
  const categories = postBoard?.groups?.map((group) => group.name) || [];
  if (categories.length > 1) {
    filterRow.replaceChildren(
      chip('全部栏目', {
        selected: true,
        onClick: () => { activeCategory = ''; syncFilterChips(); renderBoards(); },
      }),
      ...categories.map((name) => chip(name, {
        selected: false,
        count: postBoard.groups.find((group) => group.name === name)?.items.length || 0,
        onClick: () => { activeCategory = activeCategory === name ? '' : name; syncFilterChips(); renderBoards(); },
      })),
    );
  }
  function syncFilterChips() {
    [...filterRow.children].forEach((node) => {
      const label = node.textContent.trim().replace(/\s*\d+$/, '');
      const isAll = label === '全部栏目';
      const on = isAll ? !activeCategory : label === activeCategory;
      node.setAttribute('aria-pressed', String(on));
    });
  }

  renderBoards();
  slot.replaceChildren(...(filterRow.children.length ? [filterRow] : []), boardsWrap);
}

