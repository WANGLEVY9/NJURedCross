/* ==========================================================================
   portal/pages/photos.js
   The media library (影像模块). Photos are filed under a fixed center
   (5 centers) and an activity folder carrying the photographer's real name:
     Box: /影像素材/<中心>/<活动名>_<摄影师实名>/<file>
   Activity names come from the events square as candidates, but manual entry
   is allowed. The photographer is forced server-side from the account's
   realName. The page shows the user's own photos as FOLDERS (one per
   center/activity), click a folder to see that activity's photos.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, mediaUpload, ApiError } from '../../core/api.js';
import { button, field, notice, badge, iconButton } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { getSessionState } from '../../core/store.js';

const MAX_BATCH = 12;
const IMAGE_MAX = 20 * 1024 * 1024;

export default async function photosPage() {
  const user = getSessionState()?.user || {};
  const state = {
    centers: [],
    activities: [],
    photos: [],
    folders: [],
    openFolderKey: '',   // 当前展开的文件夹（空=文件夹总览）
    uploading: false,
    uploadProgress: 0,
    config: { storageConfigured: false, maxPhotosPerBatch: MAX_BATCH, centers: [], acceptedHint: '图片（单张 ≤20MB）' },
  };

  const headerSlot = h('div', { class: 'stack-3' });
  const controlsSlot = h('div', { class: 'stack-4' });
  const gridSlot = h('div', { class: 'stack-4' });
  const lightboxSlot = h('div');

  /* --- upload controls --------------------------------------------------- */

  const centerSelect = field({
    label: '归档中心', name: 'media-center',
    options: [{ value: '', label: '（选择归档中心）' }],
    hint: '共 5 个中心；照片按「中心 / 活动」在云盘分文件夹归档。',
  });

  // 活动名：datalist 给活动广场候选，同时允许自由填写新活动名。
  const activityInput = h('input', {
    class: 'input', id: 'media-activity-input', name: 'media-activity',
    attrs: { type: 'text', list: 'media-activity-options', placeholder: '选择或填写活动名称，如「秋季急救员活动」', maxlength: '80', autocomplete: 'off' },
  });
  const activityList = h('datalist', { id: 'media-activity-options' });
  const activityField = h('div', { class: 'field' },
    h('label', { class: 'field__label', attrs: { for: 'media-activity-input' }, text: '活动名称' }),
    activityInput,
    h('p', { class: 'field__hint', text: '可从下拉候选（活动广场）中选，也可以直接输入新的活动名。' }),
    activityList);
  const photographerHint = h('p', { class: 'field__hint', text: `摄影师：${user.realName || '（账号未绑定实名，需先补全）'}（自动绑定账号实名，不可修改）` });

  const fileInput = h('input', { class: 'sr-only', attrs: { type: 'file', multiple: '', accept: 'image/*' } });
  const dropzone = h('button', {
    class: 'dropzone',
    attrs: { type: 'button' },
    on: { click: () => fileInput.click() },
  },
  icon('camera', 'ico ico--lg'),
  h('span', { class: 'dropzone__title', text: '点击选择照片，或把照片拖到这里' }),
  h('span', { class: 'dropzone__hint', text: `仅图片，单张 ≤20MB，一次最多 ${MAX_BATCH} 张` }));
  const uploadBar = h('div', { class: 'filelist__bar', attrs: { hidden: '' } }, h('div', { class: 'filelist__fill' }));
  const uploadHint = h('p', { class: 't-caption t-faint', attrs: { hidden: '' } });

  fileInput.addEventListener('change', () => {
    uploadFiles(fileInput.files);
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
      if (eventName === 'drop' && event.dataTransfer?.files?.length) uploadFiles(event.dataTransfer.files);
    });
  }

  const renameButton = button({
    label: '批量自动更名', variant: 'secondary', iconName: 'edit',
    onClick: () => batchRename(),
  });

  /* --- data -------------------------------------------------------------- */

  async function loadActivities() {
    try {
      const payload = await publicApi.mediaActivities();
      state.activities = payload.activities || [];
      state.centers = payload.centers?.length ? payload.centers : state.centers;
      if (payload.config?.centers?.length) state.centers = payload.config.centers;
      centerSelect.control.replaceChildren(
        h('option', { value: '', text: '（选择归档中心）' }),
        ...state.centers.map((name) => h('option', { value: name, text: name })));
      activityList.replaceChildren(...state.activities.map((item) => h('option', { value: item.name })));
    } catch (error) {
      reportError(error, '中心/活动名单加载失败');
    }
  }

  async function loadPhotos() {
    try {
      const payload = await publicApi.myPhotos();
      state.photos = payload.photos || [];
      state.folders = payload.folders || [];
      if (payload.config) state.config = { ...state.config, ...payload.config };
      if (payload.config?.centers?.length) state.centers = payload.config.centers;
      // 若展开的文件夹已被清空（照片全删），回到总览。
      if (state.openFolderKey && !state.folders.some((f) => f.key === state.openFolderKey)) state.openFolderKey = '';
      renderControls();
      renderGrid();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      reportError(error, '照片列表加载失败');
    }
  }

  async function uploadFiles(fileList) {
    const center = centerSelect.control.value;
    const activity = activityInput.value.trim();
    if (!center) {
      notify.warning('先选择归档中心', '请选择照片归入哪个中心（生命/博爱/综事/苏州/主席团）。');
      return;
    }
    if (!activity) {
      notify.warning('先填写活动名称', '请从下拉候选选择，或直接输入活动名称。');
      return;
    }
    if (!user.realName) {
      notify.warning('账号缺少实名', '上传照片需绑定摄影师实名，请先联系管理员补全账号实名。');
      return;
    }
    if (!state.config.storageConfigured) {
      notify.warning('照片直传暂未开放', '云盘存储尚未配置，请稍后再试或联系管理员。');
      return;
    }
    const files = Array.from(fileList || []).filter((file) => {
      if (!file.type.startsWith('image/')) {
        notify.warning('已跳过一个文件', `${file.name}：影像库只收图片。`);
        return false;
      }
      if (file.size > IMAGE_MAX) {
        notify.warning('已跳过一个文件', `${file.name}：超过单张 20MB 上限。`);
        return false;
      }
      return true;
    });
    if (!files.length) return;
    if (files.length > MAX_BATCH) {
      notify.warning('一次最多上传 ' + MAX_BATCH + ' 张', '超出部分请分批上传。');
      files.length = MAX_BATCH;
    }
    state.uploading = true;
    state.uploadProgress = 0;
    uploadBar.removeAttribute('hidden');
    uploadHint.removeAttribute('hidden');
    renderUploadState();
    try {
      const payload = await mediaUpload({
        center,
        activity,
        files,
        onProgress: (progress) => {
          state.uploadProgress = progress;
          renderUploadState();
        },
      });
      if (payload.failed?.length) {
        notify.warning('部分照片未上传成功', payload.failed.map((item) => `${item.filename}：${item.reason}`).join('；'));
      }
      if (payload.photos?.length) {
        notify.success(`已上传 ${payload.photos.length} 张`, `已归档到「${center} / ${activity}_${user.realName}」文件夹。`);
        // 上传后直接展开对应文件夹。
        state.openFolderKey = [center, activity, user.realName].join('\u0001');
      }
      await loadPhotos();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError) notify.warning('上传未完成', error.message);
      else reportError(error, '上传未完成');
    } finally {
      state.uploading = false;
      uploadBar.setAttribute('hidden', '');
      uploadHint.setAttribute('hidden', '');
    }
  }

  function renderUploadState() {
    uploadBar.firstElementChild.style.width = `${state.uploadProgress}%`;
    uploadHint.textContent = state.uploading ? `上传中 ${state.uploadProgress}% · 归档到「${centerSelect.control.value} / ${activityInput.value.trim()}」` : '';
  }

  async function openPhoto(photo) {
    clear(lightboxSlot);
    try {
      const payload = await publicApi.mediaLink(photo.id);
      lightboxSlot.append(h('div', {
        class: 'photo-lightbox',
        attrs: { role: 'dialog', 'aria-label': `查看 ${photo.filename}` },
        on: { click: (event) => { if (event.target === event.currentTarget) clear(lightboxSlot); } },
      },
      h('div', { class: 'photo-lightbox__panel' },
        h('img', { class: 'photo-lightbox__img', attrs: { src: payload.link, alt: photo.filename } }),
        h('div', { class: 'photo-lightbox__bar' },
          h('span', { class: 'photo-lightbox__name', text: `${photo.filename} · ${photo.center ? photo.center + ' / ' : ''}${photo.activity}` }),
          h('span', { class: 'row-2' },
            iconButton({ iconName: 'download', label: '下载', onClick: () => window.open(payload.link, '_blank', 'noopener') }),
            iconButton({ iconName: 'close', label: '关闭', onClick: () => clear(lightboxSlot) }))))));
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('照片暂时无法查看', error?.message || '云盘链接获取失败。');
    }
  }

  async function toggleKeep(photo) {
    const next = photo.keepStatus === '留用' ? '弃用' : '留用';
    try {
      await publicApi.mediaKeep(photo.id, next);
      photo.keepStatus = next;
      await loadPhotos();
      notify.info(next === '留用' ? '已标记留用' : '已标记弃用', photo.filename);
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('操作未生效', error?.message || '请稍后重试。');
    }
  }

  async function deletePhoto(photo) {
    if (!window.confirm(`确定删除「${photo.filename}」吗？云盘文件会一并删除，无法恢复。`)) return;
    try {
      await publicApi.mediaDelete(photo.id);
      notify.success('已删除', photo.filename);
      await loadPhotos();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('删除未生效', error?.message || '请稍后重试。');
    }
  }

  async function batchRename(folder) {
    const photos = folder.photos.map((p) => state.photos.find((s) => s.id === p.id)).filter(Boolean);
    if (!photos.length) {
      notify.info('文件夹里没有照片', '请先上传照片再批量更名。');
      return;
    }
    if (!window.confirm(`将「${folder.folderName}」里的 ${photos.length} 张照片重命名为「${folder.activity}_001」起的顺序编号？此操作不可撤销。`)) return;
    try {
      const payload = await publicApi.mediaBatchRename(photos.map((photo) => photo.id));
      if (payload.renamed?.length) notify.success(`已更名 ${payload.renamed.length} 张`, `示例：${payload.renamed[0].oldName} → ${payload.renamed[0].newName}`);
      if (payload.failed?.length) notify.warning('部分未更名', payload.failed.map((item) => `${item.filename}：${item.reason}`).join('；'));
      await loadPhotos();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('批量更名未完成', error?.message || '请稍后重试。');
    }
  }

  /* --- render ------------------------------------------------------------ */

  function renderControls() {
    clear(controlsSlot);
    controlsSlot.append(
      h('div', { class: 'stack-4' },
        h('div', { class: 'row-3 row-wrap' }, centerSelect, h('div', { class: 'stack-1' }, activityField), h('div', { class: 'stack-1' }, photographerHint)),
        state.config.storageConfigured
          ? h('div', { class: 'stack-3' }, dropzone, uploadBar, uploadHint, fileInput)
          : notice('云盘存储尚未配置，照片直传暂未开放。', { tone: 'info', iconName: 'info' })),
    );
  }

  /** 文件夹总览（要求4）：每个中心/活动一个文件夹卡片，点开查看该次活动的照片。 */
  function renderFolderOverview() {
    const cards = state.folders.map((folder) => h('button', {
      class: 'mediafolder',
      attrs: { type: 'button', 'aria-label': `打开文件夹 ${folder.folderName}，${folder.count} 张照片` },
      on: { click: () => { state.openFolderKey = folder.key; renderGrid(); } },
    },
    h('span', { class: 'mediafolder__icon' }, icon('box', 'ico ico--lg')),
    h('span', { class: 'mediafolder__body' },
      h('span', { class: 'mediafolder__name', text: folder.folderName }),
      h('span', { class: 'mediafolder__meta t-caption t-faint', text: `${folder.center} · ${folder.count} 张${folder.keepCount ? ` · 留用 ${folder.keepCount}` : ''}` })),
    icon('chevronRight', 'ico ico--sm')));

    gridSlot.append(
      h('div', { class: 'row-3 row-wrap' },
        h('span', { class: 't-caption t-faint', text: `${state.folders.length} 个文件夹 · 共 ${state.photos.length} 张照片` }),
        h('span', { class: 'spacer' })),
      h('div', { class: 'mediafolder-grid' }, cards));
  }

  /** 文件夹展开：显示该次活动的照片网格。 */
  function renderFolderDetail(folder) {
    const toolbar = h('div', { class: 'row-3 row-wrap' },
      button({ label: '返回文件夹', variant: 'ghost', iconName: 'chevronLeft', onClick: () => { state.openFolderKey = ''; renderGrid(); } }),
      h('span', { class: 't-body', text: `${folder.center} / ${folder.folderName}` }),
      h('span', { class: 'chip chip--static' }, h('span', { text: `${folder.count} 张` })),
      folder.keepCount ? h('span', { class: 'chip chip--static' }, h('span', { text: `留用 ${folder.keepCount}` })) : null,      h('span', { class: 'spacer' }),
      button({ label: '批量自动更名', variant: 'secondary', iconName: 'edit', onClick: () => batchRename(folder) }));

    const cards = folder.photos.map((photo) => photoCard(photo));
    gridSlot.append(toolbar, h('div', { class: 'photogrid' }, cards));
  }

  function photoCard(photo) {
    const keepBadge = badge(photo.keepStatus, {
      tone: photo.keepStatus === '留用' ? 'accent' : photo.keepStatus === '弃用' ? 'neutral' : 'info',
      iconName: photo.keepStatus === '留用' ? 'star' : 'clock',
    });
    return h('figure', { class: 'photocard' },
      h('button', {
        class: 'photocard__thumb',
        attrs: { type: 'button', 'aria-label': `查看 ${photo.filename}` },
        on: { click: () => openPhoto(photo) },
      }, icon('image', 'ico ico--lg'), h('span', { class: 'sr-only', text: '查看大图' })),
      h('figcaption', { class: 'photocard__body' },
        h('span', { class: 'photocard__name', attrs: { title: photo.filename }, text: photo.filename }),
        h('span', { class: 'photocard__meta t-caption t-faint', text: `${fmt.bytes(photo.size)}` })),
      h('div', { class: 'photocard__actions' },
        keepBadge,
        h('span', { class: 'row-2' },
          iconButton({ iconName: photo.keepStatus === '留用' ? 'close' : 'star', label: photo.keepStatus === '留用' ? '标记弃用' : '标记留用', onClick: () => toggleKeep(photo) }),
          iconButton({ iconName: 'download', label: '下载', onClick: () => downloadPhoto(photo) }),
          iconButton({ iconName: 'trash', label: '删除', onClick: () => deletePhoto(photo) }))));
  }

  function renderGrid() {
    clear(gridSlot);
    if (!state.photos.length) {
      gridSlot.append(notice('还没有上传过照片。选择归档中心、填写活动名，把现场照片拖进上传区即可——照片会按「中心 / 活动_摄影师」在云盘分文件夹归档。', { tone: 'info', iconName: 'camera' }));
      return;
    }
    const open = state.openFolderKey ? state.folders.find((f) => f.key === state.openFolderKey) : null;
    if (open) renderFolderDetail(open);
    else renderFolderOverview();
  }

  async function downloadPhoto(photo) {
    try {
      const payload = await publicApi.mediaLink(photo.id);
      window.open(payload.link, '_blank', 'noopener');
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('下载链接获取失败', error?.message || '请稍后重试。');
    }
  }

  /* --- mount ------------------------------------------------------------- */

  headerSlot.append(
    h('a', { class: 't-caption t-muted row-2', href: '/outreach' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回宣传广场' })),
    h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '宣传广场 · 影像库' }), badge('云盘归档', { tone: 'accent', iconName: 'camera' })),
    h('h1', { class: 't-h1', text: '活动影像库' }),
    h('p', { class: 't-prose', text: '选择归档中心与活动上传现场照片：照片按「中心 / 活动_摄影师实名」在 NJU Box 分文件夹归档，文件不会丢。下方以文件夹形式汇总你的每次活动，点开即可查看该次照片。' }),
  );

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' },
      headerSlot,
      isSignedIn() ? h('div', { class: 'stack-6' }, controlsSlot, gridSlot) : loginRequiredPanel({ what: '影像库', hint: '照片归档到你的账号下，换设备也能找回。' }),
      lightboxSlot),
  );

  if (isSignedIn()) {
    await loadActivities();
    await loadPhotos();
  }

  return { title: '影像库', node };
}
