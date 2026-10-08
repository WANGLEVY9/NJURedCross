import { h } from '../core/dom.js';
import { morningApi, getSessionState } from '../core/api.js';
import { confirmAction, openDrawer } from '../ui/overlay.js';
import { button, notice, receipt, runWithLoading } from '../ui/primitives.js';
import { notify, reportError } from '../core/toast.js';
import { loginHref } from './auth-gate.js';
import { buildMorningSignupForm } from './morning-form.js';

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

  const { profile } = payload;
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

  let currentCard = payload.card;

  function setFormFooter() {
    const actions = [];
    if (currentCard && currentCard.status !== '已下架') {
      actions.push(button({ label: '退出计划', variant: 'danger', iconName: 'close', onClick: (event) => withdraw(event.currentTarget) }));
    }
    drawer.setFooter([
      ...actions,
      h('span', { class: 'spacer' }),
      button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }),
    ]);
  }

  function showReceipt(card) {
    currentCard = card;
    body.replaceChildren(
      receipt({ title: '报名已提交', rows: [['名片编号', card.id], ['昵称', card.nickname], ['状态', card.status]] }),
      notice('管理员审核通过后，这张名片才会进入广场。', { tone: 'info' }),
    );
    drawer.setFooter([
      h('span', { class: 'spacer' }),
      button({ label: '完成', variant: 'primary', onClick: () => { drawer.close(); onDone?.(); } }),
    ]);
  }

  function showForm(card) {
    body.replaceChildren(buildMorningSignupForm({ profile, card, onSubmitted: showReceipt }));
    setFormFooter();
  }

  async function withdraw(buttonNode) {
    const confirmed = await confirmAction({
      title: '退出早安晚安计划？',
      description: '退出后名片会从审核和广场流程中移除，历史记录仍会保留。',
      confirmLabel: '确认退出',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const result = await runWithLoading(buttonNode, () => morningApi.withdrawCard());
      currentCard = result.card;
      notify.success('已退出计划', result.message);
      body.replaceChildren(
        receipt({ title: '已退出计划', rows: [['名片编号', result.card.id], ['状态', result.card.status]] }),
        notice('重新报名时会从一份空白名片开始。', { tone: 'neutral' }),
      );
      drawer.setFooter([
        h('span', { class: 'spacer' }),
        button({ label: '完成', variant: 'primary', onClick: () => { drawer.close(); onDone?.(); } }),
      ]);
    } catch (error) {
      reportError(error, '退出失败');
    }
  }

  showForm(currentCard && currentCard.status !== '已下架' ? currentCard : null);
  return drawer;
}
