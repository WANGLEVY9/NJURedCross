/**
 * 影像模块路由：活动照片的归档、筛选、预览、下载、留用、删除与批量自动更名。
 *
 * 挂载前缀：/api/public/media*（登录 + CSRF + 分桶限流）
 *
 * v2.1 架构（按 2026-10 用户变更要求调整）：
 *   · 「中心」必选（5 个固定中心，白名单校验）：生命中心/博爱中心/综事中心/苏州分部/主席团活动
 *   · 活动名可在下拉候选（活动广场）中选择，也允许手动填写新活动名
 *   · 摄影师名固定取账号实名（realName，服务端强制，前端不可改）
 *   · Box 目录：/影像素材/<中心>/<活动名>_<摄影师>/<文件>
 *   · 照片实体存 NJU Box，元数据与留用状态存「影像素材表」（双备份）
 *   · 批量自动更名：<活动名>_<三位序号>.<原扩展名>，跳过冲突名
 *
 * ctx 注入契约（与 lib/attachment/api.js 同构）：
 *   json / readJson / getBase / recordAudit / enforceLimit /
 *   requirePortalSession / requireCsrf / ownsBusinessRef / businessAccountRef /
 *   tables{ media, project } / config{ njubox* }
 */

import * as box from './box.js';
import {
  ATTACHMENT_PROVIDER_NJUBOX,
  MEDIA_CENTERS,
  MEDIA_KEEP_STATUS,
  MEDIA_TABLE,
  mediaFolderName,
  mediaFromRow,
  mediaPortalView,
  mediaRow,
  normalizeMediaCenter,
  sanitizeDirname,
  sanitizeFilename,
} from './store.js';

/** 影像模块只收图片：单张上限与内容投稿的 image 规则一致。 */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/** 单次批量上传张数上限。 */
export const MAX_PHOTOS_PER_BATCH = 12;
/** 上传/批量操作限流（次/小时/客户端）。 */
export const MEDIA_LIMIT_PER_HOUR = 20;
/** 批量更名单次上限。 */
export const MAX_RENAME_PER_BATCH = 60;

async function listMediaRows(ctx) {
  const client = await ctx.getBase();
  return client.listRows(ctx.tables.media, '', '', false, '', 2000);
}

/** 活动项目表 → 候选活动名（去重、去空，供上传下拉）。 */
async function listActivityNames(ctx) {
  const client = await ctx.getBase();
  const rows = await client.listRows(ctx.tables.project, '', '', false, '', 2000);
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    const name = String(row['活动名称'] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push({ name, status: String(row['状态'] || '') });
  }
  return names;
}

/** 中心名必选 + 白名单校验（5 个固定中心）。 */
function assertCenter(value) {
  const center = normalizeMediaCenter(value);
  if (!center) {
    const error = new Error(`请选择归档中心（可选：${MEDIA_CENTERS.join('、')}）。`);
    error.statusCode = 400;
    error.code = 'media_center_invalid';
    throw error;
  }
  return center;
}

/**
 * 摄影师名：只认账号实名（realName），服务端强制，缺失即拒。
 * realName 由 ctx.resolveRealName(session) 从身份库取，前端传值一律忽略。
 */
function assertPhotographer(session, ctx) {
  const name = sanitizeDirname(ctx.resolveRealName ? ctx.resolveRealName(session) : '');
  if (!name) {
    const error = new Error('账号实名信息不完整（缺少姓名），请先补全实名后再上传照片。');
    error.statusCode = 403;
    error.code = 'media_photographer_missing';
    throw error;
  }
  return name;
}

/** multipart 解析：与 api.js 相同的 undici 路线，超限抛 413。 */
async function readMultipart(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`上传总量超过 ${Math.floor(maxBytes / (1024 * 1024))}MB 上限`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return new Response(buffer, { headers: { 'content-type': req.headers['content-type'] } }).formData();
}

