/* ==========================================================================
   portal/pages/verify-email.js
   The second step of self-registration: enter the 6-digit code sent to the
   campus mailbox. A successful verification issues the member code (the
   account's stable identity for registrations and records) and signs the
   account in immediately.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { verifyEmail, resendEmailCode, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, field, notice, badge } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';

export default async function verifyEmailPage(context) {
  const email = (context.query.get('email') || '').trim();
  const devCode = (context.query.get('code') || '').trim();
  const next = context.query.get('next') || '';

  const emailField = field({ label: '校园邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', autocomplete: 'email', placeholder: 'you@smail.nju.edu.cn' });
  emailField.control.value = email;
  const codeField = field({ label: '6 位验证码', name: 'code', required: true, iconName: 'lock', placeholder: '邮件中的 6 位数字', maxlength: '6', inputmode: 'numeric' });
  if (devCode) codeField.control.value = devCode;
  const errorSlot = h('div', { hidden: true });

  const submitButton = button({ label: '验证并登录', variant: 'primary', size: 'lg', block: true, iconName: 'arrowRight', iconMotion: 'nudge', onClick: () => submit() });
  const resendButton = button({ label: '重新发送验证码', variant: 'ghost', size: 'sm', iconName: 'mail', onClick: () => resend() });

  let resendTimer = null;

  async function submit() {
    emailField.setError(null);
    codeField.setError(null);
    errorSlot.hidden = true;

    const submitEmail = emailField.control.value.trim();
    const code = codeField.control.value.trim();
    if (!submitEmail) {
      emailField.setError('请填写校园邮箱');
      shake(emailField);
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      codeField.setError('请输入 6 位数字验证码');
      shake(codeField);
      return;
    }

    try {
      submitButton.loading = true;
      const payload = await verifyEmail(submitEmail, code);
      notify.success('验证成功', `已登录，你的会员身份码是 ${payload?.memberCode || '见个人中心'}。`);
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/me';
      navigate(target, { replace: true });
    } catch (error) {
      errorSlot.hidden = false;
      errorSlot.replaceChildren(
        notice(error.message || '验证失败，请稍后重试。', {
          tone: error instanceof ApiError && error.isRateLimited ? 'warning' : 'error',
          title: '无法完成验证',
        }),
      );
      shake(errorSlot);
      codeField.control.value = '';
      codeField.control.focus();
    } finally {
      submitButton.loading = false;
    }
  }

  /** 60 秒倒计时，避免连续点击触发 429。 */
  function startCooldown(seconds = 60) {
    let remaining = seconds;
    resendButton.disabled = true;
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendTimer);
        resendButton.disabled = false;
        resendButton.textContent = '重新发送验证码';
      } else {
        resendButton.textContent = `${remaining} 秒后可重发`;
      }
    }, 1000);
  }

  async function resend() {
    const submitEmail = emailField.control.value.trim();
    if (!submitEmail) {
      emailField.setError('请先填写校园邮箱');
      shake(emailField);
      return;
    }
    try {
      resendButton.disabled = true;
      const payload = await resendEmailCode(submitEmail, 'register');
      notify.success('验证码已重新发送', '10 分钟内有效，请查收邮箱。');
      if (payload?.devCode) codeField.control.value = payload.devCode;
      startCooldown();
    } catch (error) {
      resendButton.disabled = false;
      notify.warning('发送失败', error.message || '请稍后重试。');
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
      codeField,
      errorSlot,
      submitButton,
      resendButton,
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
        h('a', { class: 't-caption t-muted row-2', href: '/register' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回注册' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '邮箱验证' }), badge('验证码 10 分钟内有效', { tone: 'warning', iconName: 'clock' })),
        h('h1', { class: 't-h1', text: '输入验证码，完成注册' }),
        h('p', { class: 't-prose', text: '验证码已发送到你填写的校园邮箱。验证通过后会为你签发唯一的会员身份码，并直接登录活动平台。' }),
      ),
      form,
    ),
  );

  requestAnimationFrame(() => (devCode ? submitButton.focus?.() : codeField.control.focus()));
  return { title: '邮箱验证', node, dispose: () => clearInterval(resendTimer) };
}
