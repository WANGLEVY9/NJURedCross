/* ==========================================================================
   portal/pages/me.js
   The student personal centre. Everything shown here is scoped by the server to
   the signed-in account — the page never sends an identifier of its own, so it
   cannot be talked into showing somebody else's records.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { portal, getSessionState, logout, ApiError } from '../../core/api.js';
import { navigate, redirect } from '../../core/router.js';
import { button, badge, statusIndicator, emptyState, errorState, definitionList, notice, queueRow, skeletonBlock } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const PROGRAM_LABELS = { birthday: '生日祝福', morning: '早安晚安同行' };

/** Registration, submission and enrollment statuses share one palette. */
function toneFor(status) {
  if (['已确认', '已通过', '已签到'].includes(status)) return 'success';
  if (['已取消', '需修改', '已退出'].includes(status)) return 'error';
  return 'warning';
}

/** Queue rails reuse the same three tones, since the semantics are identical. */
function priorityFor(status) {
  const tone = toneFor(status);
  if (tone === 'success') return 'low';
  if (tone === 'error') return 'high';
  return 'medium';
}

function recordRow({ type, title, status, detail, href }) {
  return queueRow({
    type,
    title,
    detail: detail || '',
    priority: priorityFor(status),
    meta: [statusIndicator(status || '未知', { tone: toneFor(status) })],
    action: href ? button({ label: '查看', variant: 'ghost', size: 'sm', href }) : null,
  });
}

function recordPanel(title, description, rows, { emptyTitle, emptyDescription, emptyAction } = {}) {
  return h(
    'section',
    { class: 'panel' },
    h(
      'header',
      { class: 'panel__head' },
      h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: title }), h('p', { class: 't-caption', text: description })),
      h('span', { class: 'spacer' }),
      badge(`${rows.length} 条`, { tone: rows.length ? 'accent' : 'neutral' }),
    ),
    h(
      'div',
      { class: 'panel__body' },
      rows.length
        ? h('div', { class: 'queue' }, ...rows)
        : emptyState({ iconName: 'inbox', title: emptyTitle, description: emptyDescription, actions: emptyAction ? [emptyAction] : [] }),
    ),
  );
}

export default async function mePage() {
  const slot = h('div', { class: 'stack-5' });

  async function signOut() {
    try {
      await logout();
      notify.success('已退出登录', '浏览公开内容不受影响。');
      navigate('/', { replace: true });
    } catch (error) {
      reportError(error, '退出失败');
    }
  }

  function render(payload) {
    const { account, registrations, submissions, enrollments } = payload;

    clear(slot);
    slot.append(
      h(
        'section',
        { class: 'panel' },
        h(
          'header',
          { class: 'panel__head' },
          h(
            'div',
            { class: 'section-head__text' },
            h('p', { class: 't-label', text: '当前账号' }),
            h('h2', { class: 't-h2', text: account.label || account.username }),
          ),
          h('span', { class: 'spacer' }),
          badge(account.roleLabel || account.role, { tone: 'accent', iconName: 'user' }),
        ),
        h(
          'div',
          { class: 'panel__body stack-4' },
          definitionList([
            ['账号', h('code', { class: 't-data', text: account.username })],
            ['角色', account.roleLabel || account.role],
            ['可访问界面', (account.surfaces || []).includes('console') ? '活动平台 + 管理平台' : '活动平台'],
          ]),
          h('hr', { class: 'divider' }),
          h(
            'div',
            { class: 'row-3 row-wrap' },
            h('span', { class: 't-caption t-muted', text: '退出后仍可继续浏览公开的活动、物资说明与温暖连接介绍。' }),
            h('span', { class: 'spacer' }),
            button({ label: '退出登录', variant: 'ghost', size: 'sm', iconName: 'logout', onClick: () => signOut() }),
          ),
        ),
      ),
      recordPanel(
        '我的活动报名',
        '报名、候补与现场签到的当前状态。',
        registrations.map((item) =>
          recordRow({
            type: '活动报名',
            title: item.eventName,
            status: item.cancelledAt ? '已取消' : item.checkedInAt ? '已签到' : item.status,
            detail: [item.code, fmt.fullDateTime(item.startAt), item.location].filter(Boolean).join(' · '),
            href: '/events',
          }),
        ),
        { emptyTitle: '还没有报名记录', emptyDescription: '浏览正在开放的活动，选择场次后即可报名。', emptyAction: button({ label: '浏览活动', variant: 'primary', size: 'sm', iconName: 'calendar', href: '/events' }) },
      ),
      recordPanel(
        '我的内容投稿',
        '投稿进入人工审核队列后的结论。',
        submissions.map((item) =>
          recordRow({
            type: item.category || '内容投稿',
            title: item.title,
            status: item.status,
            detail: [item.id, fmt.fullDateTime(item.submittedAt), item.reviewNote ? `审核意见：${item.reviewNote}` : ''].filter(Boolean).join(' · '),
          }),
        ),
        { emptyTitle: '还没有投稿记录', emptyDescription: '稿件、摄影与设计作品都可以投递，全部经人工审核。', emptyAction: button({ label: '去投稿', variant: 'primary', size: 'sm', iconName: 'megaphone', href: '/submit' }) },
      ),
      recordPanel(
        '我的温暖连接登记',
        '参加意愿、接收频率与处理进度。',
        enrollments.map((item) =>
          recordRow({
            type: PROGRAM_LABELS[item.program] || item.program,
            title: item.frequency === 'weekly' ? '每周接收' : '仅接收一次',
            status: item.status,
            detail: [item.id, fmt.fullDateTime(item.submittedAt)].filter(Boolean).join(' · '),
          }),
        ),
        { emptyTitle: '还没有登记温暖连接', emptyDescription: '生日祝福与早安晚安同行计划完全自愿，随时可以退出。', emptyAction: button({ label: '了解计划', variant: 'primary', size: 'sm', iconName: 'heart', href: '/warmth' }) },
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel__body' }, notice('物资借用申请暂时没有和账号绑定：申请表要求填写姓名、学号与邮箱，审批结果按你提交时留下的邮箱通知。要查询某次申请，请使用提交时收到的申请编号。', { tone: 'info', title: '关于物资借用记录' })),
      ),
    );
  }

  async function load() {
    clear(slot);
    slot.append(skeletonBlock('240px'));
    try {
      render(await portal.me());
    } catch (error) {
      if (error instanceof ApiError && error.isAuth) {
        redirect(`/login?next=${encodeURIComponent('/me')}`);
        return;
      }
      clear(slot);
      slot.append(errorState({ title: '个人记录无法加载', error, onRetry: () => load(), onBack: () => navigate('/') }));
    }
  }

  const session = getSessionState();
  const node = h(
    'div',
    { class: 'view' },
    h(
      'section',
      { class: 'psection psection--tight' },
      h(
        'div',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回首页' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '个人中心' }), badge(session.user?.username || '已登录', { tone: 'accent', iconName: 'user' })),
        h('h1', { class: 't-h1', text: '我的参与记录' }),
        h('p', { class: 't-prose', text: '这里只显示属于当前账号的记录。查询不依赖姓名或学号，因此不会看到他人的参与信息。' }),
      ),
    ),
    slot,
  );

  load();
  return { title: '个人中心', node };
}
