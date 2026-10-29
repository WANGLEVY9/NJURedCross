/**
 * NJU Box（box.nju.edu.cn，Seafile 13 企业版）存储客户端 —— v3 起改为
 * 「资料库级 Token」接入方式（via-repo-token），支持多库（主库 + 精选库）。
 *
 * ============================ 契约要点 ============================
 * 全部经 2026-10-10 真实环境逐接口探测验证（含成功与失败路径）。
 *
 *   · 鉴权：Authorization: Bearer <资料库API令牌>
 *     —— 旧版用的是账号级 Token + `Authorization: Token <T>`，两套不通用。
 *        账号级 Token 打在资料库级端点上会 401「Token inactive or deleted」。
 *   · 端点前缀：/api/v2.1/via-repo-token/...
 *     —— 令牌已绑定单一资料库，**所有请求不再传 repoId**。
 *   · 库信息：GET    {P}/repo-info/
 *   · 列目录：GET    {P}/dir/?path=/路径
 *             返回 { ..., dirent_list:[{type:'dir'|'file', name, size, mtime, id}] }
 *   · 建目录：POST   {P}/dir/?path=/路径     body: operation=mkdir（逐级）
 *             ⚠️ 目录已存在时 **不报错**，而是静默创建「名字 (1)」兄弟目录！
 *                因此调用前必须先 列目录 判存在，不能靠错误码兜底。
 *   · 上传直链：GET  {P}/upload-link/?path=/目录&replace=0|1
 *             返回 JSON 字符串（带引号，需 unquote）："https://.../seafhttp/upload-api/<id>?replace=1"
 *             目标目录不存在时 404；不存在会建目录的场景请先 ensureDir。
 *   · 上传文件：POST <上传直链>   multipart：file / parent_dir / replace
 *             返回裸 commit id 字符串（带引号，需 unquote）。
 *   · 下载直链：GET  {P}/download-link/?path=/文件
 *   · 更名文件：POST {P}/file/?path=/文件  body: operation=rename&newname=新名
 *   · 删文件：  DELETE {P}/file/?path=/文件   → {"success":true,...}
 *   · 删目录：  DELETE {P}/dir/?path=/目录    → 目录**非空也可删**（递归），幂等性由调用方保证
 *
 * 未配置降级：Token 为空时 boxStatus().configured=false，所有写入函数抛
 * NjuboxStorageNotConfigured（503），路由层退回「贴链接」模式，与 oss.js 对齐。
 *
 * 测试：所有请求经 config.njuboxFetch（默认全局 fetch），单测可注入 mock。
 */

import { createHash } from 'node:crypto';
import { observedFetch } from '../observability.js';
import { ATTACHMENT_PROVIDER_NJUBOX, sanitizeFilename } from './store.js';

export const NJUBOX_DEFAULT_SERVER = 'https://box.nju.edu.cn';

/**
 * 单张上传的字节落地超时。必须显著小于网关的 proxy_read_timeout（生产 180s），
 * 否则会出现「网关先 504、后端还在传」——用户看到失败但照片其实已入库。
 */
const UPLOAD_TIMEOUT_MS = Math.max(5000, Number(process.env.NJUBOX_UPLOAD_TIMEOUT_MS || 60000));

/**
 * 已确认存在的目录（libraryId + path → 过期时间）。
 * ensureDir 会逐级列目录（/中心/活动/活动-照片 要 3 次往返），批量上传时
 * 每张都重复一遍是纯浪费；缓存后整批只在第一张付一次代价。
 *
 * 两条保守约束：
 *   1. 注入 njuboxFetch 的调用方（单测 mock）不缓存 —— mock 往往每次都是空库；
 *   2. 30 分钟过期 —— 目录在 Box 里被删掉后能自愈，不需要重启进程。
 */
const ensuredDirectories = new Map();
const ENSURED_DIRECTORY_LIMIT = 500;
const ENSURED_DIRECTORY_TTL_MS = 30 * 60 * 1000;

/** 测试与运维用：清空目录缓存（外部删库后不必重启进程）。 */
export function clearEnsuredDirectories() {
  ensuredDirectories.clear();
}

/** 资料库级 Token 端点前缀（令牌自带库身份，无需 repoId）。 */
export const NJUBOX_VIA_REPO_TOKEN_PREFIX = '/api/v2.1/via-repo-token';

/**
 * 库角色常量：
 *   main   —— 主库「平台文件存储」：投稿附件、影像素材、宣传展示封面全落这里
 *   picks  —— 精选库「南大红会精选图片库」：精选照片的二次复制目标（原库不删）
 */
export const NJUBOX_LIBRARIES = Object.freeze({ main: 'main', picks: 'picks' });

