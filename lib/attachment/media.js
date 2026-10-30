/**
 * 影像模块路由：活动照片的归档、筛选、预览、下载、留用、删除与批量自动更名。
 *
 * 挂载前缀：/api/public/media*（登录 + CSRF + 分桶限流）
 *
 * v3.1 存储架构（2026-10-11 用户定案）：
 *   · 「部门」必选（4 个固定中心，白名单校验）：生命中心/博爱中心/综事中心/主席团活动
 *   · 活动名必须来自活动项目表在该部门下的候选（服务端强制，禁手填）
 *   · 摄影师名固定取账号实名（realName，服务端强制，前端不可改）
 *   · Box 目录：/<部门>/<活动名>/<活动名>-照片/<文件>
 *   · 照片实体存 NJU Box，元数据与留用状态存「影像素材表」（双备份）
 *   · 批量自动更名：<活动名>_<三位序号>.<原扩展名>，跳过冲突名
 *
 * ctx 注入契约（与 lib/attachment/api.js 同构）：
 *   json / readJson / getBase / recordAudit / enforceLimit /
 *   requirePortalSession / requireCsrf / ownsBusinessRef / businessAccountRef /
 *   tables{ media, project } / config{ njubox* }
 */

import * as box from './box.js';
import { observedFetch } from '../observability.js';
import { activitiesForCenter, listActivityNames } from './activities.js';
import {
  ATTACHMENT_PROVIDER_NJUBOX,
  MEDIA_CENTERS,
  MEDIA_DELETE_STATUS,
  MEDIA_KEEP_STATUS,
  MEDIA_PICK_MAX,
  MEDIA_PICK_MIN,
  MEDIA_PICK_STATUS,
  MEDIA_TABLE,
  MEDIA_THUMB_DIR,
  mediaActivityDir,
  mediaDepartmentDir,
  mediaFromRow,
  mediaPhotoDir,
  mediaPortalView,
  mediaRow,
  mediaStoragePath,
  mediaThumbPath,
  normalizeMediaCenter,
  picksStoragePath,
  sanitizeDirname,
  sanitizeFilename,
} from './store.js';

/** 影像模块只收图片：单张上限与内容投稿的 image 规则一致。 */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/**
 * 前端生成的预览缩略图上限。480px 长边的 JPEG 一般 25~40KB，
 * 给 320KB 足够容纳噪点多的照片，也挡住误传的原图。
 */
export const THUMB_MAX_BYTES = 320 * 1024;
/** 缩略图在进程内的缓存上限（字节）。约 800 张 30KB 的图，1 GiB 机器扛得住。 */
const THUMB_CACHE_BYTES = 24 * 1024 * 1024;
/** 「这张没有缩略图」的负缓存时长：老照片不必每次都去 Box 走一圈 404。 */
const THUMB_MISS_TTL_MS = 10 * 60 * 1000;

/** 缩略图正缓存：id → { buffer, at }，按插入顺序淘汰（Map 保持插入序）。 */
const thumbCache = new Map();
/** 负缓存：id → 过期时间。 */
const thumbMisses = new Map();
let thumbCacheBytes = 0;

/** 测试用：清空缩略图缓存。 */
export function clearThumbCache() {
  thumbCache.clear();
  thumbMisses.clear();
  thumbCacheBytes = 0;
  thumbRowsCache = null;
}

/**
 * 缩略图专用的行索引缓存（60 秒）。
 * 一次列表里 9 张图会并发打 9 个缩略图请求，如果每个都读一遍影像表，就是
 * 又一次「自己把自己压垮」。这里只服务缩略图，过期短，且上传成功后立即失效。
 */
let thumbRowsCache = null;
/** 正在读表的 Promise：一屏 9 张图同时到，只让第一个去查。 */
let thumbRowsInFlight = null;

/** 测试用：清空缩略图行索引。 */
export function clearThumbRowsCache() {
  thumbRowsCache = null;
  thumbRowsInFlight = null;
}

async function listMediaRowsForThumb(ctx) {
  if (thumbRowsCache && thumbRowsCache.expiresAt > Date.now()) return thumbRowsCache.rows;
  if (thumbRowsInFlight) return thumbRowsInFlight;
  thumbRowsInFlight = (async () => {
    try {
      const rows = await listMediaRows(ctx);
      thumbRowsCache = { rows, expiresAt: Date.now() + 60_000 };
      return rows;
    } finally {
      thumbRowsInFlight = null;
    }
  })();
  return thumbRowsInFlight;
}

function readThumbCache(id) {
  const hit = thumbCache.get(id);
  if (!hit) return null;
  // 命中即续期：常用照片留在缓存里，冷门的自然被挤掉。
  thumbCache.delete(id);
  thumbCache.set(id, hit);
  return hit.buffer;
}

function writeThumbCache(id, buffer) {
  if (buffer.length > THUMB_CACHE_BYTES) return;
  const existing = thumbCache.get(id);
  if (existing) thumbCacheBytes -= existing.buffer.length;
  thumbCache.set(id, { buffer, at: Date.now() });
  thumbCacheBytes += buffer.length;
  while (thumbCacheBytes > THUMB_CACHE_BYTES && thumbCache.size > 1) {
    const [oldestKey, oldest] = thumbCache.entries().next().value;
    thumbCache.delete(oldestKey);
    thumbCacheBytes -= oldest.buffer.length;
  }
}
/** 单次批量上传张数上限。 */
export const MAX_PHOTOS_PER_BATCH = 12;
/**
 * 上传限流（请求/小时/账号）。前端主路径是「一张一个请求」，
 * 所以这个数字≈每小时可上传张数；旧页面一次发多张时算 1 次。
 */
export const MEDIA_LIMIT_PER_HOUR = 200;
/** 同时进行的 Box 上传数。1 GiB 机器上 3 张 × 20MB 缓冲仍在安全区。 */
export const MEDIA_UPLOAD_CONCURRENCY = 3;
/**
 * 活动候选缓存（毫秒）。
 *
 * 每张照片都要校验「活动名属于该中心」，而 listActivityNames 会拉活动项目表
 * （2000 行）再叠加跨库活动目录——一张两次大查询，相机一口气传 10 张就是 20 多次，
 * 2026-10-30 09:20 那次 SeaTable 整体超时就是这样被压垮的。活动候选一天也变不了
 * 几次，进程内缓存一分钟足够；校验失败时会强制回源一次，新建的活动不会等满 60 秒。
 */
export const ACTIVITY_CACHE_TTL_MS = 60_000;
/** 缓存内容：{ value, expiresAt }。null 表示未缓存或已过期。 */
let activityCache = null;
/** 正在回源的 Promise：并发 3 张同时到，只让第一张去查，其余等同一个结果。 */
let activityInFlight = null;

