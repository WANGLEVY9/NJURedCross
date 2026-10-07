/* ==========================================================================
   portal/pages/register.js
   Self-service registration. The campus e-mail is the identity anchor: only
   @smail.nju.edu.cn / @nju.edu.cn addresses may register, and the account
   only becomes usable after the e-mail is verified (a code is sent on
   submit; verification hands out the member code and signs the account in).
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { getRegistrationConfig, registerAccount, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, field, notice, badge } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';
import { safePortalNext } from '../auth-flow.js';
import { PASSWORD_HINT, passwordPolicyError, registrationProfileError } from '../../core/password-policy.js';

export default async function registerPage(context) {
  const next = safePortalNext(context.query.get('next'));
  let pending = false;
  const registration = await getRegistrationConfig().catch(() => ({
    enabled: false,
    minimumPasswordLength: 8,
    emailDomains: ['smail.nju.edu.cn', 'nju.edu.cn'],
    message: '暂时无法确认注册服务状态，请稍后再试。',
  }));
  const minimumPasswordLength = Number(registration.minimumPasswordLength) || 8;
  const domainHint = (registration.emailDomains || ['smail.nju.edu.cn', 'nju.edu.cn'])
    .map((domain) => `@${domain}`)
    .join(' 或 ');
  const smailHint = `注册邮箱须为 ${domainHint}，验证码会发送到该邮箱。`;
  const emailPreview = h('p', {class:'t-caption t-muted','aria-live':'polite',text:'填写学号后将自动生成校园邮箱。'});
  function updateEmail(){emailPreview.textContent=studentIdField.control.value.trim()?`验证码将发送至：${studentIdField.control.value.trim()}@${domainField.control.value}`:'填写学号后将自动生成校园邮箱。';}
  const studentIdField = field({label:'学号',name:'studentId',required:true,maxlength:20,autocomplete:'username',placeholder:'请填写本人真实学号',onInput:updateEmail});
  studentIdField.control.inputMode='numeric';
  const realNameField = field({label:'真实姓名',name:'realName',required:true,maxlength:40,autocomplete:'name',placeholder:'请填写本人真实姓名'});
  const domainField = field({label:'校园邮箱后缀',name:'emailDomain',value:'smail.nju.edu.cn',options:[{value:'smail.nju.edu.cn',label:'@smail.nju.edu.cn（学生邮箱）'},{value:'nju.edu.cn',label:'@nju.edu.cn'}],onInput:updateEmail});
  const passwordField = field({ label: '设置密码', name: 'password', type: 'password', required: true, iconName: 'lock', autocomplete: 'new-password', placeholder: `至少 ${minimumPasswordLength} 位` });
  const confirmField = field({ label: '再次输入密码', name: 'confirmPassword', type: 'password', required: true, autocomplete: 'new-password', maxlength: 72 });
  passwordField.control.maxLength = 72;
  const errorSlot = h('div', { hidden: true, role: 'alert' });

  const submitButton = button({ label: '注册并获取验证码', variant: 'primary', size: 'lg', block: true, iconName: 'arrowRight', iconMotion: 'nudge', onClick: () => submit() });
  submitButton.disabled = !registration.enabled;

  async function submit() {
    if (!registration.enabled || pending) return;
    domainField.setError(null);
    passwordField.setError(null);
    realNameField.setError(null); studentIdField.setError(null);
    confirmField.setError(null);
    errorSlot.hidden = true;

    const emailDomain = domainField.control.value;
    const email = `${studentIdField.control.value.trim()}@${emailDomain}`;
    const password = passwordField.control.value;
    const realName = realNameField.control.value.trim();
    const studentId = studentIdField.control.value.trim();
    const profileError = registrationProfileError(realName, studentId);
    if (profileError) { const target = profileError.includes('学号') ? studentIdField : realNameField; target.setError(profileError); target.control.focus(); return; }
    if (!password) {
      passwordField.setError('请设置密码');
      shake(passwordField);
      return;
    }
    const passwordError = passwordPolicyError(password);
    if (passwordError) { passwordField.setError(passwordError); passwordField.control.focus(); return; }
    if (confirmField.control.value !== password) { confirmField.setError('两次输入的密码不一致'); confirmField.control.focus(); return; }
    pending = true;

    try {
      const payload = await (async () => {
        submitButton.dataset.loading = 'true'; submitButton.disabled = true;
        try {
          return await registerAccount({ emailDomain, password, realName, studentId });
        } finally {
          delete submitButton.dataset.loading; submitButton.disabled = false;
        }
      })();
      const deliveryFailed = payload?.deliveryStatus === 'failed';
      if (deliveryFailed) notify.warning('账号已创建，邮件未送达', '请在验证页稍后重发验证码；验证前账号不可登录。');
      else notify.success('注册成功', `验证码已发送到 ${email}，10 分钟内有效。`);
      const deliveryQuery = deliveryFailed ? '&delivery=failed' : '';
      passwordField.control.value = ''; confirmField.control.value = '';
      navigate(`/verify-email?email=${encodeURIComponent(email)}&sent=1&next=${encodeURIComponent(next)}${deliveryQuery}`, { replace: true });
    } catch (error) {
      errorSlot.hidden = false;
      errorSlot.replaceChildren(
        notice(error.message || '注册失败，请稍后重试。', {
          tone: error instanceof ApiError && error.isRateLimited ? 'warning' : 'error',
          title: '无法完成注册',
        }),
      );
      shake(errorSlot);
    } finally { pending = false; }
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
      studentIdField,
      realNameField,
      domainField,
      emailPreview,
      h('p', { class: 't-caption t-muted', text: '身份资料仅需填写学号和真实姓名，校园邮箱自动生成；手机号等资料可在会员中心补全。重名时请使用学号或邮箱登录。' }),
      passwordField,
      confirmField,
      h('p', { class: 't-caption t-muted', text: `${PASSWORD_HINT} 完成邮箱验证前账号不可登录。` }),
      ...(!registration.enabled ? [notice(registration.message, { tone: 'warning', title: '注册通道暂未开放' })] : []),
      errorSlot,
      submitButton,
      h('div', { class: 'row-3 row-wrap' }, badge('强绑定校园邮箱', { tone: 'accent', iconName: 'mail' }), h('span', { class: 't-caption', text: smailHint })),
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
            h('li', { text: '填写学号、真实姓名，选择校园邮箱后缀，并设置密码；' }),
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

  // Touch screens keep the page introduction visible until the user taps a field.
  if (window.matchMedia('(min-width: 861px) and (pointer: fine)').matches) {
    requestAnimationFrame(() => studentIdField.control.focus({ preventScroll: true }));
  }
  return { title: '注册账号', node };
}
