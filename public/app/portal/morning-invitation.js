import { h } from '../core/dom.js';
import { morningApi } from '../core/api.js';
import { notify, reportError } from '../core/toast.js';
import { navigate } from '../core/router.js';
import {
  button,
  definitionList,
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
      notice('邀约邮件会包含你的公开昵称、主页链接和账号邮箱。对方可以选择忽略，平台不会公开邀约内容。', {
        tone: 'info',
        title: '对方会收到什么',
      }),
      messageField,
      notice('个人主页和反馈链接有效期为 3 天，请勿在附言中填写身份证、住址等敏感信息。', {
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

export function openInviteFeedbackModal({ token, invitation, onDone } = {}) {
  const fallbackField = invitation.inviterNickname
    ? null
    : field({
        label: '对方昵称',
        name: 'otherNickname',
        required: true,
        maxlength: 40,
        placeholder: '填写与你成功结识的同学昵称',
      });
  const confirmButton = button({
    label: '确认报备',
    variant: 'primary',
    iconName: 'check',
    onClick: () => confirm(),
  });
  let drawer;
  drawer = openDrawer({
    placement: 'center',
    width: 560,
    eyebrow: '早安晚安 · 邀约反馈',
    title: '确认好友邀约结果',
    description: '仅用于统计邀约发出与成功结识数量，不会公开你的联系方式。',
    body: [
      definitionList([
        ['我的昵称', invitation.recipientNickname || '—'],
        ['对方昵称', invitation.inviterNickname || '待补充'],
        ['邀约时间', invitation.createdAt || invitation.feedbackAt || '—'],
        ['链接有效期', invitation.expiresAt || '—'],
      ]),
      fallbackField,
      notice('确认后将向平台指导组发送一封成功结识报备邮件。', { tone: 'info' }),
    ].filter(Boolean),
    footer: [
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      confirmButton,
    ],
  });

  async function confirm() {
    if (fallbackField && !fallbackField.control.reportValidity()) return;
    try {
      const payload = await runWithLoading(confirmButton, () => morningApi.confirmInviteFeedback(token, {
        ...(fallbackField ? { otherNickname: fallbackField.control.value.trim() } : {}),
      }));
      notify.success('报备完成', payload.message);
      drawer.setBody(
        h('div', { class: 'stack-4' },
          receipt({
            title: '已记录成功结识',
            rows: [
              ['邀约编号', payload.invitation.id],
              ['我的昵称', payload.invitation.recipientNickname],
              ['对方昵称', payload.invitation.inviterNickname],
            ],
          }),
          notice(payload.message, { tone: 'success' }),
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
      if (error.status === 400 || error.status === 409 || error.status === 410) {
        notify.warning('报备未完成', error.message);
        return;
      }
      reportError(error, '报备未完成');
    }
  }

  return drawer;
}
