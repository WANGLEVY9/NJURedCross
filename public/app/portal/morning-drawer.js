import { h } from '../core/dom.js';
import { morningApi, getSessionState, ApiError } from '../core/api.js';
import { openDrawer } from '../ui/overlay.js';
import { button, notice, receipt } from '../ui/primitives.js';
import { loginHref } from './auth-gate.js';
import {
  buildMorningSignupForm,
  morningCardSummary,
  morningStatusBadge,
} from './morning-form.js';

function closeFooter(drawer) {
  return [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })];
}

export async function openMorningSignupDrawer({ onDone } = {}) {
  const body = h('div', { class: 'stack-4' }, notice('正在读取报名信息…', { tone: 'neutral' }));
  let drawer;
  drawer = openDrawer({
    placement: 'center',
    eyebrow: '内建广场 · 早安晚安',
    title: '报名同行名片',
    description: '自愿报名 · 人工审核 · 独立模块',
    width: 760,
    body,
    footer: closeFooter(drawer),
  });

  if (!getSessionState().authenticated) {
    body.replaceChildren(
      notice('报名需要先登录活动平台。', { tone: 'warning', title: '需要账号身份' }),
      h('div', { class: 'row-3 row-wrap' },
        button({ label: '登录活动平台', variant: 'primary', iconName: 'lock', href: loginHref() }),
        button({ label: '先去注册', variant: 'secondary', href: '/register' }),
      ),
    );
    return drawer;
  }

  let payload;
  try {
    payload = await morningApi.card();
  } catch (error) {
    body.replaceChildren(notice(error.message || '暂时无法读取报名信息。', { tone: 'error', title: '加载失败' }));
    return drawer;
  }

  const { profile, card } = payload;
  if (profile.missing.length) {
    body.replaceChildren(
      notice(`报名需要强绑定账号中的${profile.missing.join('、')}。请先在会员中心补全资料。`, {
        tone: 'warning',
        title: '账号资料未完整',
      }),
      h('div', { class: 'row-3 row-wrap' }, button({ label: '去会员中心', variant: 'primary', iconName: 'user', href: '/me' })),
    );
    return drawer;
  }

  if (card && !['需修改', '已拒绝'].includes(card.status)) {
    body.replaceChildren(
      h('div', { class: 'row-3 row-wrap' }, morningStatusBadge(card.status), notice(`当前状态：${card.status}`, { tone: card.status === '已发布' ? 'success' : 'info' })),
      ...morningCardSummary(card),
    );
    return drawer;
  }

  const form = buildMorningSignupForm({
    profile,
    card: card?.status === '需修改' || card?.status === '已拒绝' ? card : null,
    onSubmitted: (submitted) => {
      body.replaceChildren(
        receipt({ title: '报名已提交', rows: [['名片编号', submitted.id], ['昵称', submitted.nickname], ['状态', submitted.status]] }),
        notice('管理员审核通过后，这张名片才会进入广场。', { tone: 'info' }),
      );
      drawer.setFooter([
        h('span', { class: 'spacer' }),
        button({ label: '完成', variant: 'primary', onClick: () => { drawer.close(); onDone?.(); } }),
      ]);
    },
  });
  body.replaceChildren(...[
    card ? notice('这张名片之前被退回或拒绝。修改后会重新进入待审核。', { tone: 'warning', title: '重新提交' }) : null,
    form,
  ].filter(Boolean));
  return drawer;
}
