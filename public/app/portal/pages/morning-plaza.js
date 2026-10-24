import { plazaHeader } from '../plaza-layout.js';
/* ==========================================================================
   portal/pages/morning-plaza.js
   Read-only plaza for approved “早安晚安” member cards.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { initials, relative } from '../../core/format.js';
import { badge, button, emptyState, notice, skeletonBlock } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { patchQuery } from '../../core/router.js';
import { loginRequiredPanel } from '../auth-gate.js';
import { buildMorningCardDetail, morningCardMetadata } from './morning-card-detail.js';
import { openMorningInviteDrawer } from '../morning-invitation.js';

function cardNode(card, { canInvite = false } = {}) {
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
        ),
      ),
      card.campus ? badge(card.campus, { tone: 'accent' }) : badge('未填写校区', { tone: 'neutral' }),
    ),
    ...morningCardMetadata(card),
    h('p', { class: 'morning-plaza-card__note', text: card.notePreview || '这位同学还没有留下留言。' }),
    h('footer', { class: 'morning-plaza-card__foot' },
      h(
        'div',
        { class: 'row-2 row-wrap' },
        badge(canInvite ? '可发起好友邀约' : '邀约需先审核名片', {
          tone: canInvite ? 'accent' : 'warning',
          iconName: canInvite ? 'send' : 'user',
        }),
        badge('已通过审核', { tone: 'success' }),
      ),
      h('span', { class: 't-caption t-muted', text: card.hasMoreNote ? '点击查看完整留言' : publishedLabel }),
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
    description: '这里展示对方公开的同行名片信息和完整留言。',
    body,
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
        buildMorningCardDetail(payload.card, {
          onInvite: card => {
            drawer.close();
            openMorningInviteDrawer(card, { viewer: payload.viewer });
          },
        }),
      );
    })
    .catch((error) => {
      body.replaceChildren(notice(error.message || '暂时无法读取这张名片。', { tone: 'error', title: '加载失败' }));
    });
  return drawer;
}

export default async function morningPlazaPage(context) {
  const node = h('div', { class: 'view morning-view morning-plaza-view' });
  node.append(plazaHeader({
    label: '早安晚安',
    title: '同行广场',
    description: '注册用户都可以浏览已审核的同行名片；发起好友邀约前，需要先让自己的名片通过审核。',
    actions: [
      button({ label: '我的名片', variant: 'secondary', iconName: 'user', href: '/morning' }),
      button({ label: '返回内建广场', variant: 'secondary', iconName: 'chevronLeft', href: '/community' }),
    ],
    meta: [badge('注册用户可浏览', { tone: 'neutral' }), badge('邀约需名片已发布', { tone: 'info' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '浏览早安晚安广场', hint: '登录平台账号后即可浏览已审核的同行名片。' }));
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
  const resultStatus = h('p', {
    class: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  const searchBar = h(
    'section',
    { class: 'morning-plaza-search' },
    h('div', { class: 'morning-plaza-search__field' }, h('div', { class: 'input-group' }, icon('search', 'ico ico--sm'), searchInput), clearSearchButton),
    h('p', { class: 't-caption t-muted', text: '仅按兴趣标签搜索；可用空格、逗号或顿号分隔多个标签，结果需同时命中。' }),
    resultStatus,
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
      listSlot.replaceChildren(notice(error.message || '暂时无法打开广场。', { tone: 'error', title: '加载失败' }));
      return;
    }
    if (sequence !== loadSequence) return;

    const stats = payload.stats || {};
    const viewer = payload.viewer || {};
    page = stats.page || page;
    const cards = payload.cards || [];
    patchQuery({ q: searchQuery || null, page: page > 1 ? page : null });
    resultStatus.textContent = searchQuery
      ? `标签“${searchQuery}”共找到 ${stats.total} 张名片，当前第 ${page} 页，共 ${stats.totalPages} 页。`
      : `共 ${stats.total} 张名片，当前第 ${page} 页，共 ${stats.totalPages} 页。`;
    if (!cards.length) {
      listSlot.replaceChildren(
        notice(
          viewer.canInvite
            ? '你可以浏览全部已审核名片并直接发起好友邀约；名片详情不会显示真实姓名、学号、邮箱或联系方式。'
            : '你可以浏览全部已审核名片；发起好友邀约前，需要先提交自己的名片并通过管理员审核。',
          { tone: 'info' },
        ),
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
    const summary = h(
      'div',
      { class: 'morning-plaza-summary', attrs: { tabindex: '-1' } },
      h('div', { class: 'stack-1' }, h('p', { class: 't-label', text: '广场排序' }), h('p', { class: 't-secondary', text: '名片按发布时间从新到旧展示。' })),
      h('span', { class: 'spacer' }),
      searchQuery ? badge(`标签：${searchQuery}`, { tone: 'warning' }) : null,
      badge(`共 ${stats.total} 张名片`, { tone: 'accent' }),
      badge(`第 ${page} / ${stats.totalPages} 页`, { tone: 'neutral' }),
      badge(viewer.canInvite ? '可发起邀约' : '邀约需先审核名片', { tone: viewer.canInvite ? 'success' : 'warning' }),
    );
    listSlot.replaceChildren(
      summary,
      notice(
        viewer.canInvite
          ? '这里只展示他人已通过审核的名片，不展示真实姓名、学号、邮箱或联系方式。'
          : '浏览不受报名状态限制；发起好友邀约时，平台会先要求你提交自己的名片并等待管理员审核。',
        { tone: 'info' },
      ),
      h(
        'section',
        { class: 'morning-plaza-grid', attrs: { 'aria-label': '早安晚安同行名片列表' } },
        ...cards.map(card => cardNode(card, { canInvite: viewer.canInvite })),
      ),
      ...(pager ? [pager] : []),
    );
    if (scroll) {
      listSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      requestAnimationFrame(() => summary.focus());
    }
  }

  const requestedCard = context.query.get('card') || '';
  void load(page);
  if (requestedCard) openMorningCardDetailModal(requestedCard);
  return { title: '早安晚安广场', node };
}
