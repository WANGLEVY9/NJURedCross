/* ==========================================================================
   console/pages/login.js — the operations gate.
   Full-bleed surface (no console chrome). States: default / loading / error /
   locked out, plus an honest description of what this account can reach.
   ========================================================================== */

import { themeButton } from '../../ui/theme-picker.js';
import { h, icon } from '../../core/dom.js';
import { login, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, field, notice, runWithLoading } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';

const FACTS = [
  ['calendar', '活动管理', '创建活动、处理报名与现场签到。'],
  ['box', '物资管理', '处理借用申请，登记出库与归还。'],
  ['heart', '志愿服务', '查看参与记录，确认志愿时长。'],
  ['megaphone', '内容发布', '审核投稿并安排宣传计划。'],
];

export default async function loginPage(context) {
  const next = context.query.get('next') || '/console/overview';

  const usernameField = field({ label: '管理员账号', name: 'username', required: true, iconName: 'user', autocomplete: 'username' });
  const passwordField = field({ label: '密码', name: 'password', type: 'password', required: true, iconName: 'lock', autocomplete: 'current-password' });
  const errorSlot = h('div', { hidden: true });

  const submitButton = button({ label: '登录运营端', variant: 'primary', size: 'lg', block: true, iconName: 'arrowRight', iconMotion: 'nudge', onClick: () => submit() });

  async function submit() {
    usernameField.setError(null);
    passwordField.setError(null);
    errorSlot.hidden = true;
    const username = usernameField.control.value.trim();
    const password = passwordField.control.value;

    if (!username) {
      usernameField.setError('请输入管理员账号');
      shake(usernameField);
      usernameField.control.focus();
      return;
    }
    if (!password) {
      passwordField.setError('请输入密码');
      shake(passwordField);
      passwordField.control.focus();
      return;
    }

    try {
      const payload = await runWithLoading(submitButton, () => login(username, password));
      // A member account can sign in here but has no console to reach; send it
      // to its own surface instead of a workspace that would answer with 403s.
      if (payload?.user?.consoleAccess !== true) {
        notify.warning('该账号属于活动平台', '这里只对管理平台账号开放，已为你打开个人中心。');
        navigate('/me', { replace: true });
        return;
      }
      notify.success('登录成功', '已进入运营端工作区。');
      navigate(next.startsWith('/console') ? next : '/console/overview', { replace: true });
    } catch (error) {
      errorSlot.hidden = false;
      const rateLimited = error instanceof ApiError && error.isRateLimited;
      errorSlot.replaceChildren(
        notice(error.message || '登录失败，请稍后重试。', {
          tone: rateLimited ? 'warning' : 'error',
          title: rateLimited ? '登录尝试过多' : '无法登录',
        }),
      );
      shake(errorSlot);
      passwordField.control.value = '';
      passwordField.control.focus();
    }
  }

  const form = h(
    'form',
    {
      class: 'gate__card',
      on: {
        submit: (event) => {
          event.preventDefault();
          submit();
        },
      },
    },
    h(
      'div',
      { class: 'stack-2' },
      h('div', { class: 'row-3' }, h('span', { class: 'brand-mark' }), h('p', { class: 't-label', text: '运营管理端' })),
      h('h1', { class: 't-h1', text: '欢迎回来' }),
      h('p', { class: 't-secondary', text: '登录后处理活动、物资和内容事务。' }),
    ),
    usernameField,
    passwordField,
    errorSlot,
    submitButton,
    h(
      'div',
      { class: 'row-3 row-wrap' },
    ),
    h('span', { class: 't-caption t-muted' }, h('span', { text: '活动平台成员账号请走' }), h('a', { class: 't-caption', href: '/login', text: '活动平台登录' }), h('span', { text: '。' })),
    h('hr', { class: 'divider' }),
    h(
      'div',
      { class: 'row-3' },
      h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回公众端首页' })),
      h('span', { class: 'spacer' }),
      h('a', { class: 't-caption t-muted', href: '/about', text: '平台与隐私说明' }),
    ),
  );

  const illustration = h('div', { class: 'gate-art', attrs: { 'aria-hidden': 'true' } },
    h('div', { class: 'gate-art__grid' }),
    h('div', { class: 'gate-art__ring gate-art__ring--one' }),
    h('div', { class: 'gate-art__ring gate-art__ring--two' }),
    h('div', { class: 'gate-art__core' }, h('span', { class: 'brand-mark' }), h('span', { text: 'NJU RED CROSS' })),
    ...FACTS.map(([name, title], index) => h('div', { class: `gate-art__node gate-art__node--${index}`, vars: { '--intro-delay': `${index * 90}ms` } },
      icon(name, 'ico ico--lg'), h('span', { text: title }), h('i', { class: 'gate-art__line' }))),
    h('div', { class: 'gate-art__caption' }, h('span', { text: '让每一份热心，都有去处。' })),
  );
  const node = h('div', { class: 'gate gate--studio' },
    h('aside', { class: 'gate__aside' },
      h('div', { class: 'gate__brand row-3' }, h('span', { class: 'brand-mark' }), h('b', { text: '南京大学红十字会' }), h('span', { class: 'gate__edition', text: 'OPERATIONS' })),
      h('div', { class: 'gate__intro stack-4' }, h('p', { class: 't-label', text: '一起，让善意有序发生' }),
        h('h2', null, h('span', { text: '让每一次协作' }), h('em', { text: '成就更好的回应' })),
        h('p', { class: 't-prose', text: '从一场活动到一份服务，\n在这里，让热心汇聚，让行动落地。' })),
      illustration,
      h('div', { class: 'gate__facts' }, ...FACTS.map(([name, title, description]) => h('div', { class: 'gate__fact' },
        icon(name, 'ico ico--sm'), h('div', { class: 'stack-1' }, h('b', { text: title }), h('p', { class: 't-caption', text: description }))))),
    ),
    h('section', { class: 'gate__form' },
      h('div', { class: 'gate__toolbar' }, h('a', { class: 't-caption row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回活动平台' })), themeButton('console')),
      h('div', { class: 'gate__form-inner' }, h('div', { class: 'gate__mobile-brand row-3' }, h('span', { class: 'brand-mark' }), h('b', { text: '南京大学红十字会' })), form),
      h('p', { class: 'gate__signature', text: '人道 · 博爱 · 奉献' }),
    ),
  );

  requestAnimationFrame(() => { if (window.innerWidth > 960) usernameField.control.focus(); });
  return { title: '运营端登录', node, chrome: false };
}