/** Box 路径：/影像素材/<中心>/<活动名>_<摄影师>。 */
function mediaDir(ctx, center, activity, photographer) {
  const root = box.boxStatus(ctx.config).dirs.media;
  return `${root}/${sanitizeDirname(center)}/${mediaFolderName(activity, photographer)}`;
}

/**
 * 影像模块路由总入口。返回 false 表示路径不属于本域，交还 server.js。
 */
export async function mediaRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/public\/media\/?/, ''));
  const session = ctx.requirePortalSession(req, res);
  if (!session) return;

  // GET /api/public/media/activities —— 活动广场候选活动名（可手填，仅作提示）+ 中心列表
  if (req.method === 'GET' && tail === 'activities') {
    const activities = await listActivityNames(ctx);
    return ctx.json(res, 200, { ok: true, activities, centers: MEDIA_CENTERS, config: mediaConfig(ctx) });
  }

  // GET /api/public/media —— 我的照片（可按中心/活动筛选），同时返回文件夹聚合
  if (req.method === 'GET' && tail === '') {
    const centerFilter = normalizeMediaCenter(url.searchParams.get('center'));
    const activityFilter = String(url.searchParams.get('activity') || '').trim();
    const rows = await listMediaRows(ctx);
    const mine = rows
      .map((row) => mediaFromRow(row))
      .filter((media) => ctx.ownsBusinessRef(session, media.uploader)
        && media.keepStatus !== MEDIA_KEEP_STATUS.deleted
        && (!centerFilter || media.center === centerFilter)
        && (!activityFilter || media.activity === activityFilter))
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    return ctx.json(res, 200, {
      ok: true,
      photos: mine.map(mediaPortalView),
      folders: groupIntoFolders(mine),
      config: mediaConfig(ctx),
    });
  }

  // POST /api/public/media —— 批量上传（multipart：activity + files 多值）
  if (req.method === 'POST' && tail === '') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleUpload(req, res, ctx, session);
  }

  // POST /api/public/media/batch-rename —— 批量自动更名
  if (req.method === 'POST' && tail === 'batch-rename') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleBatchRename(req, res, ctx, session);
  }

  const idMatch = tail.match(/^([A-Za-z0-9-]+)(?:\/(link))?$/);
  if (!idMatch) return false;

  // GET /api/public/media/:id/link —— 预览/下载临时直链（现取现用）
  if (req.method === 'GET' && idMatch[2] === 'link') {
    return handleLink(res, ctx, session, idMatch[1]);
  }

  // PATCH /api/public/media/:id —— 留用状态切换
  if (req.method === 'PATCH') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleKeep(req, res, ctx, session, idMatch[1]);
  }

  // DELETE /api/public/media/:id —— 删除（Box 文件 + 表状态）
  if (req.method === 'DELETE') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleDelete(req, res, ctx, session, idMatch[1]);
  }

  return false;
}

function mediaConfig(ctx) {
  const status = box.boxStatus(ctx.config);
  return {
    storageConfigured: status.configured,
    provider: ATTACHMENT_PROVIDER_NJUBOX,
    maxPhotosPerBatch: MAX_PHOTOS_PER_BATCH,
    centers: MEDIA_CENTERS,
    acceptedHint: '图片（JPG/PNG/GIF/WebP 等，单张 ≤20MB）',
  };
}

/**
 * 文件夹聚合（要求4）：同「中心 + 活动 + 摄影师」归为一个文件夹。
 * 每个文件夹对应 Box 的 /影像素材/<中心>/<活动名>_<摄影师>/ 目录。
 */
function groupIntoFolders(mediaList) {
  const map = new Map();
  for (const media of mediaList) {
    const key = [media.center || '未分类', media.activity || '未命名活动', media.photographer || ''].join('\u0001');
    if (!map.has(key)) {
      map.set(key, {
        key,
        center: media.center || '未分类',
        activity: media.activity || '未命名活动',
        photographer: media.photographer || '',
        folderName: mediaFolderName(media.activity, media.photographer),
        count: 0,
        keepCount: 0,
        totalSize: 0,
        latestAt: '',
        photos: [],
      });
    }
    const folder = map.get(key);
    folder.photos.push(mediaPortalView(media));
    folder.count += 1;
    if (media.keepStatus === MEDIA_KEEP_STATUS.keep) folder.keepCount += 1;
    folder.totalSize += Number(media.size) || 0;
    const at = String(media.uploadedAt || '');
    if (at > folder.latestAt) folder.latestAt = at;
  }
  return [...map.values()].sort((a, b) => String(b.latestAt).localeCompare(String(a.latestAt)));
}

