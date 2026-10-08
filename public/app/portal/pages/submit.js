/* ==========================================================================
   portal/pages/submit.js
   Task: contribute content in a three-step workbench — pick a kind, write
   the piece, then attach files and submit. v2 splits submissions into two
   strict tracks that share one table:
     · 文字稿件 (article) — real-name only: name and student id are bound
       to the signed-in identity record and cannot be edited here.
     · 文创设计 (design) — pen-name only: displayed publicly under the pen
       name; real-name and payroll fields are never written.
   Attachments relay through this origin to NJU Box, so the CSP stays
   connect-src 'self'. 影像作品走独立的 /photos 页面；课程反馈已移除。
   ========================================================================== */

import { h, icon, clear, setVars } from '../../core/dom.js';
import { publicApi, uploadAttachment, ApiError } from '../../core/api.js';
import { getSessionState } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, checkbox, notice, receipt, copyableCode, runWithLoading, badge, iconButton, steps } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';

const KINDS = [
  {
    value: 'article', label: '文字稿件', hint: '活动通讯、人物专访、科普短文', icon: 'edit',
    brief: '实名投稿，与劳务费结算绑定：署名固定为实名，学号与联系方式由统一身份认证自动带出，不可修改。',
    tag: '实名 · 绑定劳务费', tone: 'accent',
  },
  {
    value: 'design', label: '文创设计', hint: '海报、徽章、贴纸、卡牌、表情包', icon: 'sparkle',
    brief: '笔名投稿、对外匿名展示：不绑定实名与薪酬信息。默认以你填写的笔名公开展示；美编对接后再补充作品标题。',
    tag: '笔名 · 对外匿名', tone: 'neutral',
  },
];

