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
import { safePortalNext } from '../auth-flow.js';

export default async function verifyEmailPage(context) {
  const email = (context.query.get('email') || '').trim();
  const deliveryFailed = context.query.get('delivery') === 'failed';
  const next = context.query.get('next') || '';
  let pending = false;

  const emailField = field({ label: '校园邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', autocomplete: 'email', placeholder: 'you@smail.nju.edu.cn' });
  emailField.control.value = email;
  const codeField = field({ label: '6 位验证码', name: 'code', required: true, iconName: 'lock', placeholder: '邮件中的 6 位数字', maxlength: '6', inputmode: 'numeric' });
  codeField.control.inputMode = 'numeric';
  codeField.control.autocomplete = 'one-time-code';
  const passwordField = field({ label: '注册时设置的密码', name: 'password', type: 'password', required: true, autocomplete: 'current-password', maxlength: 72, hint: '邮箱验证码和本次注册密码共同完成验证。' });
  const errorSlot = h('div', { hidden: true, role: 'alert' });

  const submitButton = button({ label: '验证并登录', variant: 'primary', size: 'lg', block: true, iconName: 'arrowRight', iconMotion: 'nudge', onClick: () => submit() });
  const resendButton = button({ label: '重新发送验证码', variant: 'ghost', size: 'sm', iconName: 'mail', onClick: () => resend() });

  let resendTimer = null;

  async function submit() {
    if (pending) return;
    emailField.setError(null);
    codeField.setError(null);
    passwordField.setError(null);
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
    if (!passwordField.control.value) { passwordField.setError('请输入注册时设置的密码'); passwordField.control.focus(); return; }
    pending = true;

    try {
      submitButton.dataset.loading = 'true'; submitButton.disabled = true;
      const payload = await verifyEmail(submitEmail, code, passwordField.control.value);
      notify.success('验证成功', `已登录，你的会员身份码是 ${payload?.memberCode || '见个人中心'}。`);
      passwordField.control.value = '';
      const target = safePortalNext(next);
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
      delete submitButton.dataset.loading; submitButton.disabled = false;
      pending = false;
    }
  }

  /** 60 秒倒计时，避免连续点击触发 429。 */
  function startCooldown(seconds = 60) {
    let remaining = seconds;
    resendButton.disabled = true;
    resendButton.textContent = `${remaining} 秒后可重发`;
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
      codeField.control.value = '';
      startCooldown();
    } catch (error) {
      resendButton.disabled = false;
      if (error.detail?.retryAfter) startCooldown(error.detail.retryAfter);
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
      passwordField,
      ...(deliveryFailed ? [notice('账号已创建，但首次验证码邮件未送达。请稍后点击“重新发送验证码”；账号完成邮箱验证前不可登录。', { tone: 'warning', title: '需要重新发送验证码' })] : []),
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
        h('p', { class: 't-prose', text: deliveryFailed ? '邮件服务暂时未能送达验证码。你可以稍后重发；验证成功后会为你签发唯一的会员身份码，并直接登录活动平台。' : '验证码已发送到你填写的校园邮箱。验证通过后会为你签发唯一的会员身份码，并直接登录活动平台。' }),
      ),
      form,
    ),
  );

  if (context.query.get('sent') === '1') startCooldown();
  // Touch screens keep the page introduction visible until the user taps a field.
  if (window.matchMedia('(min-width: 861px) and (pointer: fine)').matches) {
    requestAnimationFrame(() => codeField.control.focus({ preventScroll: true }));
  }
  return { title: '邮箱验证', node, dispose: () => clearInterval(resendTimer) };
}