/** 批量上传：活动名校验 → 逐张传 Box → 逐张落表；单张失败不回滚已成功的。 */
async function handleUpload(req, res, ctx, session) {
  ctx.enforceLimit(req, 'media', MEDIA_LIMIT_PER_HOUR);
  const status = box.boxStatus(ctx.config);
  if (!status.configured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_not_configured', message: '照片直传暂未开放（NJU Box 存储未配置）。' });
  }
  let form;
  try {
    form = await readMultipart(req, MAX_PHOTOS_PER_BATCH * IMAGE_MAX_BYTES + 64 * 1024);
  } catch (error) {
    return ctx.json(res, error.statusCode === 413 ? 413 : 400, { ok: false, code: 'media_form_unparseable', message: error.message });
  }
  const activityRaw = String(form.get('activity') || '').trim();
  const activity = sanitizeDirname(activityRaw);
  if (!activity) return ctx.json(res, 400, { ok: false, code: 'media_activity_missing', message: '请填写活动名称。' });
  // 中心：5 个固定中心之一，白名单校验。
  let center;
  try {
    center = assertCenter(form.get('center'));
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'media_center_invalid', message: error.message });
  }
  // 摄影师：强制取账号实名，前端传值忽略。
  let photographer;
  try {
    photographer = assertPhotographer(session, ctx);
  } catch (error) {
    return ctx.json(res, error.statusCode || 403, { ok: false, code: error.code || 'media_photographer_missing', message: error.message });
  }
  const files = form.getAll('files').filter((item) => item && typeof item === 'object' && item.size);
  if (!files.length) return ctx.json(res, 400, { ok: false, code: 'media_files_missing', message: '缺少上传照片。' });
  if (files.length > MAX_PHOTOS_PER_BATCH) {
    return ctx.json(res, 413, { ok: false, code: 'media_batch_too_large', message: `单次最多上传 ${MAX_PHOTOS_PER_BATCH} 张，请分批。` });
  }

  const dir = mediaDir(ctx, center, activity, photographer);
  const client = await ctx.getBase();
  const created = [];
  const failed = [];
  for (const file of files) {
    const mimeType = String(file.type || '').toLowerCase();
    if (!mimeType.startsWith('image/')) {
      failed.push({ filename: String(file.name || ''), reason: '仅支持图片文件' });
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      failed.push({ filename: String(file.name || ''), reason: '单张照片超过 20MB 上限' });
      continue;
    }
    const filename = sanitizeFilename(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = mediaIdentifier();
    let stored;
    try {
      stored = await box.uploadBuffer(ctx.config, {
        repoId: status.repoId,
        dir,
        filename,
        buffer,
        contentType: mimeType,
      });
    } catch (error) {
      failed.push({ filename, reason: error?.message || String(error) });
      continue;
    }
    const media = {
      id,
      center,
      activity,
      photographer,
      filename,
      mimeType,
      size: buffer.length,
      checksum: box.checksum(buffer),
      provider: ATTACHMENT_PROVIDER_NJUBOX,
      repoId: status.repoId,
      path: stored.path,
      keepStatus: MEDIA_KEEP_STATUS.pending,
      uploader: ctx.businessAccountRef(session),
      uploadedAt: new Date().toISOString(),
    };
    try {
      await client.appendRow(ctx.tables.media, mediaRow(media));
      created.push(mediaPortalView(media));
    } catch (error) {
      // 表写入失败时回滚 Box 文件，避免无主文件。
      await box.deleteFile(ctx.config, status.repoId, stored.path).catch(() => {});
      failed.push({ filename, reason: `元数据写入失败：${error?.message || error}` });
    }
  }
  await ctx.recordAudit(req, session, 'media.photo.upload', `${center}/${activity}`, created.length ? 'success' : 'failure', { center, activity, photographer, created: created.length, failed: failed.length });
  return ctx.json(res, created.length ? 201 : 500, {
    ok: created.length > 0,
    photos: created,
    failed,
    config: mediaConfig(ctx),
  });
}