/**
 * 默认目录布局（可在 .env 覆盖）。
 * v3.1（2026-10-11）起：影像与投稿的顶层改为「部门」（五个中心），不再有
 * 固定的 /影像素材、/内容投稿 父目录；故这两项默认留空。
 * 展示封面沿用 /宣传展示。
 */
export const NJUBOX_DEFAULT_DIRS = Object.freeze({
  showcase: '/宣传展示',
  submissions: '',
  media: '',
});

export class NjuboxStorageNotConfigured extends Error {
  constructor(message = 'NJU Box 存储未配置（缺少资料库 API 令牌）。') {
    super(message);
    this.name = 'NjuboxStorageNotConfigured';
    this.code = 'njubox_not_configured';
    this.statusCode = 503;
  }
}

export class NjuboxStorageError extends Error {
  constructor(message, { statusCode = 502, code = 'njubox_request_failed', detail = '' } = {}) {
    super(message);
    this.name = 'NjuboxStorageError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function trimSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * 解析单个库的配置。
 * libraryId 为空串以外的值或 'main' → 主库；'picks' → 精选库。
 */
function resolveLibrary(config = {}, libraryId = NJUBOX_LIBRARIES.main) {
  const wantsPicks = libraryId === NJUBOX_LIBRARIES.picks;
  return {
    id: wantsPicks ? NJUBOX_LIBRARIES.picks : NJUBOX_LIBRARIES.main,
    name: wantsPicks ? '南大红会精选图片库' : '平台文件存储',
    token: String((wantsPicks ? config.njuboxPicksToken : config.njuboxToken) || '').trim(),
  };
}

function resolveConfig(config = {}) {
  return {
    serverUrl: trimSlashes(config.njuboxServerUrl || NJUBOX_DEFAULT_SERVER),
    dirs: {
      submissions: config.njuboxSubmissionsDir || NJUBOX_DEFAULT_DIRS.submissions,
      media: config.njuboxMediaDir || NJUBOX_DEFAULT_DIRS.media,
      showcase: config.njuboxShowcaseDir || NJUBOX_DEFAULT_DIRS.showcase,
    },
    fetch: (...args) => observedFetch('njubox',config.njuboxFetch || globalThis.fetch,...args),
  };
}

/** 存储配置状态：路由层据此决定开放直传还是降级为「贴链接」。 */
export function boxStatus(config = {}, libraryId = NJUBOX_LIBRARIES.main) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  return {
    provider: ATTACHMENT_PROVIDER_NJUBOX,
    library: library.id,
    libraryName: library.name,
    configured: Boolean(library.token),
    serverUrl: resolved.serverUrl,
    hasToken: Boolean(library.token),
    dirs: resolved.dirs,
  };
}

/** 双库总状态（前端公告用）：主库决定能否直传，精选库决定能否「复制到素材库」。 */
export function boxLibrariesStatus(config = {}) {
  const main = boxStatus(config, NJUBOX_LIBRARIES.main);
  const picks = boxStatus(config, NJUBOX_LIBRARIES.picks);
  return { main, picks, configured: main.configured, picksConfigured: picks.configured };
}

function assertConfigured(library) {
  if (!library.token) throw new NjuboxStorageNotConfigured();
}

/**
 * 底层请求。path 为 {P}/... 之后的相对端点，例如 `/dir/?path=%2F`。
 * responseType: text（默认）| json
 */
async function apiRequest(resolved, library, endpoint, { method = 'GET', form = null, responseType = 'text' } = {}) {
  const headers = { Authorization: `Bearer ${library.token}` };
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  let response;
  try {
    response = await resolved.fetch(`${resolved.serverUrl}${NJUBOX_VIA_REPO_TOKEN_PREFIX}${endpoint}`, {
      method,
      headers,
      body: form ?? undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new NjuboxStorageError(`NJU Box 网络请求失败：${error?.message || error}`, {
      code: 'njubox_network_error',
      detail: String(error),
    });
  }
  const bodyText = await response.text();
  if (!response.ok) {
    throw new NjuboxStorageError(`NJU Box 接口返回 HTTP ${response.status}`, {
      statusCode: 502,
      code: response.status === 404 ? 'njubox_not_found' : 'njubox_request_failed',
      detail: bodyText.slice(0, 300),
    });
  }
  if (responseType === 'json') {
    try { return JSON.parse(bodyText); } catch { return bodyText; }
  }
  return bodyText;
}

/** Seafile 部分端点返回带引号的纯 JSON 字符串（如 upload-link 的 URL），统一剥引号。 */
function unquote(value) {
  return String(value || '').replace(/^"|"$/g, '').trim();
}

function dirEndpoint(dirPath) {
  return `/dir/?path=${encodeURIComponent(dirPath)}`;
}

/**
 * 列目录一次（不吞 404）：返回 dirent_list 数组，目录不存在抛 njubox_not_found。
 * 底层复用，避免 ensureDir 与 listDir 互相递归。
 */
async function listDirRaw(resolved, library, dirPath) {
  const raw = await apiRequest(resolved, library, dirEndpoint(dirPath), { responseType: 'json' });
  const entries = Array.isArray(raw) ? raw : raw?.dirent_list;
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    name: String(entry.name || ''),
    type: entry.type === 'dir' ? 'dir' : 'file',
    size: Number(entry.size) || 0,
    mtime: entry.mtime || null,
    id: entry.id ? String(entry.id) : '',
  }));
}

