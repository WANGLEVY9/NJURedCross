/* ==========================================================================
   portal/pages/submit.js
   Task: contribute content (article, photo set, design, activity write-up)
   with explicit authorship, licence and attribution choices.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, checkbox, notice, receipt, copyableCode, segmented, runWithLoading, badge } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';

const CATEGORIES = [
  { value: '宣传稿件', label: '文字稿件', hint: '活动通讯、人物专访、科普短文' },
  { value: '影像作品', label: '影像作品', hint: '活动摄影、短视频、纪实记录' },
  { value: '文创设计', label: '文创设计', hint: '海报、周边、视觉方案' },
  { value: '课程反馈', label: '课程反馈', hint: '生命教育与急救培训的改进建议' },
];

const SIGNATURES = [
  { value: '实名署名', label: '实名署名' },
  { value: '笔名署名', label: '笔名署名' },
  { value: '对外匿名', label: '对外匿名' },
];

export default async function submitPage() {
  let category = CATEGORIES[0].value;
  let signature = SIGNATURES[0].value;

  const categoryHint = h('p', { class: 't-caption', text: CATEGORIES[0].hint });
  const categoryControl = segmented({
    items: CATEGORIES.map((item) => ({ value: item.value, label: item.label })),
    value: category,
    ariaLabel: '投稿类型',
    onChange: (value) => {
      category = value;
      categoryControl.setValue(value);
      categoryHint.textContent = CATEGORIES.find((item) => item.value === value)?.hint || '';
    },
  });

  const signatureControl = segmented({
    items: SIGNATURES,
    value: signature,
    ariaLabel: '署名方式',
    onChange: (value) => {
      signature = value;
      signatureControl.setValue(value);
      signatureNote.textContent =
        value === '对外匿名'
          ? '对外发布时不会出现你的姓名或笔名，但管理员仍可追溯投稿来源，用于沟通与责任确认。'
          : value === '笔名署名'
            ? '请在正文末尾写明希望使用的笔名。'
            : '对外发布时会使用你在下方填写的联系人姓名。';
    },
  });
  const signatureNote = h('p', { class: 't-caption', text: '对外发布时会使用你在下方填写的联系人姓名。' });

  const titleField = field({ label: '标题', name: 'title', required: true, placeholder: '一句话说明这篇内容是什么' });
  const contentField = field({
    label: '正文 / 作品说明',
    name: 'content',
    required: true,
    multiline: true,
    rows: 10,
    maxlength: 4000,
    placeholder: '文字稿件请直接粘贴正文；影像与设计类请写明创作说明，并把作品链接（校内网盘、相册分享链接）附在末尾。',
    hint: '最多 4000 字。平台暂不直接接收大文件，请提供可访问的链接。',
  });
  const nameField = field({ label: '联系人', name: 'name', required: true, iconName: 'user' });
  const emailField = field({ label: '联系邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', placeholder: 'your_id@smail.nju.edu.cn' });

  const counter = h('p', { class: 't-caption t-faint', text: '0 / 4000' });
  contentField.control.addEventListener('input', () => {
    counter.textContent = `${contentField.control.value.length} / 4000`;
  });

  const originalConfirm = checkbox({
    name: 'originalConfirm',
    label: '内容为本人原创，或已获得原作者授权',
    description: '若使用了他人的文字、照片、插画或音乐，请在正文中注明来源并确认已获得授权。',
  });
  const portraitConfirm = checkbox({
    name: 'portraitConfirm',
    label: '内容中出现的人物已知情并同意公开（如适用）',
    description: '涉及可识别人物的照片或视频，需要事先取得被拍摄者同意。',
  });
  const consent = checkbox({
    name: 'consent',
    label: '同意由红十字会在校内宣传渠道中使用本内容',
    description: '使用范围包括平台页面、校内邮件、公众号与 QQ 群公告。所有内容都会先经过人工审核；不通过或退回修改时会告知原因。',
  });

  const formSlot = h('div', { class: 'stack-6' });

  const submitButton = button({ label: '提交投稿', variant: 'primary', iconName: 'send', onClick: () => submit() });

  function buildForm() {
    clear(formSlot);
    formSlot.append(
      h(
        'div',
        { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '内容类型' })),
        categoryControl,
        categoryHint,
      ),
      h(
        'div',
        { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '内容本身' })),
        titleField,
        contentField,
        h('div', { class: 'row-between' }, h('span', { class: 't-caption t-faint', text: '正文会原样进入审核队列' }), counter),
      ),
      h(
        'div',
        { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '署名方式' })),
        signatureControl,
        signatureNote,
      ),
      h(
        'div',
        { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '联系方式' }), h('p', { class: 't-caption', text: '仅用于审核沟通，不会公开展示。' })),
        h('div', { class: 'formgrid' }, nameField, emailField),
      ),
      h(
        'div',
        { class: 'fieldset' },
        h('div', { class: 'fieldset__head' }, h('h2', { class: 't-h3', text: '授权确认' })),
        originalConfirm,
        portraitConfirm,
        consent,
      ),
      h('div', { class: 'row-3' }, h('span', { class: 'spacer' }), submitButton),
    );
  }

  async function submit() {
    for (const control of [titleField, contentField, nameField, emailField]) control.setError(null);
    let invalid = null;
    if (!titleField.control.value.trim()) {
      titleField.setError('请填写标题');
      invalid = titleField;
    }
    if (contentField.control.value.trim().length < 20) {
      contentField.setError('正文至少 20 个字，便于审核判断');
      invalid = invalid || contentField;
    }
    if (!nameField.control.value.trim()) {
      nameField.setError('请填写联系人');
      invalid = invalid || nameField;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.control.value.trim())) {
      emailField.setError('请填写有效的邮箱地址');
      invalid = invalid || emailField;
    }
    if (invalid) {
      shake(invalid);
      invalid.control.focus();
      return;
    }
    if (!originalConfirm.control.checked || !consent.control.checked) {
      shake(originalConfirm.control.checked ? consent : originalConfirm);
      notify.warning('还需要两项确认', '请确认原创/授权声明与内容使用范围。');
      return;
    }

    try {
      const payload = await runWithLoading(submitButton, () =>
        publicApi.submission({
          title: titleField.control.value.trim(),
          content: contentField.control.value.trim(),
          category,
          signature,
          name: nameField.control.value.trim(),
          email: emailField.control.value.trim(),
          originalConfirm: true,
          portraitConfirm: portraitConfirm.control.checked,
          consent: true,
        }),
      );
      notify.success('投稿已提交', payload.message);
      clear(formSlot);
      formSlot.append(
        receipt({
          title: '投稿已进入人工审核队列',
          rows: [
            ['投稿编号', payload.submission.id],
            ['标题', payload.submission.title],
            ['当前状态', payload.submission.status],
            ['提交时间', payload.submission.submittedAt],
          ],
        }),
        h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.submission.id, { label: '复制投稿编号' }), h('span', { class: 't-caption', text: '审核结果会发送到你的联系邮箱。' })),
        notice('审核通过的内容会进入排期，由运营同学确认后再对外发布；被退回修改时你会收到具体意见。', { tone: 'info' }),
        h('div', { class: 'row-3' }, button({ label: '再投一篇', variant: 'secondary', iconName: 'plus', onClick: () => resetForm() }), button({ label: '返回首页', variant: 'ghost', href: '/' })),
      );
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.isRateLimited)) {
        notify.warning('投稿未提交', error.message);
        return;
      }
      reportError(error, '投稿未提交');
    }
  }

  function resetForm() {
    titleField.control.value = '';
    contentField.control.value = '';
    counter.textContent = '0 / 4000';
    buildForm();
  }

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
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '内容征集' }), badge('人工审核', { tone: 'accent', iconName: 'shield' })),
        h('h1', { class: 't-h1', text: '把你的记录与创作交给我们' }),
        h('p', { class: 't-prose', text: '活动通讯、现场摄影、文创设计与课程反馈都欢迎投递。你可以选择实名、笔名或对外匿名；无论哪一种，管理员都能追溯来源以便沟通，而对外发布严格按你选择的署名方式执行。' }),
      ),
      formSlot,
    ),
  );

  buildForm();
  return { title: '内容投稿', node };
}
