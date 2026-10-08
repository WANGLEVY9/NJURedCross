/* ==========================================================================
   portal/pages/photos.js
   Task: the media library (影像模块). Photos are filed under an activity
   chosen from the events square — each activity gets its own NJU Box
   folder (/影像素材/<活动名>/) — and tracked in 影像素材表. Supports
   upload, grid preview, activity/keep filters, lightbox view, download,
   keep/drop, delete and batch auto-rename (<活动>_<NNN>.<ext>).
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, mediaUpload, ApiError } from '../../core/api.js';
import { button, field, notice, badge, iconButton, chip, segmented } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';

const KEEP_FILTERS = [
  { value: 'all', label: '全部' },
  { value: '待定', label: '待定' },
  { value: '留用', label: '留用' },
  { value: '弃用', label: '弃用' },
];

const MAX_BATCH = 12;
const IMAGE_MAX = 20 * 1024 * 1024;

export default async function photosPage() {
  const state = {
    activities: [],
    photos: [],
    filterActivity: '',
    filterKeep: 'all',
    selected: new Set(),
    uploading: false,
    uploadProgress: 0,
    config: { storageConfigured: false, maxPhotosPerBatch: MAX_BATCH, acceptedHint: '图片（单张 ≤20MB）' },
  };

  const headerSlot = h('div', { class: 'stack-3' });
  const controlsSlot = h('div', { class: 'stack-4' });
  const gridSlot = h('div', { class: 'stack-4' });
  const lightboxSlot = h('div');

  /* --- controls ---------------------------------------------------------- */

  const activitySelect = field({
    label: '归档活动', name: 'media-activity',
    options: [{ value: '', label: '（选择要上传到的活动）' }],
    hint: '活动名单来自活动广场（活动项目表）；每个活动在云盘里有独立文件夹。',
  });
  activitySelect.control.addEventListener('change', () => {
    state.filterActivity = activitySelect.control.value;
    renderGrid();
  });

  const keepControl = segmented({
    items: KEEP_FILTERS,
    value: 'all',
    ariaLabel: '留用状态筛选',
    onChange: (value) => {
      state.filterKeep = value;
      keepControl.setValue(value);
      renderGrid();
    },
  });

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
      activitySelect.control.replaceChildren(
        h('option', { value: '', text: '（选择要上传到的活动）' }),
        ...state.activities.map((item) => h('option', { value: item.name, text: item.name })));
    } catch (error) {
      reportError(error, '活动名单加载失败');
    }
  }

  async function loadPhotos() {
    try {
      const payload = await publicApi.myPhotos();
      state.photos = payload.photos || [];
      if (payload.config) state.config = { ...state.config, ...payload.config };
      renderControls();
      renderGrid();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      reportError(error, '照片列表加载失败');
    }
  }

  async function uploadFiles(fileList) {
    const activity = activitySelect.control.value;
    if (!activity) {
      notify.warning('先选择活动', '请先从下拉列表选择要把照片归档到哪个活动。');
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
        notify.success(`已上传 ${payload.photos.length} 张`, `照片已归档到「${activity}」的云盘文件夹。`);
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
    uploadHint.textContent = state.uploading ? `上传中 ${state.uploadProgress}% · 归档到「${activitySelect.control.value}」` : '';
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
          h('span', { class: 'photo-lightbox__name', text: `${photo.filename} · ${photo.activity}` }),
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
      renderGrid();
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
      state.photos = state.photos.filter((item) => item.id !== photo.id);
      state.selected.delete(photo.id);
      renderGrid();
      notify.success('已删除', photo.filename);
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('删除未生效', error?.message || '请稍后重试。');
    }
  }

  async function batchRename() {
    const targets = state.photos.filter((photo) => state.selected.has(photo.id));
    if (!targets.length) {
      notify.info('还没有选中照片', '点击照片卡片右上角的选择框，再批量更名。');
      return;
    }
    const activities = [...new Set(targets.map((photo) => photo.activity))];
    if (activities.length > 1) {
      notify.warning('一次只能整理一个活动', '当前选中照片跨多个活动，请按活动分开操作。');
      return;
    }
    if (!window.confirm(`将 ${targets.length} 张照片重命名为「${activities[0]}_001」起的顺序编号？此操作不可撤销。`)) return;
    try {
      const payload = await publicApi.mediaBatchRename(targets.map((photo) => photo.id));
      if (payload.renamed?.length) notify.success(`已更名 ${payload.renamed.length} 张`, `示例：${payload.renamed[0].oldName} → ${payload.renamed[0].newName}`);
      if (payload.failed?.length) notify.warning('部分未更名', payload.failed.map((item) => `${item.filename}：${item.reason}`).join('；'));
      state.selected.clear();
      await loadPhotos();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('批量更名未完成', error?.message || '请稍后重试。');
    }
  }

  /* --- render ------------------------------------------------------------ */

  function visiblePhotos() {
    return state.photos.filter((photo) =>
      (!state.filterActivity || photo.activity === state.filterActivity)
      && (state.filterKeep === 'all' || photo.keepStatus === state.filterKeep));
  }

  function renderControls() {
    clear(controlsSlot);
    controlsSlot.append(
      h('div', { class: 'stack-4' },
        activitySelect,
        state.config.storageConfigured
          ? h('div', { class: 'stack-3' }, dropzone, uploadBar, uploadHint, fileInput)
          : notice('云盘存储尚未配置，照片直传暂未开放。', { tone: 'info', iconName: 'info' })),
    );
  }

  function renderGrid() {
    clear(gridSlot);
    const visible = visiblePhotos();
    const toolbar = h('div', { class: 'row-3 row-wrap' },
      keepControl,
      h('span', { class: 't-caption t-faint', text: `${visible.length} 张 · 共 ${state.photos.length} 张` }),
      h('span', { class: 'spacer' }),
      renameButton);
    if (!state.photos.length) {
      gridSlot.append(toolbar, notice('还没有上传过照片。选择一个活动，把现场照片拖进上传区即可——每个活动在云盘里有独立文件夹，方便归档与查找。', { tone: 'info', iconName: 'camera' }));
      return;
    }
    if (!visible.length) {
      gridSlot.append(toolbar, notice('当前筛选条件下没有照片。', { tone: 'info', iconName: 'filter' }));
      return;
    }
    const cards = visible.map((photo) => {
      const check = h('input', {
        class: 'sr-only',
        attrs: { type: 'checkbox' },
      });
      check.checked = state.selected.has(photo.id);
      check.addEventListener('change', () => {
        if (check.checked) state.selected.add(photo.id);
        else state.selected.delete(photo.id);
        card.classList.toggle('photocard--selected', check.checked);
      });
      const keepBadge = badge(photo.keepStatus, {
        tone: photo.keepStatus === '留用' ? 'accent' : photo.keepStatus === '弃用' ? 'neutral' : 'info',
        iconName: photo.keepStatus === '留用' ? 'star' : 'clock',
      });
      const card = h('figure', { class: `photocard${state.selected.has(photo.id) ? ' photocard--selected' : ''}` },
        h('label', { class: 'photocard__check' }, check, icon('check', 'ico ico--sm')),
        h('button', {
          class: 'photocard__thumb',
          attrs: { type: 'button', 'aria-label': `查看 ${photo.filename}` },
          on: { click: () => openPhoto(photo) },
        }, icon('image', 'ico ico--lg'), h('span', { class: 'sr-only', text: '查看大图' })),
        h('figcaption', { class: 'photocard__body' },
          h('span', { class: 'photocard__name', attrs: { title: photo.filename }, text: photo.filename }),
          h('span', { class: 'photocard__meta t-caption t-faint', text: `${photo.activity} · ${fmt.bytes(photo.size)}` })),
        h('div', { class: 'photocard__actions' },
          keepBadge,
          h('span', { class: 'row-2' },
            iconButton({ iconName: photo.keepStatus === '留用' ? 'close' : 'star', label: photo.keepStatus === '留用' ? '标记弃用' : '标记留用', onClick: () => toggleKeep(photo) }),
            iconButton({ iconName: 'download', label: '下载', onClick: () => downloadPhoto(photo) }),
            iconButton({ iconName: 'trash', label: '删除', onClick: () => deletePhoto(photo) }))));
      return card;
    });
    gridSlot.append(toolbar, h('div', { class: 'photogrid' }, cards));
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
    h('p', { class: 't-prose', text: '选择活动广场里的活动名上传现场照片：每个活动在 NJU Box 有独立文件夹，文件不会丢。支持查看、下载、留用标记、删除与批量自动更名（活动名_序号）。' }),
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