/** 临时直链：本人照片才可取；链接每次现取（seafhttp 链接有时效）。 */
async function handleLink(res, ctx, session, photoId) {
  const rows = await listMediaRows(ctx);
  const found = rows.find((row) => String(row['照片ID'] || '') === photoId);
  if (!found) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  const media = mediaFromRow(found);
  if (!ctx.ownsBusinessRef(session, media.uploader)) {
    return ctx.json(res, 403, { ok: false, code: 'media_not_owned', message: '仅上传人本人可以查看这张照片。' });
  }
  if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) {
    return ctx.json(res, 404, { ok: false, message: '照片已删除。' });
  }
  const status = box.boxStatus(ctx.config);
  if (!status.configured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_not_configured', message: '存储未配置，无法生成预览链接。' });
  }
  try {
    const link = await box.fileLink(ctx.config, media.repoId || status.repoId, media.path);
    return ctx.json(res, 200, { ok: true, id: media.id, filename: media.filename, link });
  } catch (error) {
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_request_failed', message: error.message });
  }
}

/** 留用状态切换：待定/留用/弃用，仅本人。 */
async function handleKeep(req, res, ctx, session, photoId) {
  const body = await ctx.readJson(req);
  const keep = String(body.keep || '').trim();
  if (![MEDIA_KEEP_STATUS.pending, MEDIA_KEEP_STATUS.keep, MEDIA_KEEP_STATUS.drop].includes(keep)) {
    return ctx.json(res, 400, { ok: false, code: 'media_keep_invalid', message: '留用状态必须是 待定 / 留用 / 弃用。' });
  }
  const rows = await listMediaRows(ctx);
  const found = rows.find((row) => String(row['照片ID'] || '') === photoId);
  if (!found) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  const media = mediaFromRow(found);
  if (!ctx.ownsBusinessRef(session, media.uploader)) {
    return ctx.json(res, 403, { ok: false, code: 'media_not_owned', message: '仅上传人本人可以操作这张照片。' });
  }
  if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) {
    return ctx.json(res, 409, { ok: false, code: 'media_deleted', message: '照片已删除。' });
  }
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.media, found._id, { 留用状态: keep });
  await ctx.recordAudit(req, session, 'media.photo.keep', photoId, 'success', { keep });
  return ctx.json(res, 200, { ok: true, photo: { ...mediaPortalView(media), keepStatus: keep } });
}

/** 删除：仅本人；先删 Box 文件，再标「已删除」（幂等）。 */
async function handleDelete(req, res, ctx, session, photoId) {
  const rows = await listMediaRows(ctx);
  const found = rows.find((row) => String(row['照片ID'] || '') === photoId);
  if (!found) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  const media = mediaFromRow(found);
  if (!ctx.ownsBusinessRef(session, media.uploader)) {
    return ctx.json(res, 403, { ok: false, code: 'media_not_owned', message: '仅上传人本人可以删除这张照片。' });
  }
  if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) {
    return ctx.json(res, 200, { ok: true });
  }
  const status = box.boxStatus(ctx.config);
  if (status.configured && media.path) {
    try {
      await box.deleteFile(ctx.config, media.repoId || status.repoId, media.path);
    } catch (error) {
      await ctx.recordAudit(req, session, 'media.photo.delete', photoId, 'failure', { message: error?.message || String(error) });
      return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_request_failed', message: `NJU Box 删除失败：${error.message}` });
    }
  }
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.media, found._id, { 留用状态: MEDIA_KEEP_STATUS.deleted });
  await ctx.recordAudit(req, session, 'media.photo.delete', photoId, 'success', { filename: media.filename });
  return ctx.json(res, 200, { ok: true });
}

