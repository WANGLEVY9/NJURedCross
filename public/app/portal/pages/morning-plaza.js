/* ==========================================================================
   portal/pages/morning-plaza.js
   Read-only plaza for approved “早安晚安” member cards.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { initials, relative } from '../../core/format.js';
import { badge, button, emptyState, notice, pageHead } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { loginRequiredPanel } from '../auth-gate.js';
import { buildMorningCardDetail } from './morning-card-detail.js';

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
      badge('已通过审核', { tone: 'success' }),
      h('span', { class: 't-caption t-muted', text: card.hasMoreNote ? '点击查看完整备注' : publishedLabel }),
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
      );
    })
    .catch((error) => {
      body.replaceChildren(notice(error.message || '暂时无法读取这张名片。', { tone: 'error', title: '加载失败' }));
    });
  return drawer;
}

export default async function morningPlazaPage() {
  const node = h('div', { class: 'view morning-view morning-plaza-view' });
  node.append(pageHead({
    label: '早安晚安',
    title: '同行广场',
    description: '浏览通过审核的同行名片，先从共同的兴趣开始认识彼此。',
    actions: [button({ label: '返回内建中心', variant: 'secondary', iconName: 'chevronLeft', href: '/community' })],
    meta: [badge('仅报名成员可见', { tone: 'neutral' }), badge('只展示已通过', { tone: 'success' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '浏览早安晚安广场', hint: '登录并完成报名后才能查看广场。' }));
    return { title: '早安晚安广场', node };
  }

  const content = h('div', { class: 'morning-content stack-6' });
  node.append(content);
  let payload;
  try {
    payload = await morningApi.plaza();
  } catch (error) {
    if (error.code === 'morning_card_required') {
      content.append(emptyState({
        iconName: 'handshake',
        title: '报名后进入广场',
        description: '完成早安晚安报名后，就能浏览已经通过审核的同行名片。',
        actions: [button({ label: '回到内建中心报名', variant: 'primary', iconName: 'arrowRight', href: '/community' })],
      }));
      return { title: '早安晚安广场', node };
    }
    content.append(notice(error.message || '暂时无法打开广场。', { tone: 'error', title: '加载失败' }));
    return { title: '早安晚安广场', node };
  }

  const cards = payload.cards || [];
  if (!cards.length) {
    content.append(
      notice('广场只展示管理员审核通过的他人名片；不会显示真实姓名、学号、邮箱或联系方式。', { tone: 'info' }),
      emptyState({
        iconName: 'handshake',
        title: '暂时还没有可浏览的名片',
        description: '等更多同学通过审核后，这里会出现他们的同行名片。',
      }),
    );
    return { title: '早安晚安广场', node };
  }

  content.append(
    notice('这里只展示他人已通过审核的名片，不展示真实姓名、学号、邮箱或联系方式。', { tone: 'info' }),
    h('section', { class: 'morning-plaza-grid', attrs: { 'aria-label': '早安晚安同行名片列表' } }, ...cards.map(cardNode)),
  );
  return { title: '早安晚安广场', node };
}