/**
 * 逐级建目录（Seafile 无递归建目录，必须逐层）。
 *
 * ⚠️ 关键坑：**重复 mkdir 不会报错**，而是创建「名字 (1)」兄弟目录。
 * 所以每层必须先 listDirRaw 判存在，存在即跳过；不存在才 mkdir。
 *
 * 已存在的层返回 false，新建的层返回 true；路径必须以 / 开头。
 */
export async function ensureDir(config, dirPath, libraryId = NJUBOX_LIBRARIES.main) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  assertConfigured(library);
  const clean = String(dirPath || '').trim();
  if (!clean.startsWith('/')) throw new NjuboxStorageError(`目录路径必须以 / 开头：${clean}`);
  const segments = clean.split('/').filter(Boolean);
  let current = '';
  const created = [];
  const existing = [];
  for (const segment of segments) {
    const parent = current || '/';
    current += `/${segment}`;
    let present = false;
    try {
      const entries = await listDirRaw(resolved, library, parent);
      present = entries.some((entry) => entry.type === 'dir' && entry.name === segment);
    } catch (error) {
      // 父目录不存在（首次创建链路时会走到这里）→ 视为不存在，继续建。
      if (!(error instanceof NjuboxStorageError && error.code === 'njubox_not_found')) throw error;
    }
    if (present) {
      existing.push(current);
      continue;
    }
    await apiRequest(resolved, library, dirEndpoint(current), {
      method: 'POST',
      form: new URLSearchParams({ operation: 'mkdir' }).toString(),
    });
    created.push(current);
  }
  return { created, existing, path: current };
}

/** 确保根目录存在（幂等，供上传前调用）。 */
export async function ensureRoot(config, rootDir, libraryId = NJUBOX_LIBRARIES.main) {
  return ensureDir(config, rootDir, libraryId);
}

/**
 * 上传缓冲区到 {dir}/{relativePath}/{filename}（relativePath 可为空或含子目录）。
 * 目标目录不存在时先逐级补建再上传（避免 upload-link 404）。
 * 返回 { fileId, path }。
 */
export async function uploadBuffer(config, { dir, relativePath = '', filename, buffer, contentType = 'application/octet-stream', libraryId = NJUBOX_LIBRARIES.main }) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  assertConfigured(library);
  const parent = String(dir || '/').trim() || '/';
  const relative = String(relativePath || '').replace(/^\/+|\/+$/g, '');
  const targetDir = relative ? `${parent === '/' ? '' : parent}/${relative}` : parent;
  const safeName = sanitizeFilename(filename);
  if (!safeName) throw new NjuboxStorageError('文件名无效');

  // 目录必先存在：Seafile 的 upload-link 对不存在目录直接 404。
  // 同一进程内已确认过的目录不再重复「逐级列目录」；注入 mock fetch 时不缓存。
  const ensuredKey = `${libraryId}\u0000${targetDir}`;
  const cacheable = typeof config?.njuboxFetch !== 'function';
  const cachedUntil = cacheable ? Number(ensuredDirectories.get(ensuredKey) || 0) : 0;
  if (!cachedUntil || cachedUntil <= Date.now()) {
    await ensureDir(config, targetDir, libraryId);
    if (cacheable) {
      if (ensuredDirectories.size >= ENSURED_DIRECTORY_LIMIT) ensuredDirectories.clear();
      ensuredDirectories.set(ensuredKey, Date.now() + ENSURED_DIRECTORY_TTL_MS);
    }
  }

  const linkRaw = await apiRequest(resolved, library, `/upload-link/?path=${encodeURIComponent(targetDir)}&replace=1`);
  const link = unquote(linkRaw);
  if (!link) throw new NjuboxStorageError('NJU Box 未返回上传直链', { detail: 'empty upload link' });

  const form = new FormData();
  form.append('parent_dir', targetDir);
  form.append('replace', '1');
  form.append('file', new Blob([buffer], { type: contentType }), safeName);
  let response;
  try {
    response = await resolved.fetch(link, {
      method: 'POST',
      headers: { Authorization: `Bearer ${library.token}` },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new NjuboxStorageError(`NJU Box 上传失败：${error?.message || error}`, { code: 'njubox_network_error' });
  }
  const bodyText = (await response.text()).trim();
  if (!response.ok) {
    throw new NjuboxStorageError(`NJU Box 上传被拒绝（HTTP ${response.status}）`, {
      code: 'njubox_upload_failed',
      detail: bodyText.slice(0, 300),
    });
  }
  const parts = [targetDir, safeName].map((part) => `/${String(part).replace(/^\/+|\/+$/g, '')}`).join('');
  return { fileId: unquote(bodyText), path: parts, dir: targetDir };
}

/** 列目录：返回 [{ name, type, size, mtime, id }]；目录不存在返回 null。 */
export async function listDir(config, dirPath, { type = 'all', libraryId = NJUBOX_LIBRARIES.main } = {}) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  assertConfigured(library);
  try {
    const entries = await listDirRaw(resolved, library, dirPath);
    if (type === 'file') return entries.filter((entry) => entry.type === 'file');
    if (type === 'dir') return entries.filter((entry) => entry.type === 'dir');
    return entries;
  } catch (error) {
    if (error instanceof NjuboxStorageError && error.code === 'njubox_not_found') return null;
    throw error;
  }
}

