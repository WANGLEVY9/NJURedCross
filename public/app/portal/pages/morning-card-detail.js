/* ==========================================================================
   portal/pages/morning-card-detail.js
   Full public detail for one approved “早安晚安” plaza card.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { fullDateTime, initials } from '../../core/format.js';
import { badge, button, emptyState, notice, pageHead } from '../../ui/primitives.js';
import { loginRequiredPanel } from '../auth-gate.js';
import { buildMorningCommentsPanel } from '../morning-comments.js';

function tagNode(tag) {
  return h('span', { class: 'morning-plaza-card__tag', text: tag });
}

export function buildMorningCardDetail(card) {
  return h(
    'article',
    { class: 'morning-card-detail morning-letter' },
    h(
      'div',
      { class: 'morning-letter__top' },
      h('p', { class: 'morning-letter__masthead', text: '早安晚安 · 同行信笺' }),
      h('span', { class: 'morning-letter__postmark', text: '已审' }),
    ),
    h(
      'header',
      { class: 'morning-card-detail__head' },
      h('span', { class: 'morning-card-detail__avatar', 'aria-hidden': 'true', text: initials(card.nickname) }),
      h(
        'div',
        { class: 'morning-card-detail__title' },
        h('h1', { class: 't-h1', text: card.nickname || '未命名同行' }),
        h('p', { class: 't-caption t-muted', text: card.campus ? `${card.campus}校区` : '校区未填写' }),
      ),
      card.campus ? badge(card.campus, { tone: 'accent' }) : null,
    ),
    card.interestTags.length
      ? h('div', { class: 'morning-plaza-card__tags' }, ...card.interestTags.map(tagNode))
      : h('p', { class: 't-caption t-muted', text: '暂未填写兴趣标签' }),
    h(
      'section',
      { class: 'morning-card-detail__note morning-letter__body' },
      h('p', { class: 't-label', text: '写给愿意认识你的人' }),
      h('p', { text: card.note || '这位同学还没有留下备注。' }),
    ),
    h('p', { class: 't-caption t-muted', text: card.publishedAt ? `发布于 ${fullDateTime(card.publishedAt)}` : '已通过管理员审核' }),
  );
}

export default async function morningCardDetailPage(context = {}) {
  const cardId = context.params?.cardId || '';
  const node = h('div', { class: 'view morning-view morning-card-detail-view' });
  node.append(pageHead({
    label: '早安晚安',
    title: '名片详情',
    description: '这里展示对方公开的同行名片信息和完整备注。',
    actions: [button({ label: '返回广场', variant: 'secondary', iconName: 'chevronLeft', href: '/morning/plaza' })],
    meta: [badge('仅报名成员可见', { tone: 'neutral' }), badge('已通过审核', { tone: 'success' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '查看名片详情', hint: '登录并完成报名后才能查看广场名片。' }));
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
    if (error.code === 'morning_card_required') {
      content.append(emptyState({
        iconName: 'handshake',
        title: '报名后查看名片详情',
        description: '完成早安晚安报名后，就能浏览已经通过审核的同行名片。',
        actions: [button({ label: '回到内建中心报名', variant: 'primary', iconName: 'arrowRight', href: '/community' })],
      }));
      return { title: '早安晚安名片详情', node };
    }
    content.append(
      notice(error.message || '暂时无法读取这张名片。', { tone: 'error', title: error.code === 'card_not_found' ? '名片不可用' : '加载失败' }),
      h('div', { class: 'row-3 row-wrap' }, button({ label: '返回广场', variant: 'secondary', iconName: 'chevronLeft', href: '/morning/plaza' })),
    );
    return { title: '早安晚安名片详情', node };
  }

  content.append(
    notice('详情页仍不会展示真实姓名、学号、邮箱或联系方式。', { tone: 'info' }),
    buildMorningCardDetail(payload.card),
    buildMorningCommentsPanel(payload.card.id),
  );
  return { title: `${payload.card.nickname || '同行'} · 早安晚安名片`, node };
}
