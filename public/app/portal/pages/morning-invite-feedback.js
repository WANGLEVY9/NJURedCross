import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { badge, button, notice, pageHead } from '../../ui/primitives.js';
import { loginRequiredPanel } from '../auth-gate.js';
import { openInviteFeedbackModal } from '../morning-invitation.js';

export default async function morningInviteFeedbackPage(context) {
  const token = context.query.get('token') || '';
  const node = h('div', { class: 'view morning-view' });
  node.append(pageHead({
    label: '早安晚安 · 好友邀约',
    title: '邀约反馈',
    description: '查看对方的同行名片，选择同意或拒绝好友邀约。',
    actions: [button({ label: '返回同行广场', variant: 'secondary', iconName: 'chevronLeft', href: '/morning/plaza' })],
    meta: [badge('仅用于活动统计', { tone: 'neutral' }), badge('链接有效期 3 天', { tone: 'info' })],
  }));

  if (!getSessionState().authenticated) {
    node.append(loginRequiredPanel({
      what: '提交邀约反馈',
      hint: '请使用收到邀约邮件的账号登录，反馈结果只会记录在该账号下。',
    }));
    return { title: '邀约反馈', node };
  }
  if (!token) {
    node.append(notice('缺少邀约反馈令牌，请从邮件中的完整链接重新打开。', { tone: 'error', title: '链接不完整' }));
    return { title: '邀约反馈', node };
  }

  const content = h('div', { class: 'morning-content stack-5' }, notice('正在校验邀约链接…', { tone: 'neutral' }));
  node.append(content);
  try {
    const payload = await morningApi.inviteFeedback(token);
    const invitation = payload.invitation;
    content.replaceChildren(
      notice('这是南大红会「早安晚安」好友邀约，请在窗口查看名片并处理。', { tone: 'info' }),
      button({ label: '查看邀约', variant: 'primary', onClick: () => openInviteFeedbackModal({ token, invitation }) }),
    );
    await openInviteFeedbackModal({ token, invitation });
  } catch (error) {
    content.replaceChildren(
      notice(error.message || '邀约链接无效或已过期。', {
        tone: 'error',
        title: '无法读取邀约',
      }),
    );
  }
  return { title: '邀约反馈', node };
}
