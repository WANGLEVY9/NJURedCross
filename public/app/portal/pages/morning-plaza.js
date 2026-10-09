/* ==========================================================================
   portal/pages/morning-plaza.js
   Read-only plaza for approved “早安晚安” member cards.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { initials, relative } from '../../core/format.js';
import { badge, button, emptyState, notice, pageHead, skeletonBlock } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { patchQuery } from '../../core/router.js';
import { loginRequiredPanel } from '../auth-gate.js';
import { buildMorningCardDetail } from './morning-card-detail.js';
import { buildMorningCommentsPanel } from '../morning-comments.js';

function tagNode(tag) {
  return h('span', { class: 'morning-plaza-card__tag', text: tag });
}

function cardNode(card) {
  const publishedLabel = card.publishedAt ? `发布于 ${relative(card.publishedAt)}` : '已通过管理员审核';
  return h(
    'a',
    {
      class: 'morning-plaza-card',
      href: `/morning/plaza/${encodeURIComponent(card.id)}`,
      attrs: { 'aria-label': `查看 ${card.nickname || '这位同学'} 的名片详情` },
      on: {
        click: (event) => {
          event.preventDefault();
          openMorningCardDetailModal(card.id);
        },
      },
    },
    h('p', { class: 'morning-plaza-card__letterhead', text: '早安晚安 · 同行信笺' }),
    h(
      'header',
      { class: 'morning-plaza-card__head' },
      h(
        'div',
        { class: 'morning-plaza-card__identity' },
        h('span', { class: 'morning-plaza-card__avatar', 'aria-hidden': 'true', text: initials(card.nickname) }),
        h(
          'div',
          { class: 'morning-plaza-card__title' },
          h('h2', { class: 't-h3', text: card.nickname || '未命名同行' }),
          h('p', { class: 't-caption t-muted', text: card.campus ? `${card.campus}校区` : '校区未填写' }),
        ),
      ),
      card.campus ? badge(card.campus, { tone: 'accent' }) : badge('未填写校区', { tone: 'neutral' }),
    ),
    card.interestTags.length
      ? h('div', { class: 'morning-plaza-card__tags' }, ...card.interestTags.map(tagNode))
      : h('p', { class: 't-caption t-muted', text: '暂未填写兴趣标签' }),
    h('p', { class: 'morning-plaza-card__note', text: card.notePreview || '这位同学还没有留下备注。' }),
    h('footer', { class: 'morning-plaza-card__foot' },
      h(
        'div',
        { class: 'row-2 row-wrap' },
        badge(card.commentCount ? `${card.commentCount} 条评论` : '暂无评论', { tone: card.commentCount ? 'accent' : 'neutral' }),
        badge('已通过审核', { tone: 'success' }),
      ),
      h('span', { class: 't-caption t-muted', text: card.hasMoreNote ? '点击查看完整备注' : publishedLabel }),
    ),
  );
}

function pageNumbers(current, total) {
  const values = new Set([1, total, current - 1, current, current + 1]);
  const pages = [...values].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
  const output = [];
  let previous = 0;
  for (const page of pages) {
    if (page - previous > 1) output.push('…');
    output.push(page);
    previous = page;
  }
  return output;
}

function plazaPager(stats, { onSelect } = {}) {
  if (stats.totalPages <= 1) return null;
  return h(
    'nav',
    { class: 'morning-plaza-pager', attrs: { 'aria-label': '同行名片分页' } },
    button({
      label: '上一页',
      variant: 'secondary',
      size: 'sm',
      iconName: 'chevronLeft',
      disabled: !stats.hasPrevious,
      onClick: () => onSelect?.(stats.page - 1),
    }),
    h(
      'div',
      { class: 'morning-plaza-pager__pages' },
      ...pageNumbers(stats.page, stats.totalPages).map((page) => page === '…'
        ? h('span', { class: 'morning-plaza-pager__ellipsis', text: page, attrs: { 'aria-hidden': 'true' } })
        : button({
            label: String(page),
            variant: page === stats.page ? 'primary' : 'ghost',
            size: 'sm',
            ariaLabel: `第 ${page} 页`,
            data: { current: String(page === stats.page) },
            onClick: () => onSelect?.(page),
          })),
    ),
    button({
      label: '下一页',
      variant: 'secondary',
      size: 'sm',
      iconAfter: 'arrowRight',
      disabled: !stats.hasNext,
      onClick: () => onSelect?.(stats.page + 1),
    }),
  );
}

function openMorningCardDetailModal(cardId) {
  const body = h('div', { class: 'stack-4' }, notice('正在读取名片详情…', { tone: 'neutral' }));
  let drawer;
  drawer = openDrawer({
    placement: 'center',
    width: 720,
    eyebrow: '早安晚安 · 同行广场',
    title: '名片详情',
    description: '这里展示对方公开的同行名片信息和完整备注。',
    body,
    scrimClass: 'scrim--blur-strong',
    surfaceClass: 'morning-detail-modal',
    footer: [
      h('span', { class: 'spacer' }),
      button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }),
    ],
  });
  morningApi.plazaCard(cardId)
    .then((payload) => {
      body.replaceChildren(
        notice('详情弹窗仍不会展示真实姓名、学号、邮箱或联系方式。', { tone: 'info' }),
        buildMorningCardDetail(payload.card),
        buildMorningCommentsPanel(payload.card.id, { allowEmail: payload.card.allowEmail }),
      );
    })
    .catch((error) => {
      body.replaceChildren(notice(error.message || '暂时无法读取这张名片。', { tone: 'error', title: '加载失败' }));
    });
  return drawer;
}

export default async function morningPlazaPage(context) {
  const node = h('div', { class: 'view morning-view morning-plaza-view' });
  node.append(pageHead({
    label: '早安晚安',
    title: '同行广场',
    description: '浏览通过审核的同行名片，按评论热度和发布时间综合排序。',
    actions: [button({ label: '返回内建中心', variant: 'secondary', iconName: 'chevronLeft', href: '/community' })],
    meta: [badge('仅报名成员可见', { tone: 'neutral' }), badge('只展示已通过', { tone: 'success' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '浏览早安晚安广场', hint: '登录并完成报名后才能查看广场。' }));
    return { title: '早安晚安广场', node };
  }

  const requestedPage = Number(context.query.get('page') || 1);
  let page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  let searchQuery = String(context.query.get('q') || '').trim();
  let searchTimer = 0;
  let loadSequence = 0;
  const content = h('div', { class: 'morning-content stack-6' });
  node.append(content);

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    value: searchQuery,
    placeholder: '搜索兴趣标签，例如：摄影、跑步',
    autocomplete: 'off',
    attrs: { 'aria-label': '按兴趣标签搜索同行名片' },
  });
  const clearSearchButton = button({
    label: '清除',
    variant: 'ghost',
    size: 'sm',
    iconName: 'close',
    disabled: !searchQuery,
    onClick: () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchButton.disabled = true;
      void load(1);
    },
  });
  const searchBar = h(
    'section',
    { class: 'morning-plaza-search' },
    h('div', { class: 'morning-plaza-search__field' }, h('div', { class: 'input-group' }, icon('search', 'ico ico--sm'), searchInput), clearSearchButton),
    h('p', { class: 't-caption t-muted', text: '仅按兴趣标签搜索；可用空格、逗号或顿号分隔多个标签，结果需同时命中。' }),
  );
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    clearSearchButton.disabled = !searchQuery;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void load(1), 260);
  });

  const listSlot = h('div', { class: 'stack-5' }, skeletonBlock('220px'), skeletonBlock('220px'), skeletonBlock('220px'));
  content.append(searchBar, listSlot);

  async function load(nextPage = page, { scroll = false } = {}) {
    page = Math.max(1, Number(nextPage) || 1);
    const sequence = ++loadSequence;
    listSlot.replaceChildren(skeletonBlock('220px'), skeletonBlock('220px'), skeletonBlock('220px'));
    let payload;
    try {
      payload = await morningApi.plaza({ page, q: searchQuery });
    } catch (error) {
      if (sequence !== loadSequence) return;
      if (error.code === 'morning_card_required') {
        listSlot.replaceChildren(emptyState({
          iconName: 'handshake',
          title: '报名后进入广场',
          description: '完成早安晚安报名后，就能浏览已经通过审核的同行名片。',
          actions: [button({ label: '回到内建中心报名', variant: 'primary', iconName: 'arrowRight', href: '/community' })],
        }));
        return;
      }
      listSlot.replaceChildren(notice(error.message || '暂时无法打开广场。', { tone: 'error', title: '加载失败' }));
      return;
    }
    if (sequence !== loadSequence) return;

    const stats = payload.stats || {};
    page = stats.page || page;
    const cards = payload.cards || [];
    patchQuery({ q: searchQuery || null, page: page > 1 ? page : null });
    if (!cards.length) {
      listSlot.replaceChildren(
        notice('广场只展示管理员审核通过的他人名片；不会显示真实姓名、学号、邮箱或联系方式。', { tone: 'info' }),
        emptyState({
          iconName: searchQuery ? 'search' : 'handshake',
          title: searchQuery ? '没有匹配这些标签的名片' : '暂时还没有可浏览的名片',
          description: searchQuery
            ? `当前搜索：${searchQuery}。可以尝试减少标签或改用更常见的兴趣词。`
            : '等更多同学通过审核后，这里会出现他们的同行名片。',
          actions: searchQuery
            ? [button({
                label: '清除标签搜索',
                variant: 'secondary',
                iconName: 'close',
                onClick: () => {
                  searchInput.value = '';
                  searchQuery = '';
                  clearSearchButton.disabled = true;
                  void load(1);
                },
              })]
            : [],
        }),
      );
      return;
    }

    const pager = plazaPager(stats, { onSelect: (target) => load(target, { scroll: true }) });
    listSlot.replaceChildren(
      h(
        'div',
        { class: 'morning-plaza-summary' },
        h('div', { class: 'stack-1' }, h('p', { class: 't-label', text: '广场排序' }), h('p', { class: 't-secondary', text: '热度由可见评论数计算，发布时间作为近期加权与同分排序依据。' })),
        h('span', { class: 'spacer' }),
        searchQuery ? badge(`标签：${searchQuery}`, { tone: 'warning' }) : null,
        badge(`共 ${stats.total} 张名片`, { tone: 'accent' }),
        badge(`第 ${page} / ${stats.totalPages} 页`, { tone: 'neutral' }),
      ),
      notice('这里只展示他人已通过审核的名片，不展示真实姓名、学号、邮箱或联系方式。', { tone: 'info' }),
      h('section', { class: 'morning-plaza-grid', attrs: { 'aria-label': '早安晚安同行名片列表' } }, ...cards.map(cardNode)),
      pager,
    );
    if (scroll) listSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  await load(page);
  return { title: '早安晚安广场', node };
}
