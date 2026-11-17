/* ==========================================================================
   portal/pages/feedback.js
   Task: platform problem feedback (N1 平台问题反馈) — public submit form.
   Member-only write: the submission is attributed to the signed-in account so
   it can be followed up from the processing console.
   ========================================================================== */

import { h, clear } from '../../core/dom.js';
import { publicApi, ApiError, getSessionState } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, badge, notice, receipt, copyableCode, runWithLoading } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';

const CATEGORIES = ['注册', '登录', '资料', '报名', '时长', 'Bug', '其他'];

export default async function feedbackPage() {
  let disposed = false;
  const formSlot = h('div', { class: 'stack-6' });
  const submitError = h('div', { role: 'alert' });

  function buildForm() {
    clear(formSlot);
    if (!isSignedIn()) {
      formSlot.append(loginRequiredPanel({ what: '问题反馈', hint: '提交后会归属到你的账号，便于后续跟进处理结果。' }));
      return;
    }

    const profile = getSessionState().user || {};
    const categoryField = field({
      label: '问题分类', name: 'category', required: true,
      options: [{ value: '', label: '请选择分类' }].concat(CATEGORIES.map(category => ({ value: category, label: category }))),
    });
    const descriptionField = field({
      label: '问题描述', name: 'description', required: true, multiline: true, rows: 6,
      placeholder: '请尽量描述清楚遇到的问题、复现步骤与期望的结果。',
    });
    const contactField = field({
      label: '联系方式', name: 'contact', type: 'text', required: true,
      placeholder: '用于接收处理回复，如邮箱或手机号', value: profile.email || '',
    });
    const screenshotField = field({
      label: '截图链接（选填）', name: 'screenshot', placeholder: '可粘贴图片地址',
      hint: '截图上传正在接入中，暂时支持粘贴图片链接。',
    });
    const submitButton = button({ label: '提交反馈', variant: 'primary', iconName: 'check', onClick: () => submit() });

    formSlot.append(
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '问题信息' }), h('p', { class: 't-caption', text: '分类用于把问题分派到对应的负责部门。' })),
        categoryField,
        descriptionField,
      ),
      h('div', { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '联系方式' }), h('p', { class: 't-caption', text: '仅用于管理员回复你的问题，不会公开展示。' })),
        contactField,
        screenshotField,
      ),
      submitError,
      h('div', { class: 'row-3' }, h('span', { class: 'spacer' }), submitButton),
    );

    async function submit() {
      clear(submitError);
      for (const f of [categoryField, descriptionField, contactField]) f.setError(null);
      let invalid = null;
      if (!categoryField.control.value) { categoryField.setError('请选择问题分类'); invalid = categoryField; }
      if (!descriptionField.control.value.trim()) { descriptionField.setError('请填写问题描述'); invalid = descriptionField; }
      else if (descriptionField.control.value.trim().length > 2000) { descriptionField.setError('问题描述不能超过 2000 字'); invalid = descriptionField; }
      if (!contactField.control.value.trim()) { contactField.setError('请填写联系方式'); invalid = contactField; }
      if (invalid) { shake(invalid); invalid.control.focus(); return; }

      try {
        const payload = await runWithLoading(submitButton, () => publicApi.feedbackSubmit({
          category: categoryField.control.value,
          description: descriptionField.control.value.trim(),
          contact: contactField.control.value.trim(),
          screenshot: screenshotField.control.value.trim(),
        }));
        notify.success('反馈已提交', payload.message);
        clear(formSlot);
        formSlot.append(
          receipt({
            title: '反馈已提交，我们会尽快处理',
            rows: [
              ['反馈编号', payload.issue.code],
              ['问题分类', payload.issue.category],
              ['当前状态', payload.issue.status],
              ['提交时间', payload.issue.submittedAt],
            ],
          }),
          h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.issue.code, { label: '复制反馈编号' }), h('span', { class: 't-caption', text: '处理结果会通过你填写的联系方式回复。' })),
          notice('如问题紧急，也可直接联系红十字会管理员。', { tone: 'neutral' }),
          h('div', { class: 'row-3' }, button({ label: '返回首页', variant: 'secondary', href: '/' }), button({ label: '再提交一条', variant: 'ghost', iconName: 'plus', onClick: buildForm })),
        );
      } catch (error) {
        if (redirectIfAuthError(error)) return;
        submitError.replaceChildren(notice(error.message || '反馈未提交，请保留内容后重试。', { tone: 'error' }));
        submitError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (error instanceof ApiError && (error.status === 400 || error.isRateLimited)) { notify.warning('反馈未提交', error.message); return; }
        reportError(error, '反馈未提交');
      }
    }
  }

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' },
      h('header', { class: 'stack-3' },
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '平台服务' }), badge('问题反馈', { tone: 'accent', iconName: 'help' })),
        h('h1', { class: 't-h1', text: '平台问题反馈' }),
        h('p', { class: 't-prose', text: '在使用平台过程中遇到注册、登录、报名、时长等问题，都可以在这里反馈。我们会分派给负责部门处理，并通过你填写的联系方式回复。' }),
      ),
      formSlot,
    ),
  );

  buildForm();
  return { title: '问题反馈', node, dispose: () => { disposed = true; } };
}
