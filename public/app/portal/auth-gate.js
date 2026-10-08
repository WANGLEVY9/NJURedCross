/* ==========================================================================
   portal/auth-gate.js
   Shared helpers for the portal actions that now require an account.

   Reading stays open, so a visitor can browse everything before signing in.
   Writing does not: registering, borrowing, submitting and joining the warmth
   programme all need an identity, because that identity is what makes the
   record findable again from the personal centre.
   ========================================================================== */

import { h } from '../core/dom.js';
import { button, notice } from '../ui/primitives.js';
import { getSessionState } from '../core/api.js';
import { redirect } from '../core/router.js';

export function isSignedIn() {
  return getSessionState().authenticated;
}

/**
 * 占位：判定「红十字会员」身份。当前以会员身份码（已验证会员才有）兜底；
 * 等真实的「红十字会员」标志字段确定后，只需改这一处判断。
 */
export function hasRedCrossMembership() {
  return Boolean(getSessionState().user?.memberCode);
}

/** Where to send someone so they come back to exactly where they were. */
export function loginHref() {
  return `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/**
 * Inline panel for an anonymous visitor on an action page. Shown instead of a
 * submit affordance that would only fail, so nobody fills in a long form and
 * then loses it at the end.
 */
export function loginRequiredPanel({ what = '提交', hint = '' } = {}) {
  return h(
    'section',
    { class: 'panel panel--raised' },
    h(
      'div',
      { class: 'panel__body stack-4' },
      notice(`${what}需要先登录活动平台。登录后提交的内容会归属到你的账号，之后可以在会员中心里随时查看审核与处理进度。`, {
        tone: 'warning',
        title: '这一步需要账号身份',
      }),
      hint ? h('p', { class: 't-caption t-muted', text: hint }) : null,
      h(
        'div',
        { class: 'row-3 row-wrap' },
        button({ label: '登录活动平台', variant: 'primary', iconName: 'lock', href: loginHref() }),
        h('span', { class: 't-caption t-muted', text: '还没有账号？账号由平台管理员发放。' }),
      ),
    ),
  );
}

/**
 * Inline panel for a signed-in user who is not yet a Red Cross member, shown
 * on member-only actions (borrowing, inbound registration). Distinct from
 * loginRequiredPanel so the visitor knows they are signed in but lack the role.
 */
export function memberOnlyPanel({ what = '该功能', hint = '' } = {}) {
  return h(
    'section',
    { class: 'panel panel--raised' },
    h(
      'div',
      { class: 'panel__body stack-4' },
      notice(`${what}仅限红十字会员使用。你已登录，但当前账号还不是会员；如需开通，请联系红十字会管理员。`, {
        tone: 'warning',
        title: '需要会员身份',
      }),
      hint ? h('p', { class: 't-caption t-muted', text: hint }) : null,
      h('div', { class: 'row-3 row-wrap' }, h('span', { class: 't-caption t-muted', text: '成为会员后可在线申请借用物资、登记入库等。' })),
    ),
  );
}

/**
 * Turns a 401 from a write into a trip to the sign-in screen. Returns true when
 * it handled the error, so callers can simply `return` afterwards.
 */
export function redirectIfAuthError(error) {
  if (!error?.isAuth) return false;
  redirect(loginHref());
  return true;
}