/** 目录是否存在（幂等探测，供建目录/上传前后的语义判断）。 */
export async function dirExists(config, dirPath, libraryId = NJUBOX_LIBRARIES.main) {
  const listing = await listDir(config, dirPath, { libraryId });
  return listing !== null;
}

/** 文件临时下载直链（seafhttp 链接有时效；每次展示现取）。 */
export async function fileLink(config, filePath, libraryId = NJUBOX_LIBRARIES.main) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  assertConfigured(library);
  const raw = await apiRequest(resolved, library, `/download-link/?path=${encodeURIComponent(filePath)}`);
  return unquote(raw);
}

/** 文件更名（同目录内），返回新的完整路径。 */
export async function renameFile(config, filePath, newFilename, libraryId = NJUBOX_LIBRARIES.main) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  assertConfigured(library);
  const safeName = sanitizeFilename(newFilename);
  if (!safeName) throw new NjuboxStorageError('新文件名无效');
  const parent = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
  await apiRequest(resolved, library, `/file/?path=${encodeURIComponent(filePath)}`, {
    method: 'POST',
    form: new URLSearchParams({ operation: 'rename', newname: safeName }).toString(),
  });
  return { path: `${parent}/${safeName}`, filename: safeName };
}

/** 删除文件；目标不存在视为已删除（幂等）。 */
export async function deleteFile(config, filePath, libraryId = NJUBOX_LIBRARIES.main) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  assertConfigured(library);
  try {
    await apiRequest(resolved, library, `/file/?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (error instanceof NjuboxStorageError && error.code === 'njubox_not_found') return false;
    throw error;
  }
}

/**
 * 删除目录（Seafile 递归删除，非空亦可）；目录不存在视为已删除（幂等）。
 * ⚠️ 本函数**不做空目录判断**，调用方需自行确保删除意图（如附件目录清空后再删）。
 */
export async function deleteDir(config, dirPath, libraryId = NJUBOX_LIBRARIES.main) {
  const resolved = resolveConfig(config);
  const library = resolveLibrary(config, libraryId);
  assertConfigured(library);
  try {
    await apiRequest(resolved, library, dirEndpoint(dirPath), { method: 'DELETE' });
    return true;
  } catch (error) {
    if (error instanceof NjuboxStorageError && error.code === 'njubox_not_found') return false;
    throw error;
  }
}

/**
 * 跨库复制：把主库里的文件复制到精选库（原库不删）。
 * Seafile 无原生跨库 copy，采用「读下载直链 → 取流 → 上传到目标库」。
 * 返回精选库中的落点路径与大小。
 */
export async function copyBetweenLibraries(config, { sourcePath, targetDir, filename, sourceLibrary = NJUBOX_LIBRARIES.main, targetLibrary = NJUBOX_LIBRARIES.picks }) {
  const resolved = resolveConfig(config);
  const sourceLib = resolveLibrary(config, sourceLibrary);
  const targetLib = resolveLibrary(config, targetLibrary);
  assertConfigured(sourceLib);
  assertConfigured(targetLib);
  const link = await fileLink(config, sourcePath, sourceLibrary);
  let response;
  try {
    response = await resolved.fetch(link, { signal: AbortSignal.timeout(120000) });
  } catch (error) {
    throw new NjuboxStorageError(`NJU Box 复制读取失败：${error?.message || error}`, { code: 'njubox_network_error' });
  }
  if (!response.ok) {
    throw new NjuboxStorageError(`NJU Box 复制读取被拒绝（HTTP ${response.status}）`, { code: 'njubox_copy_failed' });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const stored = await uploadBuffer(config, {
    dir: targetDir,
    filename,
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    libraryId: targetLibrary,
  });
  return { path: stored.path, size: buffer.length };
}

/** SHA-256 校验和（十六进制）。 */
export function checksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