/**
 * 批量自动更名：<活动名>_<三位序号>.<原扩展名>。
 * 目标名冲突（Box 目录已有同名文件或批内重复）自动顺延序号；跨活动拒绝。
 */
async function handleBatchRename(req, res, ctx, session) {
  ctx.enforceLimit(req, 'media', MEDIA_LIMIT_PER_HOUR);
  const status = box.boxStatus(ctx.config);
  if (!status.configured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_not_configured', message: '存储未配置，无法批量更名。' });
  }
  const body = await ctx.readJson(req);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return ctx.json(res, 400, { ok: false, code: 'media_ids_missing', message: '请选择要更名的照片。' });
  if (ids.length > MAX_RENAME_PER_BATCH) {
    return ctx.json(res, 413, { ok: false, code: 'media_batch_too_large', message: `单次最多更名 ${MAX_RENAME_PER_BATCH} 张。` });
  }
  const rows = await listMediaRows(ctx);
  const byId = new Map(rows.map((row) => [String(row['照片ID'] || ''), row]));
  const targets = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return ctx.json(res, 404, { ok: false, code: 'media_not_found', message: `照片 ${id} 不存在。` });
    const media = mediaFromRow(row);
    if (!ctx.ownsBusinessRef(session, media.uploader)) {
      return ctx.json(res, 403, { ok: false, code: 'media_not_owned', message: `照片 ${media.filename || id} 不属于当前账号。` });
    }
    if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) {
      return ctx.json(res, 409, { ok: false, code: 'media_deleted', message: `照片 ${media.filename || id} 已删除。` });
    }
    targets.push({ row, media });
  }
  // 一次只能整理同一个文件夹（中心 + 活动 + 摄影师）内的照片。
  const folderKeys = new Set(targets.map(({ media }) => `${media.center || ''}\u0001${media.activity}\u0001${media.photographer || ''}`));
  if (folderKeys.size > 1) {
    return ctx.json(res, 400, { ok: false, code: 'media_rename_cross_activity', message: '一次只能对同一活动文件夹内的照片批量更名。' });
  }
  const first = targets[0].media;
  const activity = first.activity;
  const dir = mediaDir(ctx, first.center, activity, first.photographer);

  // 现有文件名集合（含批内将占用的名字），冲突自动顺延序号。
  const existing = new Set();
  const listing = await box.listDir(ctx.config, status.repoId, dir, { type: 'file' });
  for (const item of listing || []) existing.add(item.name);
  const extensionOf = (name) => {
    const dot = String(name || '').lastIndexOf('.');
    return dot > 0 ? String(name).slice(dot) : '';
  };
  const stem = sanitizeDirname(activity) || '照片';
  const client = await ctx.getBase();
  const renamed = [];
  const failed = [];
  let sequence = 1;
  for (const { row, media } of targets) {
    let newName = '';
    for (;;) {
      newName = `${stem}_${String(sequence).padStart(3, '0')}${extensionOf(media.filename)}`;
      sequence += 1;
      if (!existing.has(newName)) break;
    }
    try {
      const result = await box.renameFile(ctx.config, media.repoId || status.repoId, media.path, newName);
      existing.add(newName);
      await client.updateRow(ctx.tables.media, row._id, { 文件名: result.filename, 文件路径: result.path });
      renamed.push({ id: media.id, oldName: media.filename, newName: result.filename });
    } catch (error) {
      failed.push({ id: media.id, filename: media.filename, reason: error?.message || String(error) });
    }
  }
  await ctx.recordAudit(req, session, 'media.photo.batch_rename', `${first.center}/${activity}`, renamed.length ? 'success' : 'failure', { center: first.center, activity, renamed: renamed.length, failed: failed.length });
  return ctx.json(res, 200, { ok: failed.length === 0, renamed, failed });
}

/** 照片编号：PHO-{时间36}-{随机}，与 attachmentIdentifier 同构。 */
function mediaIdentifier() {
  return `PHO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
}
