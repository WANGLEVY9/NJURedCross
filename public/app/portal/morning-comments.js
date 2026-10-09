import { h } from '../core/dom.js';
import { morningApi } from '../core/api.js';
import { relative } from '../core/format.js';
import { notify, reportError } from '../core/toast.js';
import { button, checkbox, field, notice, runWithLoading } from '../ui/primitives.js';

function commentNode(comment) {
  return h(
    'article',
    { class: 'morning-comment' },
    h('p', { class: 'morning-comment__content', text: comment.content }),
    h('p', { class: 't-caption t-muted', text: relative(comment.createdAt) }),
  );
}

export function buildMorningCommentsPanel(cardId) {
  const list = h('div', { class: 'morning-comments__list' }, notice('正在读取评论…', { tone: 'neutral' }));
  const contentField = field({
    label: '评论',
    name: 'content',
    multiline: true,
    rows: 3,
    maxlength: 300,
    required: true,
    placeholder: '写下你想对这位同学说的话。',
    hint: '最多 300 字。评论会显示在这张名片下。',
  });
  const sendEmail = checkbox({
    name: 'sendEmail',
    label: '同时发邮件通知对方',
    description: '邮件发送到名片主人的账号邮箱，不在页面公开。',
    checked: true,
  });
  const shareStudentId = checkbox({ name: 'shareStudentId', label: '在邮件里提供我的学号' });
  const shareEmail = checkbox({ name: 'shareEmail', label: '在邮件里提供我的邮箱' });
  const shareQq = checkbox({ name: 'shareQq', label: '在邮件里提供我的 QQ' });
  const shareWechat = checkbox({ name: 'shareWechat', label: '在邮件里提供我的微信' });
  const contactOptions = h(
    'div',
    { class: 'morning-comments__contact-options' },
    shareStudentId,
    shareEmail,
    shareQq,
    shareWechat,
  );
  const syncContactOptions = () => {
    const disabled = !sendEmail.control.checked;
    contactOptions.dataset.disabled = String(disabled);
    for (const option of [shareStudentId, shareEmail, shareQq, shareWechat]) {
      option.control.disabled = disabled;
      if (disabled) option.control.checked = false;
      option.dataset.disabled = String(disabled);
    }
  };
  sendEmail.addEventListener('change', syncContactOptions);
  syncContactOptions();

  const submitButton = button({
    label: '发表评论',
    variant: 'primary',
    iconName: 'arrowRight',
    onClick: () => submit(),
  });
  const form = h(
    'form',
    { class: 'morning-comments__form', on: { submit: (event) => { event.preventDefault(); submit(); } } },
    h('div', { class: 'section-head__text' }, h('h3', { class: 't-h3', text: '给这位同学留言' }), h('p', { class: 't-caption', text: '评论会公开显示在名片详情里；邮件选项只影响通知。' })),
    contentField,
    h('div', { class: 'morning-comments__delivery' },
      sendEmail,
      h('div', { class: 'morning-comments__contact-head' }, h('p', { class: 't-label', text: '邮件中可附上' }), h('p', { class: 't-caption t-muted', text: '勾选后，对方会在邮件里看到对应联系方式。' })),
      contactOptions,
    ),
    h('div', { class: 'row-3 row-wrap' }, h('span', { class: 'spacer' }), submitButton),
  );

  async function load() {
    list.replaceChildren(notice('正在读取评论…', { tone: 'neutral' }));
    try {
      const payload = await morningApi.comments(cardId);
      const comments = payload.comments || [];
      list.replaceChildren(
        ...(comments.length
          ? comments.map(commentNode)
          : [h('p', { class: 't-caption t-muted', text: '还没有评论，来写下第一条留言吧。' })]),
      );
    } catch (error) {
      list.replaceChildren(notice(error.message || '评论暂时无法读取。', { tone: 'error' }));
    }
  }

  async function submit() {
    if (!contentField.control.reportValidity()) return;
    try {
      const payload = await runWithLoading(submitButton, () => morningApi.createComment(cardId, {
        content: contentField.control.value,
        sendEmail: sendEmail.control.checked,
        shareStudentId: shareStudentId.control.checked,
        shareEmail: shareEmail.control.checked,
        shareQq: shareQq.control.checked,
        shareWechat: shareWechat.control.checked,
      }));
      notify.success('评论已发布', payload.message);
      contentField.control.value = '';
      await load();
    } catch (error) {
      if (error.status === 400 || error.status === 429) {
        notify.warning('评论未发布', error.message);
        return;
      }
      reportError(error, '评论未发布');
    }
  }

  load();
  return h(
    'section',
    { class: 'morning-comments' },
    h('header', { class: 'morning-comments__head' }, h('div', { class: 'section-head__text' }, h('h3', { class: 't-h3', text: '评论' }), h('p', { class: 't-caption', text: '已通过审核的同行可以在这里留言。' }))),
    list,
    form,
  );
}
