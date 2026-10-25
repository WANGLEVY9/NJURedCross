import { h } from '../core/dom.js';
import { morningApi } from '../core/api.js';
import { notify, reportError } from '../core/toast.js';
import { navigate } from '../core/router.js';
import {
  button,
  field,
  notice,
  receipt,
  runWithLoading,
} from '../ui/primitives.js';
import { openDrawer } from '../ui/overlay.js';

function redirectToCardSignup(viewer) {
  notify.warning(
    '先完善同行名片',
    viewer?.cardStatus === '待审核'
      ? '你的名片正在等待管理员审核，审核通过后即可发起好友邀约。'
      : '提交名片并等待管理员审核通过后，才能发起好友邀约。',
  );
  navigate('/morning?intent=invite');
}

export function openMorningInviteDrawer(card, { onDone, viewer } = {}) {
  if (viewer?.canInvite === false) {
    redirectToCardSignup(viewer);
    return null;
  }
  const messageField = field({
    label: '邀约附言',
    name: 'morningInviteMessage',
    multiline: true,
    rows: 4,
    maxlength: 200,
    placeholder: '写一句想对对方说的话，可不填。',
    hint: '最多 200 字。附言只会出现在发给对方的邀约邮件中，不会公开。',
  });
  const submitButton = button({
    label: '发送好友邀约',
    variant: 'primary',
    iconName: 'send',
    iconAfter: 'arrowRight',
    onClick: () => submit(),
  });
  let drawer;
  drawer = openDrawer({
    placement: 'center',
    width: 560,
    eyebrow: '早安晚安 · 好友邀约',
    title: `向${card.nickname || '这位同学'}发起好友邀约`,
    description: '邀请将通过校园邮箱发送给对方，不进入公开广场。',
    body: [
      notice('邮件会邀请对方查看你的同行名片，并选择同意或拒绝；只有对方同意后，平台才会向其展示你的邮箱。', {
        tone: 'info',
        title: '对方会收到什么',
      }),
      messageField,
      notice('邀约处理链接有效期为 3 天。请勿在附言中填写身份证、住址等敏感信息。', {
        tone: 'neutral',
      }),
    ],
    footer: [
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  async function submit() {
    if (messageField.control.value.length > 200) {
      messageField.setError('邀约附言不能超过 200 字');
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () => morningApi.invite(card.id, {
        message: messageField.control.value.trim(),
      }));
      notify.success('邀约已提交', payload.message);
      drawer.setBody(
        h('div', { class: 'stack-4' },
          receipt({
            title: '好友邀约已记录',
            rows: [
              ['邀约编号', payload.invitation.id],
              ['收件人', card.nickname || '对方'],
              ['有效期', '3 天'],
            ],
          }),
          notice(payload.message, { tone: payload.invitation.mailStatus === '已发送' ? 'success' : 'warning' }),
        ),
      );
      drawer.setFooter([
        h('span', { class: 'spacer' }),
        button({
          label: '完成',
          variant: 'primary',
          onClick: () => {
            drawer.close();
            onDone?.(payload);
          },
        }),
      ]);
    } catch (error) {
      if (error.code === 'morning_card_required') {
        drawer.close();
        redirectToCardSignup({ cardStatus: viewer?.cardStatus || null });
        return;
      }
      if (error.status === 400 || error.status === 409 || error.status === 429) {
        notify.warning('邀约未发送', error.message);
        return;
      }
      reportError(error, '邀约未发送');
    }
  }

  return drawer;
}

export async function openInviteFeedbackModal({ token, invitation, onDone } = {}) {
  const { buildMorningCardDetail } = await import('./pages/morning-card-detail.js');
  let busy = false;
  let drawer;
  const acceptButton = button({ label: '同意邀约', variant: 'primary', onClick: () => decide('accept') });
  const rejectButton = button({ label: '拒绝邀约', variant: 'secondary', onClick: () => decide('reject') });
  const card = invitation.card ? buildMorningCardDetail(invitation.card, { invitationPreview: true })
    : notice('对方名片暂不可用，请稍后重试。', { tone: 'warning' });
  const acceptedBody = (item) => [card,
    notice('已同意邀约，平台已自动记录双方成功结识。你可以通过以下邮箱联系对方。', { tone: 'success' }),
    receipt({ title: '对方邮箱', rows: [['邮箱', item.inviterEmail || '暂不可用']] }),
  ];
  const accepted = invitation.status === '已反馈';
  const rejected = invitation.status === '已拒绝';
  drawer = openDrawer({ placement: 'center', width: 680,
    eyebrow: '南京大学红十字会 · 早安晚安', title: '新的好友邀约',
    description: '查看对方的同行名片，按自己的意愿选择是否认识。',
    body: accepted ? acceptedBody(invitation) : rejected ? [notice('你已拒绝这次邀约。', { tone: 'neutral' })]
      : [card, invitation.message ? notice(`邀约附言：${invitation.message}`, { tone: 'neutral' }) : null,
        notice('同意后才会显示对方邮箱，并自动记录成功结识；同意或拒绝都会邮件通知发起人。', { tone: 'info' })].filter(Boolean),
    footer: accepted || rejected ? [button({ label: '关闭', variant: 'secondary', onClick: () => drawer.close() })] : [rejectButton, acceptButton],
  });
  async function decide(decision) {
    if (busy) return;
    busy = true; acceptButton.disabled = true; rejectButton.disabled = true;
    try {
      const payload = await morningApi.confirmInviteFeedback(token, { decision });
      if (decision === 'reject') {
        drawer.close(); notify.success('已拒绝邀约');
      } else {
        drawer.setBody(...acceptedBody(payload.invitation));
        drawer.setFooter(button({ label: '关闭', variant: 'secondary', onClick: () => drawer.close() }));
        notify.success('已同意邀约');
      }
      onDone?.(payload);
    } catch (error) { reportError(error, '邀约处理未完成'); }
    finally { busy = false; acceptButton.disabled = false; rejectButton.disabled = false; }
  }
  return drawer;
}
