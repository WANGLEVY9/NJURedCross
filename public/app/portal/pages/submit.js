/* ==========================================================================
   portal/pages/submit.js
   Task: contribute content in a three-step workbench — pick a category,
   write the piece, then attach files, sign and submit. Attachments relay
   through this origin to object storage, so the CSP stays connect-src 'self'.
   ========================================================================== */

import { h, icon, clear, setVars } from '../../core/dom.js';
import { publicApi, uploadAttachment, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, checkbox, notice, receipt, copyableCode, segmented, runWithLoading, badge, iconButton, steps } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';

const CATEGORIES = [
  { value: '宣传稿件', label: '文字稿件', hint: '活动通讯、人物专访、科普短文', icon: 'edit', brief: '文字稿件请直接粘贴全文正文，编辑会保留段落结构进入审核。' },
  { value: '影像作品', label: '影像作品', hint: '活动摄影、短视频、纪实记录', icon: 'camera', brief: '请写明拍摄背景与内容说明；作品文件在下一步上传，也可把相册链接贴在正文末尾。' },
  { value: '文创设计', label: '文创设计', hint: '海报、周边、视觉方案', icon: 'sparkle', brief: '请说明设计理念与使用场景；源文件（PSD/AI/压缩包）在下一步上传。' },
  { value: '课程反馈', label: '课程反馈', hint: '生命教育与急救培训的改进建议', icon: 'heart', brief: '请写明课程名称、学期与具体的改进建议，便于转达给授课讲师。' },
];

const SIGNATURES = [
  { value: '实名署名', label: '实名署名' },
  { value: '笔名署名', label: '笔名署名' },
  { value: '对外匿名', label: '对外匿名' },
];

/* Front-end mirror of the server file matrix: catches mistakes before a
   slot is spent. The server remains the authority. */
const FILE_RULES = [
  { test: /^image\//, maxSize: 20 * 1024 * 1024, label: '图片 · 20MB', icon: 'image' },
  { test: /^video\//, maxSize: 200 * 1024 * 1024, label: '视频 · 200MB', icon: 'camera' },
  { test: /^application\/pdf$/, maxSize: 20 * 1024 * 1024, label: 'PDF · 20MB', icon: 'file' },
  { test: /^application\/(zip|x-7z-compressed|x-rar-compressed)$/, maxSize: 50 * 1024 * 1024, label: '压缩包 · 50MB', icon: 'box' },
  { test: /^application\/postscript$|^image\/vnd\.adobe\.photoshop$/, maxSize: 50 * 1024 * 1024, label: '设计源文件 · 50MB', icon: 'file' },
];

const MAX_FILES = 6;
const DRAFT_KEY = 'nju-rc-submit-draft-v1';
const DRAFT_DEBOUNCE_MS = 800;

function ruleFor(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  return FILE_RULES.find((rule) => rule.test.test(value)) || null;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return draft && typeof draft === 'object' ? draft : null;
  } catch { return null; }
}

function saveDraft(fields) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...fields, savedAt: Date.now() })); } catch { /* storage full or blocked: drafts are best-effort */ }
}

