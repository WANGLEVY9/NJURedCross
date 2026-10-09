/* ==========================================================================
   portal/pages/morning-received-comments.js
   Owner-only page for previewing all comments received on a published card.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { badge, button, emptyState, notice, pageHead, skeletonRows } from '../../ui/primitives.js';
import { loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { morningReceivedCommentRow } from '../morning-comments.js';

export default async function morningReceivedCommentsPage() {
  const node = h('div', { class: 'view morning-view' });
  let refresh = () => {};
  const refreshButton = button({
    label: '刷新状态',
    variant: 'secondary',
    iconName: 'refresh',
    onClick: () => refresh(),
  });
  node.append(pageHead({
    label: '早安晚安',
    title: '我收到的评论',
    description: '查看自己名片收到的全部评论；点击任意一条查看完整内容。',
    actions: [refreshButton, button({ label: '返回内建中心', variant: 'secondary', iconName: 'chevronLeft', href: '/community' })],
    meta: [badge('仅本人可见', { tone: 'accent' }), badge('查看优先', { tone: 'neutral' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({ what: '查看我收到的评论', hint: '登录后可以查看自己名片收到的评论。' }));
    return { title: '我收到的评论', node };
  }

  const body = h('div', { class: 'stack-5' }, skeletonRows(5));
  const syncStatus = h('p', {
    class: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  node.append(h('div', { class: 'morning-content stack-6' }, body, syncStatus));

  let card;
  try {
    const payload = await morningApi.card();
    card = payload.card;
  } catch (error) {
    if (redirectIfAuthError(error)) return { title: '我收到的评论', node };
    body.replaceChildren(notice(error.message || '暂时无法读取名片信息。', { tone: 'error', title: '加载失败' }));
    return { title: '我收到的评论', node };
  }

  if (!card || card.status !== '已发布') {
    body.replaceChildren(emptyState({
      iconName: 'inbox',
      title: card ? '名片发布后才能查看评论' : '还没有报名早安晚安',
      description: card
        ? '管理员审核通过后，其他已报名同学的评论会显示在这里。'
        : '完成报名并审核通过后，其他同学就可以在你的名片下留言。',
      actions: [button({ label: card ? '查看报名状态' : '去报名', variant: 'primary', iconName: 'arrowRight', href: '/morning/register' })],
    }));
    return { title: '我收到的评论', node };
  }

  let loadSequence = 0;
  async function load({ silent = false } = {}) {
    const sequence = ++loadSequence;
    if (!silent) body.replaceChildren(skeletonRows(5));
    try {
      const payload = await morningApi.comments(card.id);
      if (sequence !== loadSequence) return;
      const comments = payload.comments || [];
      body.replaceChildren(
        notice('这里展示你名片收到的全部评论；点击单条记录查看详情，遇到不当内容时再举报。', { tone: 'info' }),
        h(
          'section',
          { class: 'panel member-anchor', id: 'morning-received-comments' },
          h(
            'header',
            { class: 'panel__head' },
            h(
              'div',
              { class: 'section-head__text' },
              h('h2', { class: 't-h2', text: '评论预览' }),
              h('p', { class: 't-caption', text: '按收到时间排列，点击任意一条查看完整内容。' }),
            ),
            h('span', { class: 'spacer' }),
            badge(`${comments.length} 条`, { tone: comments.length ? 'accent' : 'neutral' }),
          ),
          h(
            'div',
            { class: 'panel__body' },
            comments.length
              ? h(
                  'div',
                  { class: 'queue' },
                  ...comments.map((comment) => morningReceivedCommentRow(comment, card.id, { onChanged: load })),
                )
              : emptyState({
                  iconName: 'inbox',
                  title: '还没有收到评论',
                  description: '其他已报名同学可以在你的名片详情里留言，收到的评论会显示在这里。',
                }),
          ),
        ),
      );
      syncStatus.textContent = `评论状态已同步，共 ${comments.length} 条。`;
    } catch (error) {
      if (sequence !== loadSequence) return;
      body.replaceChildren(notice(error.message || '评论暂时无法读取。', { tone: 'error', title: '加载失败' }));
    }
  }

  await load();
  refresh = () => load({ silent: true });
  const sync = () => {
    if (document.visibilityState === 'visible') void load({ silent: true });
  };
  const timer = window.setInterval(sync, 30_000);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  return {
    title: '我收到的评论',
    node,
    dispose: () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    },
  };
}
