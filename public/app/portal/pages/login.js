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
import { campusLoginIdentifier } from '../campus-login.js';
import { safePortalNext } from '../auth-flow.js';

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
  if (consoleAccess && next?.startsWith('/console') && !/[\\\x00-\x1f]/.test(next)) return next;
  return safePortalNext(next, null);
}

export default async function loginPage(context) {
  const next = context.query.get('next') || '';
  let pending = false;

  const usernameField = field({label:'学号',name:'username',required:true,iconName:'user',autocomplete:'username',placeholder:'请输入本人学号',maxlength:80});
  const domainField = field({label:'校园邮箱后缀',name:'emailDomain',value:'smail.nju.edu.cn',options:[{value:'smail.nju.edu.cn',label:'@smail.nju.edu.cn（学生邮箱）'},{value:'nju.edu.cn',label:'@nju.edu.cn'}]});
  const alternateField = field({label:'邮箱 / 姓名 / 原管理账号',name:'alternate',autocomplete:'username',placeholder:'已有账号可使用原登录方式'});
  alternateField.hidden=true;
  const modeField=field({label:'登录方式',name:'loginMode',value:'campus',options:[{value:'campus',label:'学号＋校园邮箱后缀'},{value:'other',label:'其他已有账号方式'}],onInput:()=>{const campus=modeField.control.value==='campus';usernameField.hidden=!campus;domainField.hidden=!campus;alternateField.hidden=campus;usernameField.control.required=campus;alternateField.control.required=!campus;}});
  const passwordField = field({ label: '密码', name: 'password', type: 'password', required: true, iconName: 'lock', autocomplete: 'current-password' });
  const errorSlot = h('div', { hidden: true, role: 'alert' });

  const submitButton = button({ label: '登录活动平台', variant: 'primary', size: 'lg', block: true, iconName: 'arrowRight', iconMotion: 'nudge', onClick: () => submit() });

  async function submit() {
    if (pending) return;
    usernameField.setError(null);
    passwordField.setError(null);
    errorSlot.hidden = true;
    let username;
    try {username=modeField.control.value==='campus'?campusLoginIdentifier(usernameField.control.value,domainField.control.value):alternateField.control.value.trim();}
    catch(error){usernameField.setError(error.message);usernameField.control.focus();return;}
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

    pending = true;
    try {
      const payload = await runWithLoading(submitButton, () => login(username, password));
      const consoleAccess = payload?.user?.consoleAccess === true;
      notify.success('登录成功', consoleAccess ? '该账号同时具备管理平台权限。' : '已进入活动平台。');
      const target = safeNext(next, consoleAccess) || (consoleAccess ? '/console/overview' : '/me');
      navigate(target, { replace: true });
    } catch (error) {
      if (error.code === 'email_verification_required') {
        navigate(`/verify-email?email=${encodeURIComponent(error.detail?.email || username)}&next=${encodeURIComponent(safePortalNext(next))}`);
        return;
      }
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
      modeField,
      usernameField,
      domainField,
      alternateField,
      passwordField,
      h('p', { class: 't-caption t-muted', text: '填写学号后自动补全校园邮箱。请选择注册时的邮箱后缀；姓名、完整邮箱及原管理账号可通过“其他已有账号方式”登录。' }),
      errorSlot,
      submitButton,
      h(
        'div',
        { class: 'row-3 row-wrap' },
        badge('学生账号', { tone: 'accent', iconName: 'user' }),
        h('span', { class: 't-caption', text: '还没有账号？用校园邮箱即可自助注册。' }),
      ),
      h('div', { class: 'row-3 row-wrap' },
        h('span', { class: 't-caption t-muted', text: '首次使用？' }),
        h('span', { class: 'spacer' }),
        button({ label: '注册新账号', variant: 'ghost', size: 'sm', iconName: 'user', href: `/register?next=${encodeURIComponent(safePortalNext(next))}` }),
        button({ label: '忘记密码', variant: 'ghost', size: 'sm', href: '/reset-password' }),
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
        h('p', { class: 't-prose', text: '浏览活动、了解物资借用规则与温暖连接计划无需登录。登录用于提交报名、借用、投稿与参加登记，并让你在会员中心里看到这些记录的最新状态。' }),
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

  // Touch screens keep the page introduction visible until the user taps a field.
  if (window.matchMedia('(min-width: 861px) and (pointer: fine)').matches) {
    requestAnimationFrame(() => usernameField.control.focus({ preventScroll: true }));
  }
  return { title: '活动平台登录', node };
}
