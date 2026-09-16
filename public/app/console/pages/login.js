/* ==========================================================================
   console/pages/login.js — the operations gate.
   Full-bleed surface (no console chrome). States: default / loading / error /
   locked out, plus an honest description of what this account can reach.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { login, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, field, notice, badge, runWithLoading } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';

const FACTS = [
  ['lock', 'API 凭据不下发浏览器', '所有 SeaTable 访问都在服务端完成，页面只请求本站 /api/* 接口。'],
  ['shield', '写操作双重校验', '除会话 Cookie 之外，每次写入都要携带与会话绑定的 CSRF 令牌。'],
  ['activity', '操作留痕', '审批、出入库、签到核验、内容审核与发布都会记录操作者、时间与结果。'],
  ['eye', '字段级脱敏', '联系方式、学号与审核人标识在返回前脱敏，页面无法绕过。'],
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
      h('h1', { class: 't-h1', text: '登录以继续' }),
      h('p', { class: 't-secondary', text: '这里是内部工作区。审批、出入库、签到核验与内容审核都需要账号身份。' }),
    ),
    usernameField,
    passwordField,
    errorSlot,
    submitButton,
    h(
      'div',
      { class: 'row-3 row-wrap' },
      badge('仅管理平台账号可进入', { tone: 'warning', iconName: 'alert' }),
      h('span', { class: 't-caption', text: '尚未接入学校统一身份认证' }),
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

  const node = h(
    'div',
    { class: 'gate' },
    h(
      'aside',
      { class: 'gate__aside' },
      h(
        'div',
        { class: 'stack-5' },
        h('div', { class: 'row-3' }, h('span', { class: 'brand-mark' }), h('b', { class: 't-title', text: '南京大学红十字会' })),
        h('h2', { class: 't-h1', text: '把复杂表格变成可确认、可追溯的业务流程' }),
        h('p', { class: 't-prose', text: '运营端以任务闭环为单位组织：发现任务 → 查看对象 → 填写表单 → 预览变化 → 确认操作 → 返回凭证 → 留下审计记录。' }),
      ),
      h(
        'div',
        { class: 'gate__facts' },
        ...FACTS.map(([iconName, title, description]) =>
          h(
            'div',
            { class: 'gate__fact' },
            icon(iconName, 'ico ico--lg'),
            h('div', { class: 'stack-1' }, h('b', { class: 't-secondary t-strong', text: title }), h('p', { class: 't-caption', text: description })),
          ),
        ),
      ),
      h('p', { class: 't-caption t-faint', text: '生产部署前仍需完成：统一身份认证、密码哈希迁移、角色最小权限与集中式锁。' }),
    ),
    h('div', { class: 'gate__form' }, form),
  );

  requestAnimationFrame(() => usernameField.control.focus());
  return { title: '运营端登录', node, chrome: false };
}