/** 测试与运维用：清空活动候选缓存。 */
export function clearActivityCache() {
  activityCache = null;
  activityInFlight = null;
}

/**
 * 取活动候选（带缓存 + 并发合并）。
 * `fresh` 为真时忽略缓存；回源抛错时不写入缓存，避免把一次失败缓存一分钟。
 */
export async function loadActivityCatalog(ctx, { fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && activityCache && activityCache.expiresAt > now) return activityCache.value;
  if (activityInFlight) return activityInFlight;
  activityInFlight = (async () => {
    try {
      const value = await listActivityNames(ctx);
      activityCache = { value, expiresAt: Date.now() + ACTIVITY_CACHE_TTL_MS };
      return value;
    } finally {
      activityInFlight = null;
    }
  })();
  return activityInFlight;
}

/** 网络抖动、上游超时、限流值得再试一次；参数错误与内容违规重试也没用。 */
export function isRetryableStorageError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (
    code === 'njubox_network_error'
    || code === 'njubox_request_failed'
    || code === 'njubox_upload_failed'
    || code === 'external_request_timeout'
    || code === 'external_request_cancelled'
    || code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || code === 'ENOTFOUND'
    || code === 'EAI_AGAIN'
  ) {
    return true;
  }
  const status = Number(error.statusCode || error.status || 0);
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  return /timeout|timed out|fetch failed|socket hang up|ECONNRESET|network|网络/i.test(String(error.message || ''));
}

/**
 * 单次重试：可重试错误退避后重试一次，仍失败则抛出第二次的错误。
 * 只在「一张照片」的粒度上用，不会把整批放大成 2 倍请求量。
 */
export async function withSingleRetry(operation, { delayMs = 600 } = {}) {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableStorageError(error)) throw error;
    if (delayMs > 0) await new Promise((resolve) => { setTimeout(resolve, delayMs); });
    return operation();
  }
}
/** 批量更名单次上限。 */
export const MAX_RENAME_PER_BATCH = 60;
/** 单次批量下载打包上限（张）。 */
export const MAX_ZIP_PER_BATCH = 30;
/** 单次打包总字节上限（默认 200MB，防内存与超时）。 */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
/** 精选申请限流（次/小时/账号）。 */
export const MEDIA_PICK_LIMIT_PER_HOUR = 10;
/** 批量更名限流（次/小时/账号）。 */
export const MEDIA_RENAME_LIMIT_PER_HOUR = 20;
/** 批量下载限流（次/小时/账号）。 */
export const MEDIA_DOWNLOAD_LIMIT_PER_HOUR = 20;
/**
 * 出口 IP 兜底（请求/小时/IP）。按账号计数后这里只防刷，
 * 必须显著高于单人额度：校园网一个出口常常几十号人同时传。
 */
export const MEDIA_IP_LIMIT_PER_HOUR = 1200;

/**
 * 每个动作独立分桶。此前四个动作共用 `media` 桶，
 * 下载 zip 或精选申请会把上传额度一起吃掉。
 */
export const MEDIA_RATE_BUCKETS = Object.freeze({
  upload: 'media-upload',
  rename: 'media-rename',
  pick: 'media-pick',
  download: 'media-download',
  // 审核端给老照片补缩略图（浏览器压好回存），单独分桶避免吃掉上传额度。
  thumb: 'media-thumb',
});

/** 影像库一律按登录账号计数；取不到账号时才退回按 IP。 */
export function mediaLimitIdentity(session) {
  return String(session?.username || session?.accountId || '').trim();
}

/**
 * 影像库限流入口：账号分桶 + 出口 IP 兜底。
 * 返回实际使用的桶与身份，便于回归断言。
 */
export function enforceMediaLimit(req, ctx, session, action, limit) {
  const bucket = MEDIA_RATE_BUCKETS[action] || `media-${action}`;
  const identity = mediaLimitIdentity(session);
  if (identity) ctx.enforceLimit(req, bucket, limit, identity);
  else ctx.enforceLimit(req, bucket, limit);
  ctx.enforceLimit?.(req, 'media-net', MEDIA_IP_LIMIT_PER_HOUR);
  return { bucket, identity };
}

async function listMediaRows(ctx) {
  const client = await ctx.getBase();
  return client.listRows(ctx.tables.media, '', '', false, '', 2000);
}

/**
 * 活动项目表 → 候选活动名。
 * v3.2：字典与判定已抽到 ./activities.js（内容投稿附件域共用同一份口径）。
 */

/** 中心名必选 + 白名单校验（4 个固定中心）。 */
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
 * v3 第 16 项：活动名必须来自该中心下的候选（禁手填）。
 * 候选来源：活动项目表「活动名称」+ 「中心」；未填中心的老活动视为兜底候选。
 */
