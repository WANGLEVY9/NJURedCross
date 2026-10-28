import { plazaHeader } from '../plaza-layout.js';
/* ==========================================================================
   portal/pages/morning-plaza.js
   Read-only plaza for approved “早安晚安” member cards.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { initials, relative } from '../../core/format.js';
import { badge, button, emptyState, notice, skeletonBlock } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
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
          favorite: payload.favorite,
          onFavoriteChange: async shouldFavorite => {
            if (shouldFavorite) await morningApi.addFavorite(cardId);
            else await morningApi.removeFavorite(cardId);
            return shouldFavorite;
          },
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
    description: '每天为每位用户更新六张已审核的同行名片；发起好友邀约前，需要先让自己的名片通过审核。',
    actions: [
      button({ label: '我的名片', variant: 'secondary', iconName: 'user', href: '/morning' }),
      button({ label: '我的邀约', variant: 'secondary', iconName: 'mail', href: '/me?view=warmth&focus=member-warmth-invitations' }),
      button({ label: '我的收藏夹', variant: 'secondary', iconName: 'heart', href: '/me?view=warmth&focus=morning-favorites' }),
      button({ label: '返回内建广场', variant: 'secondary', iconName: 'chevronLeft', href: '/community' }),
    ],
    meta: [badge('注册用户可浏览', { tone: 'neutral' }), badge('邀约需名片已发布', { tone: 'info' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '浏览早安晚安广场', hint: '登录平台账号后即可浏览已审核的同行名片。' }));
    return { title: '早安晚安广场', node };
  }

  let loadSequence = 0;
  const content = h('div', { class: 'morning-content stack-6' });
  node.append(content);

  const resultStatus = h('p', {
    class: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  const listSlot = h('div', { class: 'stack-5' }, skeletonBlock('220px'), skeletonBlock('220px'), skeletonBlock('220px'));
  content.append(resultStatus, listSlot);

  async function load() {
    const sequence = ++loadSequence;
    listSlot.replaceChildren(skeletonBlock('220px'), skeletonBlock('220px'), skeletonBlock('220px'));
    let payload;
    try {
      payload = await morningApi.plaza();
    } catch (error) {
      if (sequence !== loadSequence) return;
      listSlot.replaceChildren(notice(error.message || '暂时无法打开广场。', { tone: 'error', title: '加载失败' }));
      return;
    }
    if (sequence !== loadSequence) return;

    const stats = payload.stats || {};
    const viewer = payload.viewer || {};
    const cards = payload.cards || [];
    resultStatus.textContent = `今日展示 ${cards.length} 张同行名片。`;
    if (!cards.length) {
      listSlot.replaceChildren(
        notice(
          viewer.canInvite
            ? '你可以浏览全部已审核名片并直接发起好友邀约；名片详情不会显示真实姓名、学号、邮箱或联系方式。'
            : '你可以浏览全部已审核名片；发起好友邀约前，需要先提交自己的名片并通过管理员审核。',
          { tone: 'info' },
        ),
        emptyState({
          iconName: 'handshake',
          title: '暂时还没有可浏览的名片',
          description: '等更多同学通过审核后，这里会出现他们的同行名片。',
        }),
      );
      return;
    }

    const summary = h(
      'div',
      { class: 'morning-plaza-summary', attrs: { tabindex: '-1' } },
      h('p', { class: 't-secondary', text: '这里每天只展示六张名片，次日重新抽取。珍惜与你同行的伙伴哦～' }),
      h('span', { class: 'spacer' }),
      badge(`今日 ${cards.length} 张`, { tone: 'accent' }),
      badge(`更新于 ${stats.snapshotDate || '今天'}`, { tone: 'neutral' }),
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
    );
  }

  const requestedCard = context.query.get('card') || '';
  void load();
  if (requestedCard) openMorningCardDetailModal(requestedCard);
  return { title: '早安晚安广场', node };
}