export default async function submitPage(context) {
  const draft = loadDraft();
  const initialCategory = CATEGORIES.find((item) => item.value === (context?.query?.get('category') || draft?.category)) || CATEGORIES[0];
  let step = 1;
  let category = initialCategory.value;
  let signature = SIGNATURES.map((item) => item.value).includes(draft?.signature) ? draft.signature : SIGNATURES[0].value;

  const attachments = [];
  let attachmentConfig = { storageConfigured: false, maxFilesPerSubmission: MAX_FILES, maxUnboundPerAccount: 10, acceptedHint: '' };
  let localSeq = 0;

  const stepBar = h('div');
  const bodySlot = h('div', { class: 'stack-6' });
  const dockSlot = h('div');

  /* --- shared controls (steps 2–3) ------------------------------------- */

  const titleField = field({ label: '标题', name: 'title', required: true, placeholder: '一句话说明这篇内容是什么' });
  const contentField = field({
    label: '正文 / 作品说明',
    name: 'content',
    required: true,
    multiline: true,
    rows: 10,
    maxlength: 4000,
    placeholder: '请直接粘贴正文或写下作品说明。',
    hint: '最多 4000 字。',
  });
  const nameField = field({ label: '联系人', name: 'name', required: true, iconName: 'user' });
  const emailField = field({ label: '联系邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', placeholder: 'your_id@smail.nju.edu.cn' });

  const counter = h('p', { class: 't-caption t-faint', text: '0 / 4000' });
  contentField.control.addEventListener('input', () => {
    counter.textContent = `${contentField.control.value.length} / 4000`;
    scheduleDraft();
  });
  titleField.control.addEventListener('input', scheduleDraft);
  nameField.control.addEventListener('input', scheduleDraft);
  emailField.control.addEventListener('input', scheduleDraft);

  if (draft) {
    titleField.control.value = draft.title || '';
    contentField.control.value = draft.content || '';
    nameField.control.value = draft.name || '';
    emailField.control.value = draft.email || '';
    counter.textContent = `${contentField.control.value.length} / 4000`;
  }

  let draftTimer = null;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft({
      category, signature,
      title: titleField.control.value,
      content: contentField.control.value,
      name: nameField.control.value,
      email: emailField.control.value,
    }), DRAFT_DEBOUNCE_MS);
  }

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
      scheduleDraft();
    },
  });
  const signatureNote = h('p', { class: 't-caption', text: '对外发布时会使用你在下方填写的联系人姓名。' });

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

  const submitButton = button({ label: '提交投稿', variant: 'primary', iconName: 'send', onClick: () => submit() });

  /* --- attachment area --------------------------------------------------- */

  const fileInput = h('input', { class: 'sr-only', attrs: { type: 'file', multiple: '' } });
  const dropzone = h('button', {
    class: 'dropzone',
    attrs: { type: 'button' },
    on: { click: () => fileInput.click() },
  },
  icon('upload', 'ico ico--lg'),
  h('span', { class: 'dropzone__title', text: '点击选择文件，或把文件拖到这里' }),
  h('span', { class: 'dropzone__hint', text: '图片 ≤20MB · 视频 ≤200MB · PDF ≤20MB · 压缩包/源文件 ≤50MB，最多 6 个' }));
  const filelist = h('div', { class: 'filelist' });
  const attachmentSlot = h('div', { class: 'stack-4' }, fileInput, dropzone, filelist);

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  for (const eventName of ['dragenter', 'dragover']) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('dropzone--drag');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dropzone--drag');
      if (eventName === 'drop' && event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
    });
  }

  function liveCount() {
    return attachments.filter((entry) => entry.status === 'uploading' || entry.status === 'uploaded' || entry.status === 'pending').length;
  }

  function renderFilelist() {
    clear(filelist);
    for (const entry of attachments) {
      const rule = ruleFor(entry.mimeType);
      const metaSlot = h('div', { class: 'filelist__meta' });
      metaSlot.append(h('span', { class: 'filelist__name', text: entry.filename }));
      if (entry.status === 'uploading') {
        const bar = h('div', { class: 'filelist__bar' }, h('div', { class: 'filelist__fill' }));
        setVars(bar.firstElementChild, { w: `${entry.progress}%` });
        metaSlot.append(bar, h('span', { class: 'filelist__sub t-faint', text: `${entry.progress}% · 上传中` }));
      } else if (entry.status === 'error') {
        metaSlot.append(h('span', { class: 'filelist__sub filelist__sub--error', text: entry.error || '上传失败' }));
      } else if (entry.status === 'pending') {
        metaSlot.append(h('span', { class: 'filelist__sub t-faint', text: '尚未上传（刷新页面找回了这个空槽位）' }));
      } else {
        metaSlot.append(h('span', { class: 'filelist__sub t-faint', text: `${fmt.bytes(entry.size)} · 已上传` }));
      }
      const row = h('div', { class: 'filelist__row', data: { status: entry.status } },
        h('span', { class: 'filelist__icon' }, icon(rule?.icon || 'file', 'ico')),
        metaSlot);
      if (entry.status === 'error') {
        row.append(
          iconButton({ iconName: 'refresh', label: '重试上传', onClick: () => retryEntry(entry) }),
          iconButton({ iconName: 'trash', label: '移除', onClick: () => removeEntry(entry) }),
        );
      } else if (entry.status === 'uploaded' || entry.status === 'pending') {
        row.append(iconButton({ iconName: 'trash', label: '删除附件', onClick: () => removeEntry(entry) }));
      }
      filelist.append(row);
    }
    renderDock();
  }

  async function addFiles(fileList) {
    for (const file of Array.from(fileList || [])) {
      if (liveCount() >= MAX_FILES) {
        notify.warning('附件数量已达上限', `每篇投稿最多 ${MAX_FILES} 个附件。`);
        break;
      }
      const rule = ruleFor(file.type);
      if (!rule) {
        notify.warning('已跳过一个文件', `${file.name}：暂不支持该类型，支持 ${attachmentConfig.acceptedHint || '图片/视频/PDF/压缩包'}。`);
        continue;
      }
      if (file.size > rule.maxSize) {
        notify.warning('已跳过一个文件', `${file.name}：超过上限（${rule.label}）。`);
        continue;
      }
      const entry = { localId: ++localSeq, attachmentId: '', filename: file.name, mimeType: file.type, size: file.size, status: 'uploading', progress: 0, error: '', file };
      attachments.push(entry);
      renderFilelist();
      try {
        const slot = await publicApi.attachmentSlot({ filename: file.name, mimeType: file.type, size: file.size });
        entry.attachmentId = slot.attachment.id;
        renderFilelist();
        await uploadAttachment(entry.attachmentId, file, {
          onProgress: (progress) => {
            entry.progress = progress;
            renderFilelist();
          },
        });
        entry.status = 'uploaded';
        entry.progress = 100;
        renderFilelist();
      } catch (error) {
        if (redirectIfAuthError(error)) return;
        entry.status = 'error';
        entry.error = error?.message || '上传失败，请重试。';
        renderFilelist();
      }
    }
  }

  async function retryEntry(entry) {
    if (!entry.file || !entry.attachmentId) {
      entry.error = '本地文件已不可用，请重新添加。';
      renderFilelist();
      return;
    }
    entry.status = 'uploading';
    entry.progress = 0;
    entry.error = '';
    renderFilelist();
    try {
      await uploadAttachment(entry.attachmentId, entry.file, {
        onProgress: (progress) => {
          entry.progress = progress;
          renderFilelist();
        },
      });
      entry.status = 'uploaded';
      entry.progress = 100;
    } catch (error) {
      entry.status = 'error';
      entry.error = error?.message || '上传失败，请重试。';
    }
    renderFilelist();
  }

  async function removeEntry(entry) {
    const finish = () => {
      const index = attachments.indexOf(entry);
      if (index >= 0) attachments.splice(index, 1);
      renderFilelist();
    };
    if (entry.attachmentId) {
      try {
        await publicApi.attachmentDelete(entry.attachmentId);
      } catch (error) {
        if (redirectIfAuthError(error)) return;
        if (error instanceof ApiError && error.status !== 404) {
          notify.warning('附件暂未删除', error.message);
          return;
        }
      }
    }
    finish();
  }

  /* --- steps ------------------------------------------------------------ */

  function renderStep() {
    clear(stepBar);
    stepBar.append(h('div', { class: 'submit-steps', attrs: { role: 'group', 'aria-label': '投稿进度' } },
      steps(['选择类型', '填写内容', '附件与提交'], step - 1)));
    clear(bodySlot);
    clear(dockSlot);
    if (!isSignedIn()) {
      stepBar.replaceChildren();
      bodySlot.append(loginRequiredPanel({ what: '投稿', hint: '投稿的审核结论会回到你的账号，不必再翻邮箱。' }));
      return;
    }
    if (step === 1) renderCategoryStep();
    if (step === 2) renderContentStep();
    if (step === 3) renderFinalStep();
  }

  function goToStep(next) {
    step = next;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderCategoryStep() {
    const cards = CATEGORIES.map((item) => {
      const input = h('input', {
        class: 'sr-only',
        attrs: { type: 'radio', name: 'submit-category', value: item.value },
      });
      input.checked = item.value === category;
      input.addEventListener('change', () => {
        category = item.value;
        for (const card of cards) card.classList.toggle('typecard--selected', card.querySelector('input').checked);
        scheduleDraft();
      });
      const card = h('label', { class: `typecard${item.value === category ? ' typecard--selected' : ''}` },
        input,
        h('span', { class: 'typecard__icon' }, icon(item.icon, 'ico ico--lg')),
        h('span', { class: 'typecard__body' },
          h('span', { class: 'typecard__label', text: item.label }),
          h('span', { class: 'typecard__hint', text: item.hint })));
      return card;
    });
    bodySlot.append(
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: '这次要投的是什么？' }),
        h('div', { class: 'typegrid', attrs: { role: 'radiogroup', 'aria-label': '投稿类型' } }, cards),
        h('p', { class: 't-caption t-muted', text: CATEGORIES.find((item) => item.value === category)?.brief || '' })),
      h('div', { class: 'row-3' }, h('span', { class: 'spacer' }),
        button({ label: '下一步 · 填写内容', variant: 'primary', iconName: 'arrowRight', onClick: () => goToStep(2) })),
    );
  }

  function renderContentStep() {
    const categoryItem = CATEGORIES.find((item) => item.value === category) || CATEGORIES[0];
    contentField.control.setAttribute('placeholder',
      categoryItem.value === '影像作品' ? '请写明拍摄背景与内容说明；作品文件在下一步上传，也可把相册链接贴在这里。'
        : categoryItem.value === '文创设计' ? '请说明设计理念与使用场景；源文件在下一步上传。'
          : categoryItem.value === '课程反馈' ? '请写明课程名称、学期与具体的改进建议。'
            : '请直接粘贴正文全文，编辑会保留段落结构进入审核。');
    bodySlot.append(
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: `${categoryItem.label} · 填写内容` }),
        h('p', { class: 't-caption t-muted', text: categoryItem.brief }),
        titleField,
        contentField,
        h('div', { class: 'row-between' }, h('span', { class: 't-caption t-faint', text: '正文会原样进入审核队列' }), counter)),
      h('div', { class: 'row-3' },
        button({ label: '上一步', variant: 'ghost', iconName: 'chevronLeft', onClick: () => goToStep(1) }),
        h('span', { class: 'spacer' }),
        button({
          label: '下一步 · 附件与提交', variant: 'primary', iconName: 'arrowRight',
          onClick: () => {
            if (titleField.control.value.trim() && contentField.control.value.trim().length >= 20) {
              goToStep(3);
              return;
            }
            if (!titleField.control.value.trim()) titleField.setError('请填写标题');
            if (contentField.control.value.trim().length < 20) contentField.setError('正文至少 20 个字，便于审核判断');
            shake(!titleField.control.value.trim() ? titleField : contentField);
          },
        })),
    );
  }

  function renderFinalStep() {
    const uploadArea = attachmentConfig.storageConfigured
      ? attachmentSlot
      : notice('文件直传暂未开放，请把作品链接（校内网盘、相册分享）写在正文中；链接与直接上传的审核时效一致。', { tone: 'info', iconName: 'link' });
    if (!attachmentConfig.storageConfigured) attachmentSlot.remove();
    bodySlot.append(
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: '附件' }),
        h('p', { class: 't-caption t-muted', text: '先上传、后提交：附件在本页就完成了存储，提交投稿时一并绑定。刷新页面不会丢失已上传的文件。' }),
        uploadArea),
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: '署名方式' }),
        signatureControl,
        signatureNote),
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: '联系方式' }),
        h('p', { class: 't-caption t-muted', text: '仅用于审核沟通，不会公开展示。' }),
        h('div', { class: 'formgrid' }, nameField, emailField)),
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: '授权确认' }),
        originalConfirm, portraitConfirm, consent),
    );
    renderDock();
  }

  function renderDock() {
    if (step !== 3) return;
    const ready = attachments.filter((entry) => entry.status === 'uploaded');
    const uploading = attachments.some((entry) => entry.status === 'uploading');
    const categoryItem = CATEGORIES.find((item) => item.value === category) || CATEGORIES[0];
    clear(dockSlot);
    dockSlot.append(h('div', { class: 'submit-dock' },
      h('div', { class: 'submit-dock__summary' },
        h('span', { class: 'submit-dock__chip', text: categoryItem.label }),
        h('span', { class: 'submit-dock__title', text: titleField.control.value.trim() || '（标题待填）' }),
        h('span', { class: 't-caption t-faint', text: ready.length ? `${ready.length} 个附件已就绪` : '无附件' })),
      h('div', { class: 'submit-dock__actions' },
        button({ label: '上一步', variant: 'ghost', iconName: 'chevronLeft', onClick: () => goToStep(2) }),
        submitButton)));
    submitButton.disabled = uploading;
    submitButton.title = uploading ? '附件上传完成后即可提交' : '';
  }

  /* --- submit ----------------------------------------------------------- */

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
    if (attachments.some((entry) => entry.status === 'uploading')) {
      notify.warning('附件还在上传', '请等附件全部完成后再提交。');
      return;
    }
    const failed = attachments.filter((entry) => entry.status === 'error');
    if (failed.length) {
      notify.warning('有附件未上传成功', '请移除失败的附件或点击重试，再提交投稿。');
      return;
    }
    const attachmentIds = attachments.filter((entry) => entry.status === 'uploaded').map((entry) => entry.attachmentId);
    if (attachmentIds.length > MAX_FILES) {
      notify.warning('附件数量超过上限', `每篇投稿最多 ${MAX_FILES} 个附件。`);
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
          attachmentIds,
        }),
      );
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* best-effort */ }
      notify.success('投稿已提交', payload.message);
      clear(bodySlot);
      stepBar.replaceChildren();
      dockSlot.replaceChildren();
      clear(formSlot);
      formSlot.append(
        receipt({
          title: '投稿已进入人工审核队列',
          rows: [
            ['投稿编号', payload.submission.id],
            ['标题', payload.submission.title],
            ['当前状态', payload.submission.status],
            ['附件', payload.submission.attachmentCount ? `${payload.submission.attachmentCount} 个` : '无'],
            ['提交时间', payload.submission.submittedAt],
          ],
        }),
        h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.submission.id, { label: '复制投稿编号' }), h('span', { class: 't-caption', text: '审核结果会发送到你的联系邮箱。' })),
        notice('审核通过的内容会进入排期，由运营同学确认后再对外发布；被退回修改时你会收到具体意见。', { tone: 'info' }),
        h('div', { class: 'row-3' }, button({ label: '再投一篇', variant: 'secondary', iconName: 'plus', onClick: () => resetForm() }), button({ label: '返回首页', variant: 'ghost', href: '/' })),
      );
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && (error.status === 400 || error.isRateLimited || error.status === 409 || error.status === 403)) {
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
    attachments.length = 0;
    renderFilelist();
    step = 1;
    renderStep();
  }

  const formSlot = h('div', { class: 'stack-6' }, bodySlot, dockSlot);

  const node = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'formpage' },
      h(
        'header',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/outreach' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回宣传广场' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '宣传广场 · 投稿' }), badge('人工审核', { tone: 'accent', iconName: 'shield' })),
        h('h1', { class: 't-h1', text: '把你的记录与创作交给我们' }),
        h('p', { class: 't-prose', text: '活动通讯、现场摄影、文创设计与课程反馈都欢迎投递。你可以选择实名、笔名或对外匿名；无论哪一种，管理员都能追溯来源以便沟通，而对外发布严格按你选择的署名方式执行。' }),
      ),
      stepBar,
      formSlot,
    ),
  );

  renderStep();

  if (isSignedIn()) {
    // 恢复服务端真值：已上传的附件与上传区开关状态。失败时静默——
    // 上传区按「未开放」的保守默认渲染，投稿流程不受影响。
    publicApi.myAttachments()
      .then((payload) => {
        attachmentConfig = { ...attachmentConfig, ...payload.config };
        for (const remote of payload.attachments || []) {
          if (attachments.some((entry) => entry.attachmentId === remote.id)) continue;
          if (remote.status === '已上传') {
            attachments.push({ localId: ++localSeq, attachmentId: remote.id, filename: remote.filename, mimeType: remote.mimeType, size: remote.size, status: 'uploaded', progress: 100, error: '', file: null });
          } else if (remote.status === '待上传') {
            attachments.push({ localId: ++localSeq, attachmentId: remote.id, filename: remote.filename, mimeType: remote.mimeType, size: remote.size, status: 'pending', progress: 0, error: '', file: null });
          }
        }
        renderStep();
      })
      .catch(() => {});
  }

  if (draft && (draft.title || draft.content) && isSignedIn()) {
    notify.info('已恢复上次编辑的草稿', '内容保存在本机浏览器，提交成功后自动清除。');
  }

  return { title: '内容投稿', node };
}