function assertActivityAllowed(activity, center, activities) {
  const allowed = activitiesForCenter(activities, center).map((item) => item.name);
  if (!allowed.includes(activity)) {
    const error = new Error(`活动「${activity}」不属于「${center}」，请从该中心的活动下拉中选择。若活动尚未建立，请先在活动项目表中登记。`);
    error.statusCode = 400;
    error.code = 'media_activity_not_allowed';
    throw error;
  }
  return activity;
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

/**
 * Box 路径（v3.1 结构，2026-10-11）：/<部门>/<活动名>/<活动名>-照片。
 * 摄影师实名不进目录名（由表列承载），避免同名活动不同摄影师产生目录碎片。
 */
function mediaDir(ctx, center, activity) {
  return mediaStoragePath(activity, center, { subdir: 'photo' }).dir;
}

/**
 * 影像模块路由总入口。返回 false 表示路径不属于本域，交还 server.js。
 */
export async function mediaRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/public\/media\/?/, ''));
  const session = ctx.requirePortalSession(req, res);
  if (!session) return;

  // GET /api/public/media/activities —— 活动候选（v3 第 16 项：可按 ?center= 过滤）
  if (req.method === 'GET' && tail === 'activities') {
    const center = normalizeMediaCenter(url.searchParams.get('center'));
    const all = await listActivityNames(ctx);
    const activities = center ? activitiesForCenter(all, center) : all;
    return ctx.json(res, 200, { ok: true, activities, allActivities: all, centers: MEDIA_CENTERS, center: center || '', config: mediaConfig(ctx) });
  }

  // GET /api/public/media —— 我的照片（可按中心/活动筛选），同时返回文件夹聚合
  if (req.method === 'GET' && tail === '') {
    const centerFilter = normalizeMediaCenter(url.searchParams.get('center'));
    const activityFilter = String(url.searchParams.get('activity') || '').trim();
    // N1：常规列表默认过滤「已精选」（可切换「显示已精选」）。
    const showPicked = ['1', 'true', 'yes'].includes(String(url.searchParams.get('showPicked') || '').toLowerCase());
    const rows = await listMediaRows(ctx);
    const mine = rows
      .map((row) => mediaFromRow(row))
      .filter((media) => ctx.ownsBusinessRef(session, media.uploader)
        && media.keepStatus !== MEDIA_KEEP_STATUS.deleted
        && (!centerFilter || media.center === centerFilter)
        && (!activityFilter || media.activity === activityFilter)
        && (showPicked || media.pickStatus !== MEDIA_PICK_STATUS.picked))
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    return ctx.json(res, 200, {
      ok: true,
      photos: mine.map(mediaPortalView),
      folders: groupIntoFolders(mine),
      showPicked,
      pickRules: { min: MEDIA_PICK_MIN, max: MEDIA_PICK_MAX, statuses: MEDIA_PICK_STATUS },
      deleteRules: { statuses: MEDIA_DELETE_STATUS, requiresReview: true },
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

  // POST /api/public/media/picks —— 提交精选申请（强制 3-5 张，N1）
  if (req.method === 'POST' && tail === 'picks') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handlePickRequest(req, res, ctx, session);
  }

  // GET /api/public/media/picks —— 我提交过的精选申请
  if (req.method === 'GET' && tail === 'picks') {
    return handleMyPicks(res, ctx, session);
  }

  // POST /api/public/media/download-zip —— 批量下载（流式 zip）
  if (req.method === 'POST' && tail === 'download-zip') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleDownloadZip(req, res, ctx, session);
  }

  // POST /api/public/media/:id/delete-request —— 申请删除（第 9 项，需审核）
  const deleteRequestMatch = tail.match(/^([A-Za-z0-9-]+)\/delete-request$/);
  if (req.method === 'POST' && deleteRequestMatch) {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleDeleteRequest(req, res, ctx, session, deleteRequestMatch[1]);
  }

  const idMatch = tail.match(/^([A-Za-z0-9-]+)(?:\/(link|thumb))?$/);
  if (!idMatch) return false;

  // GET /api/public/media/:id/link —— 预览/下载临时直链（现取现用）
  if (req.method === 'GET' && idMatch[2] === 'link') {
    return handleLink(res, ctx, session, idMatch[1]);
  }

  // GET /api/public/media/:id/thumb —— 列表预览图（480px，浏览器可缓存）
  if (req.method === 'GET' && idMatch[2] === 'thumb') {
    return handleThumb(res, ctx, session, idMatch[1]);
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
 * 文件夹聚合（要求4）：同「部门 + 活动」归为一个文件夹。
 * 每个文件夹对应 Box 的 /<部门>/<活动名>/ 目录（照片在 <活动名>-照片/ 下）。
 */
function groupIntoFolders(mediaList) {
  const map = new Map();
  for (const media of mediaList) {
    const key = [media.center || '未分类', media.activity || '未命名活动'].join('\u0001');
    if (!map.has(key)) {
      map.set(key, {
        key,
        center: media.center || '未分类',
        activity: media.activity || '未命名活动',
        photographer: media.photographer || '',
        folderName: mediaActivityDir(media.activity),
        department: mediaDepartmentDir(media.center),
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

/** 影像库上传：单张或少量批量都走这里；前端按「一张一个请求」调用。 */
export async function mapWithConcurrency(items, limit, worker) {
  const total = items.length;
  if (!total) return [];
  const width = Math.min(Math.max(1, limit), total);
  const results = new Array(total);
  let cursor = 0;
  const runners = Array.from({ length: width }, async () => {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 上传回执：同一个 clientUploadId 在 TTL 内重复提交直接返回上次结果。
 * 网关 504 与客户端重试最容易造成「照片已经在 Box、用户再传一次」的重复行。
 */
const UPLOAD_RECEIPT_TTL_MS = 60 * 60 * 1000;
const uploadReceipts = new Map();

export function rememberUploadReceipt(key, value, now = Date.now()) {
  if (!key) return;
  if (uploadReceipts.size >= 500) {
    for (const [existingKey, existing] of uploadReceipts) {
      if (existing.expiresAt <= now) uploadReceipts.delete(existingKey);
    }
    if (uploadReceipts.size >= 500) uploadReceipts.delete(uploadReceipts.keys().next().value);
  }
  uploadReceipts.set(key, { ...value, expiresAt: now + UPLOAD_RECEIPT_TTL_MS });
}

export function readUploadReceipt(key, now = Date.now()) {
  if (!key) return null;
  const entry = uploadReceipts.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    uploadReceipts.delete(key);
    return null;
  }
  return entry;
}

export function clearUploadReceipts() {
  uploadReceipts.clear();
}

/** 批量上传：活动名校验 → 传 Box → 落表；单张失败不回滚已成功的。 */
async function handleUpload(req, res, ctx, session) {
  enforceMediaLimit(req, ctx, session, 'upload', MEDIA_LIMIT_PER_HOUR);
  const status = box.boxStatus(ctx.config);
  if (!status.configured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_not_configured', message: '照片直传暂未开放（NJU Box 存储未配置）。' });
  }
  let form;
  try {
    form = await readMultipart(req, MAX_PHOTOS_PER_BATCH * (IMAGE_MAX_BYTES + THUMB_MAX_BYTES) + 64 * 1024);
  } catch (error) {
    return ctx.json(res, error.statusCode === 413 ? 413 : 400, { ok: false, code: 'media_form_unparseable', message: error.message });
  }
  const activityRaw = String(form.get('activity') || '').trim();
  const activity = sanitizeDirname(activityRaw);
  if (!activity) return ctx.json(res, 400, { ok: false, code: 'media_activity_missing', message: '请填写活动名称。' });
  // 中心：4 个固定中心之一，白名单校验。
  let center;
  try {
    center = assertCenter(form.get('center'));
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'media_center_invalid', message: error.message });
  }
  // v3 第 16 项：活动名必须来自该中心下的候选（禁手填）。
  // 走 60 秒缓存；一旦校验不过就强制回源重判一次，避免运营刚建完活动被缓存挡住。
  try {
    try {
      assertActivityAllowed(activity, center, await loadActivityCatalog(ctx));
    } catch (error) {
      if (!activityCache) throw error;
      assertActivityAllowed(activity, center, await loadActivityCatalog(ctx, { fresh: true }));
    }
  } catch (error) {
    return ctx.json(res, error.statusCode || 400, { ok: false, code: error.code || 'media_activity_not_allowed', message: error.message });
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

  const dir = mediaDir(ctx, center, activity);
  const client = await ctx.getBase();
  // 幂等：同一次上传重试（网关 504 后用户再点一次）不产生重复行。
  const clientUploadId = String(form.get('clientUploadId') || '').trim();
  const receiptKey = clientUploadId ? `${mediaLimitIdentity(session)}:${clientUploadId}` : '';
  const cached = readUploadReceipt(receiptKey);
  if (cached) {
    return ctx.json(res, 200, { ok: true, duplicate: true, photos: cached.photos, failed: cached.failed, config: mediaConfig(ctx) });
  }

  // 缩略图由前端 canvas 生成（480px JPEG），一张一请求时只有一张，按序对应即可。
  const thumbFiles = form.getAll('thumbnails').filter((item) => item && typeof item === 'object' && item.size > 0);
  const thumbFor = (index) => {
    if (!thumbFiles.length) return null;
    if (thumbFiles.length === files.length) return thumbFiles[index];
    // 旧页面一次发多张又不带对应缩略图时，宁可不存也不张冠李戴。
    return files.length === 1 ? thumbFiles[0] : null;
  };

  // 前端一张一个请求；这里仍用小并发池，兼容还在一次发多张的旧页面。
  const outcomes = await mapWithConcurrency(files, MEDIA_UPLOAD_CONCURRENCY, async (file, index) => {
    const mimeType = String(file.type || '').toLowerCase();
    if (!mimeType.startsWith('image/')) {
      return { failed: { filename: String(file.name || ''), reason: '仅支持图片文件' } };
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return { failed: { filename: String(file.name || ''), reason: '单张照片超过 20MB 上限' } };
    }
    const filename = sanitizeFilename(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = mediaIdentifier();
    let stored;
    try {
      // 跨境链路上偶发一次抖动就整张失败太脆；同名字覆盖（replace=1）重试是安全的。
      stored = await withSingleRetry(() => box.uploadBuffer(ctx.config, {
        dir,
        filename,
        buffer,
        contentType: mimeType,
      }));
    } catch (error) {
      return { failed: { filename, reason: error?.message || String(error) } };
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
      // v3：库身份由资料库令牌决定，库里记逻辑库名（main）便于迁移辨识。
      libraryId: status.library,
      path: stored.path,
      keepStatus: MEDIA_KEEP_STATUS.pending,
      uploader: ctx.businessAccountRef(session),
      uploadedAt: new Date().toISOString(),
    };
    // 缩略图与写表并行：都不阻塞对方，总时长基本等于较慢的那个。
    const thumbUpload = (async () => {
      const thumb = thumbFor(index);
      if (!thumb) return;
      if (thumb.size > THUMB_MAX_BYTES) return;
      try {
        const thumbBuffer = Buffer.from(await thumb.arrayBuffer());
        await box.uploadBuffer(ctx.config, {
          dir: `${dir}/${MEDIA_THUMB_DIR}`,
          // 用照片 ID 命名：批量更名改的是原文件名，缩略图不受影响。
          filename: `${id}.jpg`,
          buffer: thumbBuffer,
          contentType: 'image/jpeg',
        });
        writeThumbCache(id, thumbBuffer);
      } catch {
        // 预览是锦上添花：缩略图存不进去不影响照片本身，列表会退回图标。
      }
    })();
    try {
      await withSingleRetry(() => client.appendRow(ctx.tables.media, mediaRow(media)));
    } catch (error) {
      // 不再回滚删除 Box 文件：SeaTable 超时很可能「其实写成功了」，删文件会变成
      // 「表里有行、盘上没文件」，比留一个无主文件难收拾得多。文件留着，用户重试时
      // 同名覆盖 + clientUploadId 幂等，最坏只是多一个可人工清理的孤儿文件。
      await thumbUpload.catch(() => {});
      return { failed: { filename, reason: `元数据写入失败（照片已存盘，可重试）：${error?.message || error}` } };
    }
    await thumbUpload.catch(() => {});
    return { photo: mediaPortalView(media) };
  });

  const created = outcomes.filter((outcome) => outcome?.photo).map((outcome) => outcome.photo);
  const failed = outcomes
    .map((outcome) => outcome?.failed || (outcome?.error ? { filename: '', reason: outcome.error.message || String(outcome.error) } : null))
    .filter(Boolean);
  // 只缓存成功结果：全失败时不能缓存，否则用户修好网络重试会拿到上次的失败。
  if (created.length) rememberUploadReceipt(receiptKey, { photos: created, failed });
  // 新照片马上就会出现在列表里，缩略图索引不能还停在上一分钟。
  if (created.length) clearThumbRowsCache();
  await ctx.recordAudit(req, session, 'media.photo.upload', `${center}/${activity}`, created.length ? 'success' : 'failure', { center, activity, photographer, created: created.length, failed: failed.length });
  return ctx.json(res, created.length ? 201 : 500, {
    ok: created.length > 0,
    photos: created,
    failed,
    config: mediaConfig(ctx),
  });
}

/** 临时直链：本人照片才可取；链接每次现取（seafhttp 链接有时效）。 */
/** 缩略图缺失时的统一响应：给浏览器一个可缓存的空响应，前端据此回退图标。 */
function sendThumbMissing(res) {
  res.writeHead(404, {
    'content-type': 'application/json; charset=utf-8',
    // 让浏览器别再对同一张老照片反复请求；服务端另有 10 分钟负缓存。
    'cache-control': 'private, max-age=600',
  });
  res.end('{"ok":false,"code":"media_thumb_missing"}');
}

function sendThumb(res, buffer) {
  res.writeHead(200, {
    'content-type': 'image/jpeg',
    'content-length': String(buffer.length),
    // 缩略图内容不可变（同名覆盖只会发生在重传同名文件时），放一天。
    'cache-control': 'private, max-age=86400, immutable',
  });
  res.end(buffer);
}

/**
 * 解析一张照片的预览图，返回 { status, buffer? }。
 * 顺序：内存缓存 → 负缓存 → 查表 → 从 Box 取 `_thumbnails/<名>.jpg`。
 * `download` 可注入，便于测试覆盖缓存/归属/缺图三条分支。
 */
export async function resolveThumb(ctx, session, photoId, { download = box.downloadBuffer, allowAny = false } = {}) {
  // 先认人再看缓存：缓存是按 id 存的，若命中即返回，别人拿到 id 就能看图。
  // 这里的查表走 60 秒索引缓存，通常就是一次内存查找。
  // allowAny 只给控制台审核用（入口已由 requireConsoleAccess 把关）。
  let media = null;
  try {
    const rows = await listMediaRowsForThumb(ctx);
    const found = rows.find((row) => String(row['照片ID'] || '') === photoId);
    if (found) media = mediaFromRow(found);
  } catch {
    // 读表失败按「暂时没有」处理，不阻塞列表渲染。
    return { status: 404 };
  }
  if (!media) return { status: 404 };
  if (!allowAny && !ctx.ownsBusinessRef(session, media.uploader)) return { status: 403 };
  if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) return { status: 404 };

  const cached = readThumbCache(photoId);
  if (cached) return { status: 200, buffer: cached, cached: true };

  const missUntil = thumbMisses.get(photoId);
  if (missUntil && missUntil > Date.now()) return { status: 404 };

  const thumbPath = mediaThumbPath(media.path, media.id);
  if (!thumbPath) return { status: 404 };
  try {
    const buffer = await download(ctx.config, thumbPath, undefined, { maxBytes: THUMB_MAX_BYTES });
    writeThumbCache(media.id, buffer);
    return { status: 200, buffer };
  } catch {
    // 老照片没有缩略图：记下来，十分钟内不再打扰 Box。
    thumbMisses.set(photoId, Date.now() + THUMB_MISS_TTL_MS);
    return { status: 404 };
  }
}

/** GET /api/public/media/:id/thumb —— 只负责把 resolveThumb 的结果写出去。 */
async function handleThumb(res, ctx, session, photoId) {
  const result = await resolveThumb(ctx, session, photoId);
  if (result.status === 200) return sendThumb(res, result.buffer);
  if (result.status === 403) {
    return ctx.json(res, 403, { ok: false, code: 'media_not_owned', message: '仅上传人本人可以查看这张照片。' });
  }
  return sendThumbMissing(res);
}

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
    const link = await box.fileLink(ctx.config, media.path);
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

/**
 * 删除（v3 第 9 项）：**先申请、审核通过才真删**。
 * 上传人本人直接 DELETE 一律 409，引导走 delete-request；仅当删除申请「已通过」时才执行实体删除。
 */
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
  // 删除审核门禁：未获批准不得直删（管理员走 /api/console/media/:id/delete-review）。
  if (media.deleteStatus !== MEDIA_DELETE_STATUS.approved) {
    return ctx.json(res, 409, {
      ok: false,
      code: 'media_delete_review_required',
      message: media.deleteStatus === MEDIA_DELETE_STATUS.pending
        ? '删除申请正在审核中，请等待管理员处理。'
        : '删除照片需要先提交删除申请并经管理员审核通过。',
      deleteStatus: media.deleteStatus,
    });
  }
  return performDelete(req, res, ctx, session, found, media);
}

/** 审核通过后执行实体删除（Box 文件 + 表状态），供删除审核接口复用。 */
async function performDelete(req, res, ctx, session, row, media) {
  const status = box.boxStatus(ctx.config);
  if (status.configured && media.path) {
    try {
      await box.deleteFile(ctx.config, media.path);
      // 缩略图跟着删，免得盘上留一堆几十 KB 的孤儿；删不掉也不影响主流程。
      const thumbPath = mediaThumbPath(media.path, media.id);
      if (thumbPath) await box.deleteFile(ctx.config, thumbPath).catch(() => {});
    } catch (error) {
      await ctx.recordAudit(req, session, 'media.photo.delete', media.id, 'failure', { message: error?.message || String(error) });
      return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_request_failed', message: `NJU Box 删除失败：${error.message}` });
    }
  }
  thumbCache.delete(media.id);
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.media, row._id, {
    留用状态: MEDIA_KEEP_STATUS.deleted,
    删除申请状态: MEDIA_DELETE_STATUS.approved,
  });
  await ctx.recordAudit(req, session, 'media.photo.delete', media.id, 'success', { filename: media.filename });
  return ctx.json(res, 200, { ok: true });
}

/**
 * 控制台删除审核：管理员批准/驳回。
 * 批准 → 真删 Box 文件 + 标记 deleted；驳回 → 状态回未申请，照片保留。
 */
async function handleDeleteReview(req, res, ctx, session, photoId) {
  const body = await ctx.readJson(req);
  const decision = String(body.decision || '').trim();
  if (!['approve', 'reject'].includes(decision)) {
    return ctx.json(res, 400, { ok: false, code: 'media_delete_decision_invalid', message: '审核结果必须是 approve 或 reject。' });
  }
  const rows = await listMediaRows(ctx);
  const found = rows.find((row) => String(row['照片ID'] || '') === photoId);
  if (!found) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  const media = mediaFromRow(found);
  if (media.deleteStatus !== MEDIA_DELETE_STATUS.pending) {
    return ctx.json(res, 409, {
      ok: false, code: 'media_delete_not_pending',
      message: media.deleteStatus === MEDIA_DELETE_STATUS.approved ? '这张照片已经删除。' : '这张照片没有待审核的删除申请。',
      deleteStatus: media.deleteStatus,
    });
  }
  const reviewedAt = new Date().toISOString();
  const reviewer = ctx.businessAccountRef ? ctx.businessAccountRef(session) : session.username;
  if (decision === 'approve') {
    // 先落审核结论，再走实体删除（performDelete 会写 approved）。
    const client = await ctx.getBase();
    await client.updateRow(ctx.tables.media, found._id, { 删除审核人: reviewer, 删除审核时间: reviewedAt });
    return performDelete(req, res, ctx, session, found, media);
  }
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.media, found._id, {
    删除申请状态: MEDIA_DELETE_STATUS.rejected,
    删除审核人: reviewer,
    删除审核时间: reviewedAt,
  });
  await ctx.recordAudit(req, session, 'media.delete.review', photoId, 'success', { decision });
  return ctx.json(res, 200, { ok: true, decision, message: '已驳回删除申请，照片保留。' });
}

/** 控制台删除审核队列（待审核列表）。 */
async function handleDeleteQueue(res, ctx) {
  const rows = await listMediaRows(ctx);
  const pending = rows
    .map((row) => mediaFromRow(row))
    .filter((media) => media.deleteStatus === MEDIA_DELETE_STATUS.pending && media.keepStatus !== MEDIA_KEEP_STATUS.deleted)
    .sort((a, b) => String(b.pickRequestedAt || b.uploadedAt || '').localeCompare(String(a.pickRequestedAt || a.uploadedAt || '')));
  return ctx.json(res, 200, {
    ok: true,
    queue: pending.map((media) => ({
      ...mediaPortalView(media),
      uploader: media.uploader,
      path: media.path,
      center: media.center,
      activity: media.activity,
      deleteReason: media.deleteReason || '',
    })),
    total: pending.length,
  });
}

/* --------------------------------------------------------------------------
   N1 精选确认（控制台）：确认即**复制**到精选库，原库不删
   -------------------------------------------------------------------------- */

/**
 * 精选确认：逐张从主库下载 → 上传精选库 → 主库行写「已精选 + 精选库路径」。
 * 失败处理：精选库上传失败 → 状态回退 pending，**不回滚主库任何东西**。
 */
async function handlePickConfirm(req, res, ctx, session, batchCenter) {
  const libs = box.boxLibrariesStatus(ctx.config);
  if (!libs.picksConfigured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_picks_not_configured', message: '精选库（南大红会精选图片库）未配置令牌，无法确认精选。' });
  }
  const body = await ctx.readJson(req);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return ctx.json(res, 400, { ok: false, code: 'media_ids_missing', message: '请选择要确认精选的照片。' });
  const rows = await listMediaRows(ctx);
  const byId = new Map(rows.map((row) => [String(row['照片ID'] || ''), row]));
  const client = await ctx.getBase();
  const confirmed = [];
  const failed = [];
  const reviewer = ctx.businessAccountRef ? ctx.businessAccountRef(session) : session.username;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { failed.push({ id, reason: '照片不存在' }); continue; }
    const media = mediaFromRow(row);
    if (media.pickStatus !== MEDIA_PICK_STATUS.pending) {
      failed.push({ id, filename: media.filename, reason: `当前精选状态为「${media.pickStatus}」，仅「已申请待确认」可确认` });
      continue;
    }
    try {
      // 2026-10-28 定案：精选库从零开始用，只按「活动名」建一级文件夹
      // （/<活动名>/<文件名>），不再复刻主库的三级目录 —— 精选库是挑素材用的，
      // 按活动聚合更好找。目录由上传链路内部的 ensureDir 自动创建。
      const targetDir = picksStoragePath(media.activity).dir;
      const copied = await box.copyBetweenLibraries(ctx.config, {
        sourcePath: media.path,
        targetDir,
        filename: media.filename,
        sourceLibrary: box.NJUBOX_LIBRARIES.main,
        targetLibrary: box.NJUBOX_LIBRARIES.picks,
      });
      await client.updateRow(ctx.tables.media, row._id, {
        精选状态: MEDIA_PICK_STATUS.picked,
        精选确认人: reviewer,
        精选确认时间: new Date().toISOString(),
        精选库路径: copied.path,
        精选库ID: box.NJUBOX_LIBRARIES.picks,
      });
      confirmed.push({ id, filename: media.filename, pickPath: copied.path });
    } catch (error) {
      // 失败回退到「已申请待确认」，主库文件与路径保持不动。
      await client.updateRow(ctx.tables.media, row._id, { 精选状态: MEDIA_PICK_STATUS.pending }).catch(() => {});
      failed.push({ id, filename: media.filename, reason: error?.message || String(error) });
    }
  }
  await ctx.recordAudit(req, session, 'media.pick.confirm', batchCenter || 'media', confirmed.length ? 'success' : 'failure', { confirmed: confirmed.length, failed: failed.length });
  return ctx.json(res, confirmed.length ? 200 : 502, {
    ok: failed.length === 0,
    confirmed,
    failed,
    message: `已确认 ${confirmed.length} 张进入精选库（原库文件与路径未改动）${failed.length ? `，失败 ${failed.length} 张` : ''}。`,
  });
}

/** 控制台精选待确认队列。 */
async function handlePickQueue(res, ctx) {
  const rows = await listMediaRows(ctx);
  const pending = rows
    .map((row) => mediaFromRow(row))
    .filter((media) => media.pickStatus === MEDIA_PICK_STATUS.pending && media.keepStatus !== MEDIA_KEEP_STATUS.deleted)
    .sort((a, b) => String(b.pickRequestedAt || '').localeCompare(String(a.pickRequestedAt || '')));
  return ctx.json(res, 200, {
    ok: true,
    queue: pending.map((media) => ({ ...mediaPortalView(media), uploader: media.uploader, path: media.path })),
    total: pending.length,
    libraries: box.boxLibrariesStatus(ctx.config),
  });
}

/**
 * 控制台影像模块路由：/api/console/media*（登录 + 权限由 server.js 前置把关）。
 */
export async function consoleMediaRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/console\/media\/?/, ''));
  if (req.method === 'GET' && tail === 'picks') return handlePickQueue(res, ctx);
  if (req.method === 'POST' && tail === 'picks/confirm') return handlePickConfirm(req, res, ctx, ctx.session, 'batch');
  if (req.method === 'GET' && tail === 'deletes') return handleDeleteQueue(res, ctx);
  const deleteReview = tail.match(/^([A-Za-z0-9-]+)\/delete-review$/);
  if (req.method === 'POST' && deleteReview) return handleDeleteReview(req, res, ctx, ctx.session, deleteReview[1]);

  // 审核端要看到别人的照片：缩略图 / 原图直链 / 补缩略图。
  // 入口已由 server.js 的 requireConsoleAccess('outreach') 把关。
  const preview = tail.match(/^([A-Za-z0-9-]+)\/(thumb|link|raw)$/);
  if (preview) {
    const [, photoId, kind] = preview;
    if (kind === 'link' && req.method === 'GET') return handleConsoleLink(res, ctx, photoId);
    if (kind === 'thumb' && req.method === 'GET') return handleConsoleThumb(res, ctx, photoId);
    if (kind === 'raw' && req.method === 'GET') return handleConsoleRaw(res, ctx, photoId);
    // CSRF 已由 server.js 对本域所有写方法统一校验，这里不再重复（token 是一次性的）。
    if (kind === 'thumb' && req.method === 'POST') return handleConsoleThumbUpload(req, res, ctx, photoId);
  }
  return false;
}

/**
 * 单张原图代理（仅控制台、仅用于给老照片补缩略图）。
 *
 * 为什么需要它：浏览器要把图压成缩略图必须读 canvas 像素，而跨域图片会污染画布；
 * Box 直链又不带 CORS 头，CSP 的 connect-src 也只放行同源。所以由服务端转发一次。
 * 上限 8MB，超过就不代转（宁可没有预览，也不让 1 GiB 机器被大图拖死）。
 */
const MAX_RAW_PROXY_BYTES = 8 * 1024 * 1024;

async function handleConsoleRaw(res, ctx, photoId) {
  let media = null;
  try {
    media = await findMediaForConsole(ctx, photoId);
  } catch (error) {
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_request_failed', message: error.message });
  }
  if (!media) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  if (Number(media.size) > MAX_RAW_PROXY_BYTES) {
    return ctx.json(res, 413, {
      ok: false,
      code: 'media_raw_too_large',
      message: `照片超过 ${Math.floor(MAX_RAW_PROXY_BYTES / 1024 / 1024)}MB，无法在浏览器里生成预览。`,
    });
  }
  let buffer;
  try {
    buffer = await box.downloadBuffer(ctx.config, media.path, undefined, { maxBytes: MAX_RAW_PROXY_BYTES });
  } catch (error) {
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_download_failed', message: error.message });
  }
  res.writeHead(200, {
    'content-type': media.mimeType || 'image/jpeg',
    'content-length': String(buffer.length),
    // 回填只需要这一次，短缓存足够，也别让照片在共享缓存里停留太久。
    'cache-control': 'private, max-age=300',
  });
  res.end(buffer);
}

/** 审核端按 id 取照片（只读，走缩略图专用的 60 秒行索引）。 */
async function findMediaForConsole(ctx, photoId) {
  const rows = await listMediaRowsForThumb(ctx);
  const found = rows.find((row) => String(row['照片ID'] || '') === photoId);
  return found ? mediaFromRow(found) : null;
}

async function handleConsoleThumb(res, ctx, photoId) {
  const result = await resolveThumb(ctx, ctx.session, photoId, { allowAny: true });
  if (result.status === 200) return sendThumb(res, result.buffer);
  return sendThumbMissing(res);
}

/** 原图直链：抽屉里点「查看原图」用，和门户端同一个 Box 临时链接。 */
async function handleConsoleLink(res, ctx, photoId) {
  let media = null;
  try {
    media = await findMediaForConsole(ctx, photoId);
  } catch (error) {
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_request_failed', message: error.message });
  }
  if (!media) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  try {
    const link = await box.fileLink(ctx.config, media.path);
    return ctx.json(res, 200, { ok: true, id: media.id, filename: media.filename, link });
  } catch (error) {
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_request_failed', message: error.message });
  }
}

/**
 * 回填缩略图：审核端浏览器用 canvas 把原图压成 480px JPEG 后回存。
 * 老照片（本功能上线前上传的）借此逐步补齐，不必给服务器装图像库。
 */
async function handleConsoleThumbUpload(req, res, ctx, photoId) {
  enforceMediaLimit(req, ctx, ctx.session, 'thumb', 400);
  const status = box.boxStatus(ctx.config);
  if (!status.configured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_not_configured', message: '存储未配置，无法保存预览图。' });
  }
  let media = null;
  try {
    media = await findMediaForConsole(ctx, photoId);
  } catch (error) {
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_request_failed', message: error.message });
  }
  if (!media) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) {
    return ctx.json(res, 409, { ok: false, message: '照片已删除，不再生成预览。' });
  }
  const thumbPath = mediaThumbPath(media.path, media.id);
  if (!thumbPath) return ctx.json(res, 400, { ok: false, message: '照片路径无效，无法回填预览。' });

  let form;
  try {
    form = await readMultipart(req, THUMB_MAX_BYTES + 64 * 1024);
  } catch (error) {
    return ctx.json(res, error.statusCode === 413 ? 413 : 400, { ok: false, message: error.message });
  }
  const file = form.get('thumbnail');
  if (!file || typeof file !== 'object' || !file.size) {
    return ctx.json(res, 400, { ok: false, code: 'media_thumb_missing', message: '缺少缩略图内容。' });
  }
  if (file.size > THUMB_MAX_BYTES) {
    return ctx.json(res, 413, { ok: false, code: 'media_thumb_too_large', message: '缩略图超过 320KB 上限。' });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const slash = thumbPath.lastIndexOf('/');
  try {
    await box.uploadBuffer(ctx.config, {
      dir: thumbPath.slice(0, slash),
      filename: thumbPath.slice(slash + 1),
      buffer,
      contentType: 'image/jpeg',
    });
  } catch (error) {
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'njubox_upload_failed', message: `预览图保存失败：${error.message}` });
  }
  writeThumbCache(media.id, buffer);
  thumbMisses.delete(media.id);
  return ctx.json(res, 201, { ok: true, id: media.id, bytes: buffer.length });
}

