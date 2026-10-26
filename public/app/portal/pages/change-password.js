import { h, icon } from '../../core/dom.js';
import { getAccountProfile, getRegistrationConfig, sendPasswordChangeCode, changePassword } from '../../core/api.js';
import { navigate } from '../../core/router.js';
import { button, field, notice } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';
import { PASSWORD_HINT, passwordPolicyError } from '../../core/password-policy.js';

export default async function changePasswordPage() {
  const [{ account }, config] = await Promise.all([
    getAccountProfile(),
    getRegistrationConfig().catch(() => ({ enabled: false, emailDomains: ['smail.nju.edu.cn', 'nju.edu.cn'] })),
  ]);
  const verified = account.emailVerified && (config.emailDomains || ['smail.nju.edu.cn', 'nju.edu.cn']).includes(account.email?.split('@')[1]);
  const enabled = Boolean(verified && config.enabled);
  const email = field({ label: verified ? '已验证邮箱' : '账号邮箱', name: 'email', type: 'email', value: account.email || '', autocomplete: 'email' });
  email.control.readOnly = true;
  const code = field({ label: '6 位修改密码验证码', name: 'code', required: true, maxlength: 6, autocomplete: 'one-time-code', placeholder: '请输入邮件中的验证码' });
  code.control.inputMode = 'numeric';
  const password = field({ label: '新密码', name: 'password', type: 'password', required: true, autocomplete: 'new-password', maxlength: 72, placeholder: '至少 8 位，包含大小写字母、数字和符号' });
  const confirm = field({ label: '再次输入新密码', name: 'confirm', type: 'password', required: true, autocomplete: 'new-password', maxlength: 72 });
  const feedback = h('div', { 'aria-live': 'polite' });
  const errors = h('div', { hidden: true, role: 'alert' });
  let timer = null, remaining = 0, sending = false, changing = false, disposed = false;
  const send = button({ label: '发送修改密码验证码', variant: 'secondary', iconName: 'mail', onClick: () => sendCode() });
  const submit = button({ label: '验证邮箱并修改密码', variant: 'primary', block: true, iconName: 'lock', onClick: () => submitChange() });
  function refreshButtons() {
    send.disabled = !enabled || sending || changing || remaining > 0;
    submit.disabled = !enabled || sending || changing;
  }
  function cooldown(seconds) {
    if (disposed) return;
    clearInterval(timer);
    remaining = Math.max(1, Math.ceil(Number(seconds) || 60));
    send.textContent = `${remaining} 秒后可重发`;
    refreshButtons();
    timer = setInterval(() => {
      remaining -= 1;
      send.textContent = remaining > 0 ? `${remaining} 秒后可重发` : '重新发送验证码';
      if (remaining <= 0) clearInterval(timer);
      refreshButtons();
    }, 1000);
  }
  async function sendCode() {
    if (send.disabled) return;
    sending = true; refreshButtons(); send.dataset.loading = 'true';
    try {
      const result = await sendPasswordChangeCode();
      if (!disposed) feedback.replaceChildren(notice(result.message, { tone: 'info' }));
      cooldown(result.retryAfter);
    } catch (error) {
      if (!disposed) feedback.replaceChildren(notice(error.message || '验证码发送失败，请稍后重试。', { tone: 'error' }));
      if (error.detail?.retryAfter) cooldown(error.detail.retryAfter);
    } finally { sending = false; delete send.dataset.loading; refreshButtons(); }
  }
  async function submitChange() {
    if (!enabled || sending || changing) return;
    errors.hidden = true;
    for (const f of [code, password, confirm]) f.setError(null);
    if (!/^\d{6}$/.test(code.control.value.trim())) { code.setError('请输入 6 位数字验证码'); code.control.focus(); return; }
    const error = passwordPolicyError(password.control.value);
    if (error) { password.setError(error); password.control.focus(); return; }
    if (password.control.value !== confirm.control.value) { confirm.setError('两次输入的新密码不一致'); confirm.control.focus(); return; }
    changing = true; refreshButtons(); submit.dataset.loading = 'true';
    try {
      const result = await changePassword(code.control.value.trim(), password.control.value);
      password.control.value = ''; confirm.control.value = ''; code.control.value = '';
      notify.success('密码已修改', result.securityNoticeSent ? '已发送改密通知，全部旧登录会话已失效，请重新登录。' : '全部旧登录会话已失效，请重新登录。改密通知邮件暂未送达。');
      navigate('/login', { replace: true });
    } catch (error) {
      if (!disposed) { errors.hidden = false; errors.replaceChildren(notice(error.message || '修改失败，请稍后重试。', { tone: 'error' })); }
    } finally { changing = false; delete submit.dataset.loading; refreshButtons(); }
  }
  refreshButtons();
  return {
    title: '修改密码',
    node: h('div', { class: 'view' }, h('div', { class: 'formpage' },
      h('header', { class: 'stack-3' },
        h('a', { href: '/me', class: 't-caption t-muted row-2' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回会员中心' })),
        h('h1', { class: 't-h1', text: '验证邮箱后修改密码' }),
        h('p', { class: 't-prose', text: '验证码只会发送至当前账号的已验证校园邮箱。修改成功后，所有设备上的旧登录会话都会失效，请使用新密码重新登录。' })),
      h('section', { class: 'panel' }, h('form', { class: 'panel__body stack-4', on: { submit: event => { event.preventDefault(); submitChange(); } } },
        email,
        h('p', { class: 't-caption t-muted', text: '邮箱由账号自动读取。如需更换绑定邮箱，请联系管理员。' }),
        ...(!verified ? [notice('该账号尚未绑定已验证的校园邮箱，请联系管理员处理。', { tone: 'warning' })] : []),
        ...(verified && !config.enabled ? [notice('验证码邮件服务暂不可用，请稍后再试。', { tone: 'warning' })] : []),
        send, feedback, code, password, confirm,
        h('p', { class: 't-caption t-muted', text: `验证码 10 分钟内有效，仅限本账号修改密码；重新发送后旧验证码失效。${PASSWORD_HINT} 新密码不能与当前密码相同。` }),
        errors, submit)))),
    dispose: () => { disposed = true; clearInterval(timer); },
  };
}
