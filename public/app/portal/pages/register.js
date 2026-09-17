/* ==========================================================================
   portal/pages/register.js
   Self-service registration. The campus e-mail is the identity anchor: only
   @smail.nju.edu.cn / @nju.edu.cn addresses may register, and the account
   only becomes usable after the e-mail is verified (a code is sent on
   submit; verification hands out the member code and signs the account in).
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { registerAccount, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, field, notice, badge } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';

const SMAIL_HINT = '注册邮箱须为 @smail.nju.edu.cn 或 @nju.edu.cn，验证码会发送到该邮箱。';

export default async function registerPage() {
  const emailField = field({ label: '校园邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', autocomplete: 'email', placeholder: 'you@smail.nju.edu.cn' });
  const displayNameField = field({ label: '显示名（可选）', name: 'displayName', iconName: 'user', autocomplete: 'nickname', placeholder: '活动与记录中展示的名字' });
  const passwordField = field({ label: '设置密码', name: 'password', type: 'password', required: true, iconName: 'lock', autocomplete: 'new-password', placeholder: '至少 6 位' });
  const errorSlot = h('div', { hidden: true });

  const submitButton = button({ label: '注册并获取验证码', variant: 'primary', size: 'lg', block: true, iconName: 'arrowRight', iconMotion: 'nudge', onClick: () => submit() });

  async function submit() {
    emailField.setError(null);
    passwordField.setError(null);
    displayNameField.setError(null);
    errorSlot.hidden = true;

    const email = emailField.control.value.trim();
    const password = passwordField.control.value;
    const displayName = displayNameField.control.value.trim();
    if (!email) {
      emailField.setError('请填写校园邮箱');
      shake(emailField);
      return;
    }
    if (!password) {
      passwordField.setError('请设置密码');
      shake(passwordField);
      return;
    }

    try {
      const payload = await (async () => {
        submitButton.loading = true;
        try {
          return await registerAccount({ email, password, displayName });
        } finally {
          submitButton.loading = false;
        }
      })();
      notify.success('注册成功', `验证码已发送到 ${email}，10 分钟内有效。`);
      // The devCode only exists while SMTP is unconfigured (console transport);
      // it pre-fills the next step so local flows work without a mailbox.
      const codeQuery = payload?.devCode ? `&code=${encodeURIComponent(payload.devCode)}` : '';
      navigate(`/verify-email?email=${encodeURIComponent(email)}${codeQuery}`, { replace: true });
    } catch (error) {
      errorSlot.hidden = false;
      errorSlot.replaceChildren(
        notice(error.message || '注册失败，请稍后重试。', {
          tone: error instanceof ApiError && error.isRateLimited ? 'warning' : 'error',
          title: '无法完成注册',
        }),
      );
      shake(errorSlot);
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
      emailField,
      displayNameField,
      passwordField,
      errorSlot,
      submitButton,
      h('div', { class: 'row-3 row-wrap' }, badge('强绑定校园邮箱', { tone: 'accent', iconName: 'mail' }), h('span', { class: 't-caption', text: SMAIL_HINT })),
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
        h('a', { class: 't-caption t-muted row-2', href: '/login' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回登录' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '注册活动平台账号' }), badge('报名 · 投稿 · 温暖连接', { tone: 'warning', iconName: 'user' })),
        h('h1', { class: 't-h1', text: '用校园邮箱创建你的账号' }),
        h('p', { class: 't-prose', text: '注册后即可在线报名活动、申请物资借用、投递内容与参加温暖连接计划。每位同学拥有唯一的会员身份码，所有记录都归属到你的账号下。' }),
      ),
      form,
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel__body stack-4' },
          h('p', { class: 't-label', text: '注册流程' }),
          h('ol', { class: 'stack-2 t-prose' },
            h('li', { text: '填写校园邮箱并设置密码；' }),
            h('li', { text: '查收验证码邮件（10 分钟内有效）；' }),
            h('li', { text: '输入验证码完成验证，随即获得会员身份码并自动登录。' }),
          ),
          h('hr', { class: 'divider' }),
          h(
            'div',
            { class: 'row-3 row-wrap' },
            h('span', { class: 't-caption t-muted', text: '已有账号？' }),
            h('span', { class: 'spacer' }),
            button({ label: '直接登录', variant: 'ghost', size: 'sm', iconName: 'arrowRight', href: '/login' }),
          ),
        ),
      ),
    ),
  );

  requestAnimationFrame(() => emailField.control.focus());
  return { title: '注册账号', node };
}