/** 照片编号：PHO-{时间36}-{随机}，与 attachmentIdentifier 同构。 */
function mediaIdentifier() {
  return `PHO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
}

/**
 * 批量自动更名：<活动名>_<三位序号>.<原扩展名>。
 * 目标名冲突（Box 目录已有同名文件或批内重复）自动顺延序号；跨活动拒绝。
 */
async function handleBatchRename(req, res, ctx, session) {
  enforceMediaLimit(req, ctx, session, 'rename', MEDIA_RENAME_LIMIT_PER_HOUR);
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
  const folderKeys = new Set(targets.map(({ media }) => `${media.center || ''}\u0001${media.activity}`));
  if (folderKeys.size > 1) {
    return ctx.json(res, 400, { ok: false, code: 'media_rename_cross_activity', message: '一次只能对同一活动文件夹内的照片批量更名。' });
  }
  const first = targets[0].media;
  const activity = first.activity;
  const dir = mediaDir(ctx, first.center, activity);

  // 现有文件名集合（含批内将占用的名字），冲突自动顺延序号。
  const existing = new Set();
  const listing = await box.listDir(ctx.config, dir, { type: 'file' });
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
      const result = await box.renameFile(ctx.config, media.path, newName);
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

/* --------------------------------------------------------------------------
   v3 N1 双库精选（复制模式：原库不删，只往精选库放副本）
   -------------------------------------------------------------------------- */

/**
 * 提交精选申请：**强制 3-5 张**（MEDIA_PICK_MIN / MAX）。
 * 只允许本人照片；已精选/已申请待确认的不重复申请。
 */
async function handlePickRequest(req, res, ctx, session) {
  enforceMediaLimit(req, ctx, session, 'pick', MEDIA_PICK_LIMIT_PER_HOUR);
  const body = await ctx.readJson(req);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length < MEDIA_PICK_MIN || ids.length > MEDIA_PICK_MAX) {
    return ctx.json(res, 400, {
      ok: false,
      code: 'media_pick_count_invalid',
      message: `每批精选需勾选 ${MEDIA_PICK_MIN}-${MEDIA_PICK_MAX} 张照片（当前 ${ids.length} 张）。`,
      min: MEDIA_PICK_MIN,
      max: MEDIA_PICK_MAX,
      current: ids.length,
    });
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
    if (media.pickStatus === MEDIA_PICK_STATUS.picked) {
      return ctx.json(res, 409, { ok: false, code: 'media_pick_already', message: `照片 ${media.filename || id} 已在精选库。` });
    }
    if (media.pickStatus === MEDIA_PICK_STATUS.pending) {
      return ctx.json(res, 409, { ok: false, code: 'media_pick_pending', message: `照片 ${media.filename || id} 已提交精选申请，请等待确认。` });
    }
    targets.push({ row, media });
  }
  const requestedAt = new Date().toISOString();
  const client = await ctx.getBase();
  const updated = [];
  for (const { row, media } of targets) {
    await client.updateRow(ctx.tables.media, row._id, {
      精选状态: MEDIA_PICK_STATUS.pending,
      精选申请时间: requestedAt,
    });
    updated.push({ ...mediaPortalView(media), pickStatus: MEDIA_PICK_STATUS.pending });
  }
  await ctx.recordAudit(req, session, 'media.pick.request', targets[0].media.center, 'success', { count: targets.length });
  return ctx.json(res, 201, {
    ok: true,
    count: targets.length,
    photos: updated,
    message: `已提交 ${targets.length} 张精选申请，等待管理员确认。`,
  });
}

/** 我提交过的精选申请（按状态分组）。 */
async function handleMyPicks(res, ctx, session) {
  const rows = await listMediaRows(ctx);
  const mine = rows
    .map((row) => mediaFromRow(row))
    .filter((media) => ctx.ownsBusinessRef(session, media.uploader) && media.pickStatus !== MEDIA_PICK_STATUS.none)
    .sort((a, b) => String(b.pickRequestedAt || '').localeCompare(String(a.pickRequestedAt || '')));
  return ctx.json(res, 200, {
    ok: true,
    picks: mine.map(mediaPortalView),
    stats: {
      pending: mine.filter((m) => m.pickStatus === MEDIA_PICK_STATUS.pending).length,
      picked: mine.filter((m) => m.pickStatus === MEDIA_PICK_STATUS.picked).length,
      rejected: mine.filter((m) => m.pickStatus === MEDIA_PICK_STATUS.rejected).length,
    },
  });
}

/**
 * 批量下载：把选中的照片打包成一个 zip（store 模式，无压缩）。
 * 只允许本人照片；张数与总字节双重上限。
 */
async function handleDownloadZip(req, res, ctx, session) {
  enforceMediaLimit(req, ctx, session, 'download', MEDIA_DOWNLOAD_LIMIT_PER_HOUR);
  const status = box.boxStatus(ctx.config);
  if (!status.configured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_not_configured', message: '存储未配置，无法打包下载。' });
  }
  const body = await ctx.readJson(req);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return ctx.json(res, 400, { ok: false, code: 'media_ids_missing', message: '请选择要下载的照片。' });
  if (ids.length > MAX_ZIP_PER_BATCH) {
    return ctx.json(res, 413, { ok: false, code: 'media_batch_too_large', message: `单次最多打包 ${MAX_ZIP_PER_BATCH} 张。` });
  }
  const rows = await listMediaRows(ctx);
  const byId = new Map(rows.map((row) => [String(row['照片ID'] || ''), row]));
  const targets = [];
  let totalBytes = 0;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return ctx.json(res, 404, { ok: false, code: 'media_not_found', message: `照片 ${id} 不存在。` });
    const media = mediaFromRow(row);
    if (!ctx.ownsBusinessRef(session, media.uploader)) {
      return ctx.json(res, 403, { ok: false, code: 'media_not_owned', message: `照片 ${media.filename || id} 不属于当前账号。` });
    }
    if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) continue;
    totalBytes += Number(media.size) || 0;
    targets.push(media);
  }
  if (!targets.length) return ctx.json(res, 404, { ok: false, code: 'media_not_found', message: '没有可下载的照片。' });
  if (totalBytes > MAX_ZIP_BYTES) {
    return ctx.json(res, 413, {
      ok: false, code: 'media_zip_too_large',
      message: `打包总量 ${(totalBytes / 1024 / 1024).toFixed(1)}MB 超过 ${Math.floor(MAX_ZIP_BYTES / 1024 / 1024)}MB 上限，请分批下载。`,
    });
  }

  // 逐张拉取直链内容；单张失败不中断，改在响应头报告。
  const entries = [];
  const skipped = [];
  for (const media of targets) {
    try {
      const link = await box.fileLink(ctx.config, media.path);
      const response = await observedFetch('njubox',globalThis.fetch,link);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      entries.push({ name: media.filename || `photo-${media.id}`, buffer });
    } catch (error) {
      skipped.push({ id: media.id, filename: media.filename, reason: error?.message || String(error) });
    }
  }
  if (!entries.length) {
    return ctx.json(res, 502, { ok: false, code: 'media_zip_empty', message: '所有照片都拉取失败，未生成压缩包。', skipped });
  }
  const archive = buildZip(entries);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const filename = `影像素材-${stamp}.zip`;
  await ctx.recordAudit(req, session, 'media.photo.download', filename, 'success', { packed: entries.length, skipped: skipped.length, bytes: archive.length });
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'content-length': String(archive.length),
    'cache-control': 'no-store',
    ...(skipped.length ? { 'x-media-skipped': String(skipped.length) } : {}),
  });
  res.end(archive);
  return true;
}

/* --------------------------------------------------------------------------
   第 9 项：图片删除审核（申请 → 审核通过才真删）
   -------------------------------------------------------------------------- */

/** 申请删除：本人照片；进入「待审核」，此时原 DELETE 接口会拒绝（409）。 */
async function handleDeleteRequest(req, res, ctx, session, photoId) {
  const body = await ctx.readJson(req);
  const reason = String(body.reason || '').trim();
  if (!reason) {
    return ctx.json(res, 400, { ok: false, code: 'media_delete_reason_required', message: '请填写删除理由，便于审核人判断。' });
  }
  const rows = await listMediaRows(ctx);
  const found = rows.find((row) => String(row['照片ID'] || '') === photoId);
  if (!found) return ctx.json(res, 404, { ok: false, message: '照片不存在。' });
  const media = mediaFromRow(found);
  if (!ctx.ownsBusinessRef(session, media.uploader)) {
    return ctx.json(res, 403, { ok: false, code: 'media_not_owned', message: '仅上传人本人可以申请删除这张照片。' });
  }
  if (media.keepStatus === MEDIA_KEEP_STATUS.deleted) {
    return ctx.json(res, 409, { ok: false, code: 'media_deleted', message: '照片已删除。' });
  }
  if (media.deleteStatus === MEDIA_DELETE_STATUS.pending) {
    return ctx.json(res, 409, { ok: false, code: 'media_delete_pending', message: '这张照片的删除申请已在审核中。' });
  }
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.media, found._id, {
    删除申请状态: MEDIA_DELETE_STATUS.pending,
    删除理由: reason,
  });
  await ctx.recordAudit(req, session, 'media.delete.request', photoId, 'success', { filename: media.filename });
  return ctx.json(res, 201, {
    ok: true,
    photo: { ...mediaPortalView(media), deleteStatus: MEDIA_DELETE_STATUS.pending, deleteReason: reason },
    message: '删除申请已提交，等待管理员审核。审核通过前照片仍保留。',
  });
}

/* --------------------------------------------------------------------------
   最小 ZIP 写入器（store 模式，无压缩）—— 与 review.js 同构，供打包下载用
   -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 用 store 模式拼一个合法 ZIP：{ name, buffer }[] → Buffer。 */
export function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const enc = (name) => Buffer.from(name, 'utf8');
  for (const entry of entries || []) {
    const nameBuf = enc(entry.name);
    const data = Buffer.isBuffer(entry.buffer) ? entry.buffer : Buffer.from(entry.buffer || '');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}
