/* ==========================================================================
   portal/pages/photos.js
   The media library (影像模块). Photos are filed under a fixed center
   (4 centers). v3.1 layout is three levels, department first:
     Box: /<部门>/<活动名>/<活动名>-照片/<file>
   Activity names come from the events square as candidates; since v3 item 16
   the activity select is read-only (manual entry rejected server-side).
   The photographer is forced server-side from the account's
   realName (stored as a table column, no longer part of the folder name).
   The page shows the user's own photos as FOLDERS (one per department+activity),
   click a folder to see that activity's photos.

   v3 N1 additions:
     - 精选申请：每批强制勾选 3-5 张（pickRules.min/max），提交后等管理员确认。
       确认走「复制」模式：精选库出现副本，主库原件与路径不动。
     - 「显示已精选」开关：精选确认后照片默认从常规列表隐藏，可开关查看。
     - 删除改为「申请删除」：填理由 → 待审核；审核通过才真删。
     - 批量下载：勾选若干张后打包成 zip（服务端 store 模式打包）。
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, mediaUpload, ApiError } from '../../core/api.js';
import { button, field, notice, badge, iconButton } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { getSessionState } from '../../core/api.js';
import { confirmAction, requestText } from '../../ui/overlay.js';

const MAX_BATCH = 12;
const IMAGE_MAX = 20 * 1024 * 1024;
const DEFAULT_PICK_RULES = { min: 3, max: 5, statuses: { none: '未申请', pending: '已申请待确认', picked: '已精选', rejected: '已驳回' } };
const DEFAULT_DELETE_RULES = { statuses: { none: '未申请', pending: '待审核', approved: '已通过', rejected: '已驳回' }, requiresReview: true };

/**
 * 把 blob 存成下载（规避 CSP：不能用 form 提交或 data: 大文件）。
 * 服务器返回的 Content-Disposition 可能带中文文件名，这里取第二个参数兜底。
 */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, attrs: { download: filename || 'download' } });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function filenameFromDisposition(disposition, fallback) {
  const raw = String(disposition || '');
  const utf8 = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* ignore */ } }
  const plain = raw.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

