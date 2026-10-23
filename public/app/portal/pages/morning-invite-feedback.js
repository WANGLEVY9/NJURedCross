import { h } from '../../core/dom.js';
import { morningApi, getSessionState } from '../../core/api.js';
import { badge, button, notice, pageHead, receipt } from '../../ui/primitives.js';
import { loginRequiredPanel } from '../auth-gate.js';
import { openInviteFeedbackModal } from '../morning-invitation.js';

export default async function morningInviteFeedbackPage(context) {
  const token = context.query.get('token') || '';
  const node = h('div', { class: 'view morning-view' });
  node.append(pageHead({
    label: '早安晚安 · 好友邀约',
    title: '邀约反馈',
    description: '确认你是否通过这次邀约成功结识了对方。',
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
    if (invitation.status === '已反馈') {
      content.replaceChildren(
        receipt({
          title: '该邀约已经完成报备',
          rows: [
            ['邀约编号', invitation.id],
            ['我的昵称', invitation.recipientNickname || '—'],
            ['对方昵称', invitation.inviterNickname || '—'],
            ['报备时间', invitation.feedbackAt || '—'],
          ],
        }),
        notice('无需重复提交。', { tone: 'success' }),
      );
      return { title: '邀约反馈', node };
    }
    content.replaceChildren(
      notice('确认后会向平台指导组发送成功结识通知，不会公开联系方式。', { tone: 'info' }),
      button({
        label: '打开确认窗口',
        variant: 'primary',
        iconName: 'check',
        onClick: () => openInviteFeedbackModal({ token, invitation }),
      }),
    );
    openInviteFeedbackModal({ token, invitation });
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