/** 文创类别：兼容历史 UNO 卡牌投稿模式（卡牌）。 */
const DESIGN_CATEGORIES = ['徽章', '贴纸', '卡牌', '表情包', '海报', '文创周边', '其他'];

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
const DRAFT_KEY = 'nju-rc-submit-draft-v2';
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
  const session = getSessionState();
  const user = session?.user || {};
  const draft = loadDraft();
  const initialKind = KINDS.find((item) => item.value === (context?.query?.get('kind') || draft?.kind)) || KINDS[0];
  let step = 1;
  let kind = initialKind.value;

  const attachments = [];
  let attachmentConfig = { storageConfigured: false, maxFilesPerSubmission: MAX_FILES, maxUnboundPerAccount: 10, acceptedHint: '' };
  let localSeq = 0;

  const stepBar = h('div');
  const bodySlot = h('div', { class: 'stack-6' });
  const dockSlot = h('div');

  /* --- shared controls --------------------------------------------------- */

  const titleField = field({
    label: '稿件标题', name: 'title', required: true,
    placeholder: '一句话说明这篇稿件是什么',
  });
  const designTitleField = field({
    label: '文创名称', name: 'designTitle', required: true,
    placeholder: '例如：红十字急救徽章·二代',
  });
  const designCategoryField = field({
    label: '文创类别', name: 'designCategory', required: true,
    options: DESIGN_CATEGORIES.map((name) => ({ value: name, label: name })),
    hint: '选择最接近的类别；卡牌类沿用历史 UNO 卡牌投稿口径。',
  });
  const contentField = field({
    label: '正文', name: 'content', required: true, multiline: true, rows: 10, maxlength: 4000,
    placeholder: '请直接粘贴正文全文，编辑会保留段落结构进入审核。',
    hint: '最多 4000 字。',
  });
  const designContentField = field({
    label: '作品简介', name: 'designContent', required: true, multiline: true, rows: 8, maxlength: 4000,
    placeholder: '设计理念、使用场景、希望传达的信息。',
    hint: '最多 4000 字，至少 20 字。',
  });
  const penNameField = field({
    label: '展示笔名', name: 'penName', required: true, maxlength: 40,
    placeholder: '对外展示使用的笔名（不出现真实姓名）',
    hint: '审核通过后，作品将以这个笔名对外展示。',
  });
  const emailField = field({
    label: '联系邮箱', name: 'email', type: 'email', required: true, iconName: 'mail',
    placeholder: 'your_id@smail.nju.edu.cn',
    hint: '默认带出账号邮箱，可改为你的其他校内邮箱。',
  });

  const counter = h('p', { class: 't-caption t-faint', text: '0 / 4000' });
  const designCounter = h('p', { class: 't-caption t-faint', text: '0 / 4000' });
  contentField.control.addEventListener('input', () => {
    counter.textContent = `${contentField.control.value.length} / 4000`;
    scheduleDraft();
  });
  designContentField.control.addEventListener('input', () => {
    designCounter.textContent = `${designContentField.control.value.length} / 4000`;
    scheduleDraft();
  });
  for (const control of [titleField, designTitleField, designCategoryField, penNameField, emailField]) {
    control.control.addEventListener('input', scheduleDraft);
    control.control.addEventListener('change', scheduleDraft);
  }

  if (draft) {
    titleField.control.value = draft.title || '';
    contentField.control.value = draft.content || '';
    designTitleField.control.value = draft.designTitle || '';
    designCategoryField.control.value = draft.designCategory || '';
    designContentField.control.value = draft.designContent || '';
    penNameField.control.value = draft.penName || '';
    counter.textContent = `${contentField.control.value.length} / 4000`;
    designCounter.textContent = `${designContentField.control.value.length} / 4000`;
  }
  if (user.email && !draft?.email) emailField.control.value = user.email;
  else if (draft?.email) emailField.control.value = draft.email;

  let draftTimer = null;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft({
      kind,
      title: titleField.control.value,
      content: contentField.control.value,
      designTitle: designTitleField.control.value,
      designCategory: designCategoryField.control.value,
      designContent: designContentField.control.value,
      penName: penNameField.control.value,
      email: emailField.control.value,
    }), DRAFT_DEBOUNCE_MS);
  }

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
  const designConsent = checkbox({
    name: 'designConsent',
    label: '同意作品以笔名对外匿名展示',
    description: '文创作品不绑定实名与薪酬信息；展示、获奖或后续制作对接时均以笔名沟通。',
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
    if (step === 1) renderKindStep();
    if (step === 2) renderContentStep();
    if (step === 3) renderFinalStep();
  }

  function goToStep(next) {
    step = next;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderKindStep() {
    const cards = KINDS.map((item) => {
      const input = h('input', {
        class: 'sr-only',
        attrs: { type: 'radio', name: 'submit-kind', value: item.value },
      });
      input.checked = item.value === kind;
      input.addEventListener('change', () => {
        kind = item.value;
        for (const card of cards) card.classList.toggle('typecard--selected', card.querySelector('input').checked);
        scheduleDraft();
      });
      const card = h('label', { class: `typecard${item.value === kind ? ' typecard--selected' : ''}` },
        input,
        h('span', { class: 'typecard__icon' }, icon(item.icon, 'ico ico--lg')),
        h('span', { class: 'typecard__body' },
          h('span', { class: 'typecard__label', text: item.label }),
          h('span', { class: 'typecard__hint', text: item.hint })),
        h('span', { class: 'typecard__tag' }, badge(item.tag, { tone: item.tone, iconName: item.value === 'article' ? 'user' : 'sparkle' })));
      return card;
    });
    bodySlot.append(
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: '这次要投的是什么？' }),
        h('div', { class: 'typegrid', attrs: { role: 'radiogroup', 'aria-label': '投稿类型' } }, cards),
        h('p', { class: 't-caption t-muted', text: KINDS.find((item) => item.value === kind)?.brief || '' })),
      h('div', { class: 'row-3' }, h('span', { class: 'spacer' }),
        button({ label: '下一步 · 填写内容', variant: 'primary', iconName: 'arrowRight', onClick: () => goToStep(2) })),
    );
  }

  function renderContentStep() {
    const kindItem = KINDS.find((item) => item.value === kind) || KINDS[0];
    if (kind === 'design') {
      bodySlot.append(
        h('div', { class: 'stack-5' },
          h('h2', { class: 't-h3', text: '文创设计 · 填写内容' }),
          h('p', { class: 't-caption t-muted', text: '作品以笔名对外匿名展示，不绑定实名与薪酬信息；源文件（PSD/AI/PDF/压缩包）在下一步上传。' }),
          designCategoryField,
          designTitleField,
          designContentField,
          h('div', { class: 'row-between' }, h('span', { class: 't-caption t-faint', text: '简介会原样进入审核队列' }), designCounter)),
        h('div', { class: 'row-3' },
          button({ label: '上一步', variant: 'ghost', iconName: 'chevronLeft', onClick: () => goToStep(1) }),
          h('span', { class: 'spacer' }),
          button({
            label: '下一步 · 附件与提交', variant: 'primary', iconName: 'arrowRight',
            onClick: () => {
              let invalid = null;
              if (!designTitleField.control.value.trim()) { designTitleField.setError('请填写文创名称'); invalid = invalid || designTitleField; }
              if (!designCategoryField.control.value) { designCategoryField.setError('请选择文创类别'); invalid = invalid || designCategoryField; }
              if (designContentField.control.value.trim().length < 20) { designContentField.setError('作品简介至少 20 个字'); invalid = invalid || designContentField; }
              if (invalid) { shake(invalid); invalid.control.focus(); return; }
              goToStep(3);
            },
          })),
      );
      return;
    }
    bodySlot.append(
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: '文字稿件 · 填写内容' }),
        h('p', { class: 't-caption t-muted', text: '实名投稿：姓名与学号由统一身份认证自动绑定，提交后不可修改。' }),
        h('div', { class: 'identity-card', attrs: { role: 'group', 'aria-label': '实名信息（自动绑定）' } },
          h('div', { class: 'identity-card__row' },
            h('span', { class: 't-caption t-muted', text: '姓名（实名，不可修改）' }),
            h('span', { class: 't-body', text: user.realName || '（账号未绑定实名）' })),
          h('div', { class: 'identity-card__row' },
            h('span', { class: 't-caption t-muted', text: '学号（自动回填）' }),
            h('span', { class: 't-body', text: user.studentId || '（账号缺少学号）' }))),
        !user.realName || !user.studentId
          ? notice('当前账号缺少实名或学号信息，无法提交文字稿件。请联系管理员在身份库中补全后再来投稿；文创设计投稿不受影响。', { tone: 'warning', iconName: 'shield' })
          : null,
        titleField,
        contentField,
        h('div', { class: 'row-between' }, h('span', { class: 't-caption t-faint', text: '正文会原样进入审核队列' }), counter)),
      h('div', { class: 'row-3' },
        button({ label: '上一步', variant: 'ghost', iconName: 'chevronLeft', onClick: () => goToStep(1) }),
        h('span', { class: 'spacer' }),
        button({
          label: '下一步 · 附件与提交', variant: 'primary', iconName: 'arrowRight',
          onClick: () => {
            let invalid = null;
            if (!titleField.control.value.trim()) { titleField.setError('请填写标题'); invalid = titleField; }
            if (contentField.control.value.trim().length < 20) { contentField.setError('正文至少 20 个字，便于审核判断'); invalid = invalid || contentField; }
            if (invalid) { shake(invalid); invalid.control.focus(); return; }
            goToStep(3);
          },
        })),
    );
  }

  function renderFinalStep() {
    const kindItem = KINDS.find((item) => item.value === kind) || KINDS[0];
    const uploadArea = attachmentConfig.storageConfigured
      ? attachmentSlot
      : notice('文件直传暂未开放，请把作品链接（校内网盘、相册分享）写在正文中；链接与直接上传的审核时效一致。', { tone: 'info', iconName: 'link' });
    if (!attachmentConfig.storageConfigured) attachmentSlot.remove();
    bodySlot.append(
      h('div', { class: 'stack-5' },
        h('h2', { class: 't-h3', text: kind === 'design' ? '原始源文件' : '附件' }),
        h('p', { class: 't-caption t-muted', text: kind === 'design'
          ? '上传设计源文件（PSD/AI/PDF/图片/压缩包）。先上传、后提交：文件在本页就完成了存储，提交时一并绑定。'
          : '先上传、后提交：附件在本页就完成了存储，提交投稿时一并绑定。刷新页面不会丢失已上传的文件。' }),
        uploadArea),
    );
    if (kind === 'design') {
      bodySlot.append(
        h('div', { class: 'stack-5' },
          h('h2', { class: 't-h3', text: '署名（笔名 · 对外匿名）' }),
          h('p', { class: 't-caption t-muted', text: '作品公开展示时只出现这个笔名；平台不会在展示页出现你的实名、学号或联系方式。' }),
          penNameField),
        h('div', { class: 'stack-5' },
          h('h2', { class: 't-h3', text: '授权确认' }),
          originalConfirm, portraitConfirm, designConsent),
      );
    } else {
      bodySlot.append(
        h('div', { class: 'stack-5' },
          h('h2', { class: 't-h3', text: '实名信息与联系方式' }),
          h('p', { class: 't-caption t-muted', text: '实名信息由统一身份认证绑定，不可修改；联系方式仅用于审核沟通与劳务费结算，不会公开展示。' }),
          h('div', { class: 'identity-card', attrs: { role: 'group', 'aria-label': '实名信息（自动绑定）' } },
            h('div', { class: 'identity-card__row' },
              h('span', { class: 't-caption t-muted', text: '姓名' }),
              h('span', { class: 't-body', text: user.realName || '—' })),
            h('div', { class: 'identity-card__row' },
              h('span', { class: 't-caption t-muted', text: '学号' }),
              h('span', { class: 't-body', text: user.studentId || '—' }))),
          emailField),
        h('div', { class: 'stack-5' },
          h('h2', { class: 't-h3', text: '授权确认' }),
          originalConfirm, portraitConfirm, consent),
      );
    }
    renderDock();
  }

  function renderDock() {
    if (step !== 3) return;
    const ready = attachments.filter((entry) => entry.status === 'uploaded');
    const uploading = attachments.some((entry) => entry.status === 'uploading');
    const kindItem = KINDS.find((item) => item.value === kind) || KINDS[0];
    clear(dockSlot);
    dockSlot.append(h('div', { class: 'submit-dock' },
      h('div', { class: 'submit-dock__summary' },
        h('span', { class: 'submit-dock__chip', text: kindItem.label }),
        h('span', { class: 'submit-dock__title', text: (kind === 'design' ? designTitleField : titleField).control.value.trim() || '（标题待填）' }),
        h('span', { class: 't-caption t-faint', text: ready.length ? `${ready.length} 个附件已就绪` : '无附件' })),
      h('div', { class: 'submit-dock__actions' },
        button({ label: '上一步', variant: 'ghost', iconName: 'chevronLeft', onClick: () => goToStep(2) }),
        submitButton)));
    submitButton.disabled = uploading;
    submitButton.title = uploading ? '附件上传完成后即可提交' : '';
  }

  /* --- submit ----------------------------------------------------------- */

  async function submit() {
    const isDesign = kind === 'design';
    const activeTitle = isDesign ? designTitleField : titleField;
    const activeContent = isDesign ? designContentField : contentField;
    for (const control of [activeTitle, activeContent, emailField, penNameField]) control.setError(null);
    let invalid = null;
    if (!activeTitle.control.value.trim()) {
      activeTitle.setError(isDesign ? '请填写文创名称' : '请填写标题');
      invalid = activeTitle;
    }
    if (activeContent.control.value.trim().length < 20) {
      activeContent.setError(isDesign ? '作品简介至少 20 个字' : '正文至少 20 个字，便于审核判断');
      invalid = invalid || activeContent;
    }
    if (isDesign && !penNameField.control.value.trim()) {
      penNameField.setError('请填写展示笔名');
      invalid = invalid || penNameField;
    }
    if (!isDesign && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.control.value.trim())) {
      emailField.setError('请填写有效的邮箱地址');
      invalid = invalid || emailField;
    }
    if (invalid) {
      shake(invalid);
      invalid.control.focus();
      return;
    }
    const consentBox = isDesign ? designConsent : consent;
    if (!originalConfirm.control.checked || !consentBox.control.checked) {
      shake(originalConfirm.control.checked ? consentBox : originalConfirm);
      notify.warning('还需要两项确认', '请确认原创/授权声明与展示或使用范围。');
      return;
    }
    if (!isDesign && (!user.realName || !user.studentId)) {
      notify.warning('账号实名信息不完整', '缺少姓名或学号，无法提交实名稿件。请先联系管理员补全身份信息。');
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

    const shared = {
      title: activeTitle.control.value.trim(),
      content: activeContent.control.value.trim(),
      originalConfirm: true,
      portraitConfirm: portraitConfirm.control.checked,
      consent: true,
      attachmentIds,
    };
    const payload = { submission: null, message: '' };
    try {
      const result = await runWithLoading(submitButton, () => isDesign
        ? publicApi.submissionDesign({
          ...shared,
          designCategory: designCategoryField.control.value,
          penName: penNameField.control.value.trim(),
        })
        : publicApi.submissionArticle({
          ...shared,
          email: emailField.control.value.trim(),
        }));
      payload.submission = result.submission;
      payload.message = result.message;
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* best-effort */ }
      notify.success('投稿已提交', payload.message);
      clear(bodySlot);
      stepBar.replaceChildren();
      dockSlot.replaceChildren();
      clear(formSlot);
      formSlot.append(
        receipt({
          title: isDesign ? '文创作品已进入人工审核队列' : '投稿已进入人工审核队列',
          rows: [
            ['投稿编号', payload.submission.id],
            [isDesign ? '文创名称' : '标题', payload.submission.title],
            ['当前状态', payload.submission.status],
            ['附件', payload.submission.attachmentCount ? `${payload.submission.attachmentCount} 个` : '无'],
            [isDesign ? '展示笔名' : '署名', isDesign ? penNameField.control.value.trim() : '实名署名'],
            ['提交时间', payload.submission.submittedAt],
          ],
        }),
        h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.submission.id, { label: '复制投稿编号' }),
          h('span', { class: 't-caption', text: isDesign ? '审核结果会以笔名与你沟通。' : '审核结果会发送到你的联系邮箱。' })),
        notice(isDesign
          ? '审核通过后作品将以笔名进入展示排期；需要对接美编或补充作品标题时，运营会通过平台联系你。'
          : '审核通过的内容会进入排期，由运营同学确认后再对外发布；被退回修改时你会收到具体意见。', { tone: 'info' }),
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
    designTitleField.control.value = '';
    designContentField.control.value = '';
    designCounter.textContent = '0 / 4000';
    penNameField.control.value = '';
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
        h('p', { class: 't-prose', text: '文字稿件实名投稿、绑定劳务费；文创设计以笔名对外匿名展示。活动照片请前往影像库上传，那里支持按活动归档与批量整理。' }),
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

  if (draft && (draft.title || draft.content || draft.designTitle || draft.designContent) && isSignedIn()) {
    notify.info('已恢复上次编辑的草稿', '内容保存在本机浏览器，提交成功后自动清除。');
  }

  return { title: '内容投稿', node };
}
