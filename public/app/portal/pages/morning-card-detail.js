/* ==========================================================================
   portal/pages/morning-card-detail.js
   Full public detail for one approved “早安晚安” plaza card.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { fullDateTime, initials } from '../../core/format.js';
import { badge, button, emptyState, notice, pageHead } from '../../ui/primitives.js';
import { loginRequiredPanel } from '../auth-gate.js';
import { openMorningInviteDrawer } from '../morning-invitation.js';
import { reportError } from '../../core/toast.js';

function tagNode(tag) {
  return h('span', { class: 'morning-plaza-card__tag', text: tag });
}

export function morningCardMetadata(card) {
  const profile = [
    card.gender,
    card.department,
    card.grade,
  ].filter(Boolean);
  const tags = Array.isArray(card.interestTags) ? card.interestTags : [];
  return [
    h('div', { class: 'morning-plaza-card__tags' }, ...profile.map(tagNode)),
    h('div', { class: 'morning-plaza-card__profile row-2 row-wrap' },
      ...(tags.length
        ? tags.map(tag => badge(tag, { tone: 'neutral' }))
        : [h('span', { class: 't-caption t-muted', text: '暂未填写兴趣标签' })])),
  ];
}

export function buildMorningCardDetail(card, { onInvite, favorite = false, onFavoriteChange } = {}) {
  let isFavorite = favorite;
  let favoriteBusy = false;
  let favoriteButton;
  const syncFavoriteButton = () => {
    const label = favoriteButton?.querySelector('span');
    if (label) label.textContent = isFavorite ? '已收藏' : '加入收藏夹';
    if (favoriteButton) favoriteButton.disabled = favoriteBusy;
  };
  favoriteButton = button({
    label: isFavorite ? '已收藏' : '加入收藏夹',
    variant: isFavorite ? 'secondary' : 'primary',
    iconName: 'heart',
    onClick: async () => {
      if (favoriteBusy || !onFavoriteChange) return;
      favoriteBusy = true;
      syncFavoriteButton();
      try {
        isFavorite = await onFavoriteChange(!isFavorite);
        favoriteButton.classList.toggle('btn--primary', !isFavorite);
        favoriteButton.classList.toggle('btn--secondary', isFavorite);
      } catch (error) {
        reportError(error, '收藏操作未完成');
      } finally {
        favoriteBusy = false;
        syncFavoriteButton();
      }
    },
  });
  return h(
    'article',
    { class: 'morning-card-detail morning-letter' },
    h(
      'div',
      { class: 'morning-letter__top' },
      h('p', { class: 'morning-letter__masthead', text: '早安晚安 · 同行信笺' }),
      h('img', { class: 'morning-letter__postmark', src: '/assets/nju-red-cross-stamp.webp', alt: '南京大学红十字会 · 已审核', width: 64, height: 64, decoding: 'async' }),
    ),
    h(
      'header',
      { class: 'morning-card-detail__head' },
      h('span', { class: 'morning-card-detail__avatar', 'aria-hidden': 'true', text: initials(card.nickname) }),
      h(
        'div',
        { class: 'morning-card-detail__title' },
        h('h2', { class: 't-h1', text: card.nickname || '未命名同行' }),
      ),
      card.campus ? badge(card.campus, { tone: 'accent' }) : null,
    ),
    ...morningCardMetadata(card),
    h(
      'section',
      { class: 'morning-card-detail__note morning-letter__body' },
      h('p', { class: 't-label', text: '写给愿意认识你的人' }),
      h('p', { text: card.note || '这位同学还没有留下留言。' }),
    ),
    h('p', { class: 't-caption t-muted', text: card.publishedAt ? `发布于 ${fullDateTime(card.publishedAt)}` : '已通过管理员审核' }),
    h('div', { class: 'morning-card-detail__actions' },
      favoriteButton,
      onInvite
        ? button({
            label: '发起好友邀约',
            variant: 'primary',
            iconName: 'send',
            onClick: () => onInvite(card),
          })
        : null),
  );
}

export default async function morningCardDetailPage(context = {}) {
  const cardId = context.params?.cardId || '';
  const node = h('div', { class: 'view morning-view morning-card-detail-view' });
  node.append(pageHead({
    label: '早安晚安',
    title: '名片详情',
    description: '这里展示对方公开的同行名片信息和完整留言。',
    actions: [button({ label: '返回广场', variant: 'secondary', iconName: 'chevronLeft', href: '/morning/plaza' })],
    meta: [badge('注册用户可浏览', { tone: 'neutral' }), badge('邀约需名片已发布', { tone: 'info' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '查看名片详情', hint: '登录平台账号后即可查看已审核的广场名片。' }));
    return { title: '早安晚安名片详情', node };
  }

  const content = h('div', { class: 'morning-content stack-6' });
  node.append(content);
  if (!cardId) {
    content.append(emptyState({ iconName: 'inbox', title: '名片不存在', description: '请返回广场重新选择一张名片。' }));
    return { title: '早安晚安名片详情', node };
  }

  let payload;
  try {
    payload = await morningApi.plazaCard(cardId);
  } catch (error) {
    content.append(
      notice(error.message || '暂时无法读取这张名片。', { tone: 'error', title: error.code === 'card_not_found' ? '名片不可用' : '加载失败' }),
      h('div', { class: 'row-3 row-wrap' }, button({ label: '返回广场', variant: 'secondary', iconName: 'chevronLeft', href: '/morning/plaza' })),
    );
    return { title: '早安晚安名片详情', node };
  }

  content.append(
    notice('详情页仍不会展示真实姓名、学号、邮箱或联系方式。', { tone: 'info' }),
    buildMorningCardDetail(payload.card, {
      favorite: payload.favorite,
      onFavoriteChange: async shouldFavorite => {
        if (shouldFavorite) await morningApi.addFavorite(cardId);
        else await morningApi.removeFavorite(cardId);
        return shouldFavorite;
      },
      onInvite: card => openMorningInviteDrawer(card, { viewer: payload.viewer }),
    }),
  );
  return { title: `${payload.card.nickname || '同行'} · 早安晚安名片`, node };
}