export default async function photosPage() {
  const user = getSessionState()?.user || {};
  const state = {
    centers: [],
    activities: [],
    photos: [],
    folders: [],
    openFolderKey: '',   // 当前展开的文件夹（空=文件夹总览）
    selected: new Set(), // 当前勾选的照片 id（精选申请 / 批量下载共用）
    showPicked: false,   // 「显示已精选」开关
    myPicks: { pending: 0, picked: 0, rejected: 0, picks: [] },
    pickRules: DEFAULT_PICK_RULES,
    deleteRules: DEFAULT_DELETE_RULES,
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
    hint: '共 5 个中心；照片按「/<部门>/<活动名>/<活动名>-照片/」在云盘分文件夹归档。',
  });

  /* v3 第 16 项：先选中心 → 活动下拉按中心过滤 → 禁手填。
     活动名改为只读下拉（options 由中心联动刷新），不再允许自由输入。 */
  const activitySelect = field({
    label: '活动名称', name: 'media-activity',
    options: [{ value: '', label: '（请先选择归档中心）' }],
    hint: '活动名从该中心已登记的活动中选择；若活动尚未建立，请先在活动项目表中登记。',
  });
  activitySelect.control.disabled = true;
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

  /* --- data -------------------------------------------------------------- */

  async function loadActivities(center = '') {
    try {
      const payload = await publicApi.mediaActivities({ center });
      state.activities = payload.activities || [];
      state.centers = payload.centers?.length ? payload.centers : state.centers;
      if (payload.config?.centers?.length) state.centers = payload.config.centers;
      centerSelect.control.replaceChildren(
        h('option', { value: '', text: '（选择归档中心）' }),
        ...state.centers.map((name) => h('option', { value: name, text: name })));
      if (center) centerSelect.control.value = center;
      renderActivityOptions();
    } catch (error) {
      reportError(error, '中心/活动名单加载失败');
    }
  }

  /** 按当前中心刷新活动下拉（禁手填）。 */
  function renderActivityOptions() {
    const center = centerSelect.control.value;
    const select = activitySelect.control;
    if (!center) {
      select.disabled = true;
      select.replaceChildren(h('option', { value: '', text: '（请先选择归档中心）' }));
      return;
    }
    select.disabled = false;
    if (!state.activities.length) {
      select.replaceChildren(h('option', { value: '', text: '（该中心暂无已登记活动）' }));
      return;
    }
    select.replaceChildren(
      h('option', { value: '', text: '（选择活动）' }),
      ...state.activities.map((item) => h('option', {
        value: item.name,
        text: item.center ? item.name : `${item.name}（未归类）`,
      })));
  }

  async function loadPhotos() {
    try {
      const payload = await publicApi.myPhotos({ showPicked: state.showPicked });
      state.photos = payload.photos || [];
      state.folders = payload.folders || [];
      if (payload.pickRules) state.pickRules = { ...DEFAULT_PICK_RULES, ...payload.pickRules };
      if (payload.deleteRules) state.deleteRules = { ...DEFAULT_DELETE_RULES, ...payload.deleteRules };
      if (payload.config) state.config = { ...state.config, ...payload.config };
      if (payload.config?.centers?.length) state.centers = payload.config.centers;
      // 已消失的照片（删除/取消勾选）从选择集里剔除。
      const alive = new Set(state.photos.map((photo) => photo.id));
      for (const id of [...state.selected]) if (!alive.has(id)) state.selected.delete(id);
      // 若展开的文件夹已被清空（照片全删），回到总览。
      if (state.openFolderKey && !state.folders.some((f) => f.key === state.openFolderKey)) state.openFolderKey = '';
      renderControls();
      renderGrid();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      reportError(error, '照片列表加载失败');
    }
  }

  async function loadMyPicks() {
    try {
      const payload = await publicApi.myPicks();
      // 服务端把分状态计数放在 stats 里；顶层兜底也算一遍，防止字段变动。
      const picks = payload.picks || [];
      const count = (status) => picks.filter((p) => p.pickStatus === status).length;
      state.myPicks = {
        picks,
        pending: payload.stats?.pending ?? count('已申请待确认'),
        picked: payload.stats?.picked ?? count('已精选'),
        rejected: payload.stats?.rejected ?? count('已驳回'),
      };
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      // 精选申请列表失败不阻塞主流程（可能表未建）。
      state.myPicks = { pending: 0, picked: 0, rejected: 0, picks: [] };
    }
  }

  async function refresh() {
    await Promise.all([loadPhotos(), loadMyPicks()]);
    renderGrid();
  }

  async function uploadFiles(fileList) {
    const center = centerSelect.control.value;
    const activity = activitySelect.control.value.trim();
    if (!center) {
      notify.warning('先选择归档中心', '请选择照片归入哪个中心（生命/博爱/综事/苏州/主席团）。');
      return;
    }
    if (!activity) {
      notify.warning('先选择活动名称', '请从该中心的活动下拉中选择一个已登记活动。');
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
        notify.success(`已上传 ${payload.photos.length} 张`, `已归档到「${activity}-${center}/${activity}-照片」文件夹。`);
        // 上传后直接展开对应文件夹。
        state.openFolderKey = [center, activity].join('\u0001');
      }
      await loadPhotos();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      // 限流是额度问题，不是文件问题：说清楚等多久，并告诉用户照片没丢。
      if (error?.status === 429) {
        notify.warning('上传过于频繁', `${error.message}已选照片不会丢，到时间后重新选择同样的文件即可继续。`);
        return;
      }
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
    uploadHint.textContent = state.uploading ? `上传中 ${state.uploadProgress}% · 归档到「${centerSelect.control.value} / ${activitySelect.control.value.trim()}」` : '';
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

  /* --- 选择（精选 / 批量下载） ------------------------------------------- */

  function toggleSelect(photo) {
    if (state.selected.has(photo.id)) state.selected.delete(photo.id);
    else state.selected.add(photo.id);
    renderGrid();
  }

  function selectedPhotos() {
    return state.photos.filter((photo) => state.selected.has(photo.id));
  }

  /** 精选申请：强制 3-5 张（与服务端 pickRules 一致，前端先拦一道给即时反馈）。 */
  async function requestPick() {
    const chosen = selectedPhotos();
    const { min, max } = state.pickRules;
    if (chosen.length < min || chosen.length > max) {
      notify.warning(`每批精选需勾选 ${min}-${max} 张`, `当前勾选 ${chosen.length} 张。请调整勾选后重试。`);
      return;
    }
    const bad = chosen.find((photo) => photo.pickStatus === '已精选' || photo.pickStatus === '已申请待确认');
    if (bad) {
      notify.warning('有照片不能重复申请', `${bad.filename}：当前状态「${bad.pickStatus}」。`);
      return;
    }
    if (!await confirmAction({ title: '提交精选申请', description: `确认提交 ${chosen.length} 张照片？审核通过后会复制到精选库，主库原件和路径不变。` })) return;
    try {
      const payload = await publicApi.mediaPickRequest(chosen.map((photo) => photo.id));
      notify.success('已提交精选申请', payload.message || `共 ${chosen.length} 张，等待管理员确认。`);
      state.selected.clear();
      await refresh();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('精选申请未提交', error?.message || '请稍后重试。');
    }
  }

  /** 批量下载：把勾选照片打成 zip（服务端打包，规避 CSP 与逐张弹窗）。 */
  async function downloadSelected() {
    const chosen = selectedPhotos();
    if (!chosen.length) {
      notify.info('先勾选照片', '在照片卡片左上角勾选需要下载的照片，再点「批量下载」。');
      return;
    }
    try {
      notify.info(`正在打包 ${chosen.length} 张…`, '文件较大时请稍等，浏览器会自动开始下载。');
      const result = await publicApi.mediaDownloadZip(chosen.map((photo) => photo.id));
      const name = filenameFromDisposition(result.disposition, `影像素材_${chosen.length}张.zip`);
      saveBlob(result.blob, name);
      notify.success('打包完成', `已下载 ${chosen.length} 张照片。`);
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      notify.warning('打包下载未完成', error?.message || '请减少勾选数量后重试。');
    }
  }

  /** 申请删除（第 9 项）：填理由 → 待审核；审核通过前原删接口会拒绝。 */
  async function applyDelete(photo) {
    if (photo.deleteStatus === '待审核') {
      notify.info('删除申请审核中', `${photo.filename}：已提交，请等待管理员处理。`);
      return;
    }
    if (photo.deleteStatus === '已通过') {
      notify.info('这张照片已删除', photo.filename);
      return;
    }
    const reason = await requestText({ title: `申请删除「${photo.filename}」`, label: '删除理由', required: true, description: '照片不会立即删除，管理员审核通过后才从云盘移除。请说明原因，如重复上传或拍摄模糊。' });
    if (reason === null) return; // 取消
    const trimmed = reason.trim();
    if (!trimmed) {
      notify.warning('需要填写删除理由', '请简单说明为什么删除这张照片，方便管理员审核。');
      return;
    }
    submitDeleteRequest(photo, trimmed);
  }

  async function submitDeleteRequest(photo, reason) {
    try {
      await publicApi.mediaDeleteRequest(photo.id, reason);
      notify.success('已提交删除申请', `${photo.filename}：等待管理员审核。`);
      await refresh();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && error.status === 409) {
        notify.info('无需重复申请', error.message || '这张照片已有删除申请或已删除。');
        await refresh();
        return;
      }
      notify.warning('删除申请未提交', error?.message || '请稍后重试。');
    }
  }

  async function batchRename(folder) {
    if (!folder || !Array.isArray(folder.photos) || !folder.photos.length) {
      notify.info('请先打开一个文件夹', '批量更名在文件夹内进行：先点开一个文件夹，再执行批量更名。');
      return;
    }
    const photos = folder.photos.map((p) => state.photos.find((s) => s.id === p.id)).filter(Boolean);
    if (!photos.length) {
      notify.info('文件夹里没有照片', '请先上传照片再批量更名。');
      return;
    }
    if (!await confirmAction({ title: '批量更名', tone: 'danger', requirePhrase: '确认更名', description: `将「${folder.folderName}」中的 ${photos.length} 张照片改为「${folder.activity}_001」起的顺序编号。此操作不可撤销。` })) return;
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
        h('div', { class: 'row-3 row-wrap' }, centerSelect, h('div', { class: 'stack-1' }, activitySelect), h('div', { class: 'stack-1' }, photographerHint)),
        state.config.storageConfigured
          ? h('div', { class: 'stack-3' }, dropzone, uploadBar, uploadHint, fileInput)
          : notice('云盘存储尚未配置，照片直传暂未开放。', { tone: 'info', iconName: 'info' })),
    );
  }

  /** 精选状态徽章（未申请不显示，避免噪音）。 */
  function pickBadge(photo) {
    if (photo.pickStatus === '已精选') return badge('已精选', { tone: 'accent', iconName: 'star' });
    if (photo.pickStatus === '已申请待确认') return badge('待确认', { tone: 'info', iconName: 'clock' });
    if (photo.pickStatus === '已驳回') return badge('精选被驳回', { tone: 'neutral', iconName: 'info' });
    return null;
  }

  /** 删除状态徽章（仅待审核/已驳回提示，已通过的照片不会出现在列表里）。 */
  function deleteBadge(photo) {
    if (photo.deleteStatus === '待审核') return badge('删除审核中', { tone: 'warning', iconName: 'trash' });
    if (photo.deleteStatus === '已驳回') return badge('删除已驳回', { tone: 'neutral', iconName: 'info' });
    return null;
  }

  /** 工具栏：勾选计数 + 精选申请 + 批量下载 + 显示已精选开关。 */
  function renderBatchBar() {
    const count = state.selected.size;
    const { min, max } = state.pickRules;
    const pickReady = count >= min && count <= max;
    const pickHint = count === 0
      ? `勾选 ${min}-${max} 张后提交精选申请`
      : (pickReady ? `已选 ${count} 张 · 可提交精选` : `已选 ${count} 张 · 精选需 ${min}-${max} 张`);
    return h('div', { class: 'row-3 row-wrap' },
      h('span', { class: 'chip chip--static' }, h('span', { text: `已选 ${count} 张` })),
      button({ label: `提交精选申请（${min}-${max} 张）`, variant: pickReady ? 'primary' : 'secondary', iconName: 'star', onClick: requestPick }),
      button({ label: '批量下载（zip）', variant: 'secondary', iconName: 'download', onClick: downloadSelected }),
      count ? button({ label: '清空选择', variant: 'ghost', iconName: 'close', onClick: () => { state.selected.clear(); renderGrid(); } }) : null,
      h('span', { class: 'spacer' }),
      button({
        label: state.showPicked ? '隐藏已精选' : '显示已精选',
        variant: 'ghost', iconName: state.showPicked ? 'eyeOff' : 'eye',
        onClick: () => { state.showPicked = !state.showPicked; loadPhotos(); },
      }),
      h('span', { class: 't-caption t-faint', text: pickHint }));
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
        h('span', { class: 'spacer' }),
        renderPickSummary()),
      h('div', { class: 'mediafolder-grid' }, cards));
  }

  /** 文件夹展开：显示该次活动的照片网格。 */
  function renderFolderDetail(folder) {
    const toolbar = h('div', { class: 'row-3 row-wrap' },
      button({ label: '返回文件夹', variant: 'ghost', iconName: 'chevronLeft', onClick: () => { state.openFolderKey = ''; state.selected.clear(); renderGrid(); } }),
      h('span', { class: 't-body', text: `${folder.center} / ${folder.folderName}` }),
      h('span', { class: 'chip chip--static' }, h('span', { text: `${folder.count} 张` })),
      folder.keepCount ? h('span', { class: 'chip chip--static' }, h('span', { text: `留用 ${folder.keepCount}` })) : null,
      h('span', { class: 'spacer' }),
      button({ label: '批量自动更名', variant: 'secondary', iconName: 'edit', onClick: () => batchRename(folder) }));

    const cards = folder.photos.map((photo) => photoCard(photo));
    gridSlot.append(toolbar, renderBatchBar(), h('div', { class: 'photogrid' }, cards));
  }

  function photoCard(photo) {
    const keepBadge = badge(photo.keepStatus, {
      tone: photo.keepStatus === '留用' ? 'accent' : photo.keepStatus === '弃用' ? 'neutral' : 'info',
      iconName: photo.keepStatus === '留用' ? 'star' : 'clock',
    });
    const isPicked = photo.pickStatus === '已精选';
    const deleteLocked = photo.deleteStatus === '待审核' || photo.deleteStatus === '已通过';
    return h('figure', { class: 'photocard' + (state.selected.has(photo.id) ? ' photocard--selected' : '') },
      h('label', { class: 'photocard__check', attrs: { title: '勾选用于精选申请 / 批量下载' } },
        h('input', {
          class: 'sr-only', attrs: { type: 'checkbox', 'aria-label': `选择 ${photo.filename}` },
          on: { change: () => toggleSelect(photo) },
          ...(state.selected.has(photo.id) ? { checked: '' } : {}),
        }),
        icon('check', 'ico ico--sm')),
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
        pickBadge(photo),
        deleteBadge(photo),
        h('span', { class: 'row-2' },
          iconButton({ iconName: photo.keepStatus === '留用' ? 'close' : 'star', label: photo.keepStatus === '留用' ? '标记弃用' : '标记留用', onClick: () => toggleKeep(photo) }),
          iconButton({ iconName: 'download', label: '下载', onClick: () => downloadPhoto(photo) }),
          deleteLocked
            ? iconButton({ iconName: 'clock', label: photo.deleteStatus === '待审核' ? '删除申请审核中' : '已删除', onClick: () => applyDelete(photo) })
            : iconButton({ iconName: 'trash', label: '申请删除', onClick: () => applyDelete(photo) }))),
      isPicked ? h('span', { class: 'photocard__corner', text: '精选库副本' }) : null);
  }

  function renderGrid() {
    clear(gridSlot);
    if (!state.photos.length) {
      const hint = state.showPicked
        ? '还没有上传过照片。先选归档中心、再选活动名称，把现场照片拖进上传区即可——照片会按「<部门>/<活动名>/<活动名>-照片/」在云盘分文件夹归档。'
        : '还没有上传过照片（或照片都已被精选确认）——若想看精选后的照片，点右上角「显示已精选」。上传：先选归档中心、再选活动名称，把现场照片拖进上传区即可。';
      gridSlot.append(notice(hint, { tone: 'info', iconName: 'camera' }));
      return;
    }
    const open = state.openFolderKey ? state.folders.find((f) => f.key === state.openFolderKey) : null;
    if (open) renderFolderDetail(open);
    else renderFolderOverview();
  }

  /** 精选进度条（我提交过的申请汇总）。 */
  function renderPickSummary() {
    const { pending, picked, rejected } = state.myPicks;
    if (!pending && !picked && !rejected) return null;
    return h('div', { class: 'row-3 row-wrap' },
      h('span', { class: 't-caption t-faint', text: '我的精选申请：' }),
      pending ? badge(`待确认 ${pending}`, { tone: 'info', iconName: 'clock' }) : null,
      picked ? badge(`已入选 ${picked}`, { tone: 'accent', iconName: 'star' }) : null,
      rejected ? badge(`被驳回 ${rejected}`, { tone: 'neutral', iconName: 'info' }) : null);
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
    h('p', { class: 't-prose', text: '先选归档中心、再选活动名称，就能上传现场照片：照片按「<部门>/<活动名>/<活动名>-照片/」在 NJU Box 分文件夹归档，文件不会丢。下方以文件夹形式汇总你的每次活动，点开即可查看该次照片。' }),
    h('p', { class: 't-caption t-faint', text: '勾选 3-5 张可提交「精选申请」（确认后复制一份进精选库，主库原件保留）；删除需先「申请删除」并等管理员审核。' }),
  );

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' },
      headerSlot,
      isSignedIn() ? h('div', { class: 'stack-6' }, controlsSlot, gridSlot) : loginRequiredPanel({ what: '影像库', hint: '照片归档到你的账号下，换设备也能找回。' }),
      lightboxSlot),
  );

  if (isSignedIn()) {
    // v3 第 16 项：中心变更 → 活动下拉按中心重新过滤（禁手填）。
    centerSelect.control.addEventListener('change', () => {
      loadActivities(centerSelect.control.value);
    });
    await loadActivities();
    await Promise.all([loadPhotos(), loadMyPicks()]);
    renderGrid();
  }

  return { title: '影像库', node };
}
