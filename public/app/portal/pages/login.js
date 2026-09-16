/* ==========================================================================
   portal/pages/login.js
   The student gate. Signing in is what turns the portal from a brochure into
   "my records": it is required before registering, borrowing, submitting or
   joining the warmth programme, and it is what makes those records findable
   again from the personal centre.

   One account system serves both surfaces — the role on the account decides
   which one opens after sign-in.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { login, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, field, notice, badge, definitionList, runWithLoading } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';

const PROTECTED = [
  ['活动报名与候补', '报名需要账号身份，报名记录会归属到你的账号下，随时可查。'],
  ['物资借用申请', '借用与归还责任需要绑定到明确的申请人，避免匿名申请无法追溯。'],
  ['内容投稿', '投稿的审核结论会回到你的账号，无需再靠邮箱翻找结果。'],
  ['温暖连接登记', '参加意愿与退出操作都记在账号上，随时可以自行管理。'],
];

/**
 * Only ever follow a same-origin relative path, and never bounce a member into
 * the console by way of a crafted `next`.
 */
function safeNext(next, consoleAccess) {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  if (!consoleAccess && next.startsWith('/console')) return null;
  return next;
}

export default async function loginPage(context) {
  const next = context.query.get('next') || '';

  const usernameField = field({ label: '账号', name: 'username', required: true, iconName: 'user', autocomplete: 'username', placeholder: '请输入活动平台账号' });
  const passwordField = field({ label: '密码', name: 'password', type: 'password', required: true, iconName: 'lock', autocomplete: 'current-password' });
  const errorSlot = h('div', { hidden: true });

  const submitButton = button({ label: '登录活动平台', variant: 'primary', size: 'lg', block: true, iconName: 'arrowRight', iconMotion: 'nudge', onClick: () => submit() });

  async function submit() {
    usernameField.setError(null);
    passwordField.setError(null);
    errorSlot.hidden = true;
    const username = usernameField.control.value.trim();
    const password = passwordField.control.value;

    if (!username) {
      usernameField.setError('请输入账号');
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
      const consoleAccess = payload?.user?.consoleAccess === true;
      notify.success('登录成功', consoleAccess ? '该账号同时具备管理平台权限。' : '已进入活动平台。');
      const target = safeNext(next, consoleAccess) || (consoleAccess ? '/console/overview' : '/me');
      navigate(target, { replace: true });
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
    'section',
    { class: 'panel' },
    h(
      'form',
      {
        class: 'panel__body stack-4',
        on: {
          submit: (event) => {
            event.preventDefault();
            submit();
          },
        },
      },
      usernameField,
      passwordField,
      errorSlot,
      submitButton,
      h(
        'div',
        { class: 'row-3 row-wrap' },
        badge('学生账号', { tone: 'accent', iconName: 'user' }),
        h('span', { class: 't-caption', text: '尚未接入学校统一身份认证，账号由平台管理员发放。' }),
      ),
    ),
  );

  const node = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'formpage' },
      h(
        'header',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回首页' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '活动平台登录' }), badge('报名与投稿需要账号', { tone: 'warning', iconName: 'lock' })),
        h('h1', { class: 't-h1', text: '登录后管理你的参与记录' }),
        h('p', { class: 't-prose', text: '浏览活动、了解物资借用规则与温暖连接计划无需登录。登录用于提交报名、借用、投稿与参加登记，并让你在个人中心里看到这些记录的最新状态。' }),
      ),
      form,
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel__body stack-4' },
          h('p', { class: 't-label', text: '登录后可以做什么' }),
          definitionList(PROTECTED),
          h('hr', { class: 'divider' }),
          h(
            'div',
            { class: 'row-3 row-wrap' },
            h('span', { class: 't-caption t-muted', text: '管理人员请走专用入口。' }),
            h('span', { class: 'spacer' }),
            button({ label: '前往管理平台登录', variant: 'ghost', size: 'sm', iconName: 'lock', href: '/console/login' }),
          ),
        ),
      ),
    ),
  );

  requestAnimationFrame(() => usernameField.control.focus());
  return { title: '活动平台登录', node };
}
