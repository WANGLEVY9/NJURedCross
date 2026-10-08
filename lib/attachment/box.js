/**
 * NJU Box（box.nju.edu.cn，Seafile 13 企业版）存储客户端 —— 内容投稿 v2 的
 * 唯一文件存储通道（Table 元数据 + Box 文件云存储 双备份架构）。
 *
 * 契约要点（全部经 2026-10-06 真实环境探测验证）：
 *   · 鉴权：Authorization: Token <NJUBOX_API_TOKEN>
 *   · 建目录：POST /api2/repos/{id}/dir/?p=/路径，body operation=mkdir；
 *     只能逐级创建（父目录不存在直接 404），已存在返回 400（可容忍）
 *   · 上传：先 GET /api2/repos/{id}/upload-link/?p=/目录 拿一次性直链，
 *     再 POST 表单 parent_dir + relative_path + file（relative_path 自动逐级建层）
 *     —— 注意查询参数名是 p，不是 path（lib/events/njubox.js 里的 path 是
 *     潜伏 bug：服务器会按根目录签发链接，上传时 Parent dir doesn't match）
 *   · 列目录：GET /api2/repos/{id}/dir/?p=/路径（t=f 只列文件，t=d 只列目录）
 *   · 下载直链：GET /api2/repos/{id}/file/?p=/文件&reuse=1（临时链接）
 *   · 更名：POST /api2/repos/{id}/file/?p=/旧路径，body operation=rename&newname=新名
 *   · 删除：DELETE /api2/repos/{id}/file/?p=/文件 或 DELETE dir/?p=/目录
 *
 * 未配置降级：Token/库 ID 为空时 boxStatus().configured=false，所有写入函数抛
 * NjuboxStorageNotConfigured（503），路由层退回「贴链接」模式，与 oss.js 对齐。
 *
 * 测试：所有请求经 config.njuboxFetch（默认全局 fetch），单测可注入 mock。
 */

import { createHash } from 'node:crypto';
import { ATTACHMENT_PROVIDER_NJUBOX, sanitizeFilename } from './store.js';

export const NJUBOX_DEFAULT_SERVER = 'https://box.nju.edu.cn';

/** 默认目录布局（可在 .env 覆盖；路径不写死在业务代码里，兼容后续公用库迁移）。 */
export const NJUBOX_DEFAULT_DIRS = Object.freeze({
  submissions: '/内容投稿',
  media: '/影像素材',
  showcase: '/宣传展示',
});

export class NjuboxStorageNotConfigured extends Error {
  constructor(message = 'NJU Box 存储未配置（缺少 API Token 或资料库 ID）。') {
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

function resolveConfig(config = {}) {
  return {
    serverUrl: trimSlashes(config.njuboxServerUrl || NJUBOX_DEFAULT_SERVER),
    token: String(config.njuboxToken || '').trim(),
    repoId: String(config.njuboxRepoId || '').trim(),
    dirs: {
      submissions: config.njuboxSubmissionsDir || NJUBOX_DEFAULT_DIRS.submissions,
      media: config.njuboxMediaDir || NJUBOX_DEFAULT_DIRS.media,
      showcase: config.njuboxShowcaseDir || NJUBOX_DEFAULT_DIRS.showcase,
    },
    fetch: config.njuboxFetch || ((...args) => fetch(...args)),
  };
}

/** 存储配置状态：路由层据此决定开放直传还是降级为「贴链接」。 */
export function boxStatus(config = {}) {
  const resolved = resolveConfig(config);
  return {
    provider: ATTACHMENT_PROVIDER_NJUBOX,
    configured: Boolean(resolved.token && resolved.repoId),
    serverUrl: resolved.serverUrl,
    hasToken: Boolean(resolved.token),
    repoId: resolved.repoId,
    dirs: resolved.dirs,
  };
}

function assertConfigured(resolved) {
  if (!resolved.token || !resolved.repoId) throw new NjuboxStorageNotConfigured();
}

async function apiRequest(resolved, path, { method = 'GET', form = null, text = null, responseType = 'text' } = {}) {
  const headers = { Authorization: `Token ${resolved.token}` };
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  let response;
  try {
    response = await resolved.fetch(`${resolved.serverUrl}${path}`, {
      method,
      headers,
      body: form ?? text ?? undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new NjuboxStorageError(`NJU Box 网络请求失败：${error?.message || error}`, { code: 'njubox_network_error', detail: String(error) });
  }
  const bodyText = await response.text();
  if (!response.ok) {
    // 400 且带 Folder/File already exists 语义时由调用方自行容忍；这里统一抛错。
    throw new NjuboxStorageError(`NJU Box 接口返回 HTTP ${response.status}`, {
      statusCode: response.status === 401 || response.status === 403 ? 502 : 502,
      code: response.status === 404 ? 'njubox_not_found' : 'njubox_request_failed',
      detail: bodyText.slice(0, 300),
    });
  }
  if (responseType === 'json') {
    try { return JSON.parse(bodyText); } catch { return bodyText; }
  }
  return bodyText;
}

function unquote(value) {
  return String(value || '').replace(/^"|"$/g, '').trim();
}

/**
 * 逐级建目录（父目录必须逐层存在，这是 Seafile 的硬约束）。
 * 已存在的层返回 false，新建的层返回 true；路径必须以 / 开头。
 */
export async function ensureDir(config, repoId, dirPath) {
  const resolved = resolveConfig(config);
  assertConfigured(resolved);
  const clean = String(dirPath || '').trim();
  if (!clean.startsWith('/')) throw new NjuboxStorageError(`目录路径必须以 / 开头：${clean}`);
  const segments = clean.split('/').filter(Boolean);
  let current = '';
  const created = [];
  for (const segment of segments) {
    current += `/${segment}`;
    try {
      await apiRequest(resolved, `/api2/repos/${encodeURIComponent(repoId)}/dir/?p=${encodeURIComponent(current)}`, {
        method: 'POST',
        form: new URLSearchParams({ operation: 'mkdir' }).toString(),
      });
      created.push(current);
    } catch (error) {
      const detail = error instanceof NjuboxStorageError ? error.detail : String(error);
      if (!/exists/i.test(detail)) throw error;
      // 已存在：继续下一层
    }
  }
  return { created, path: current };
}

/** 确保根目录存在（幂等，供上传前调用；内部目录由 relative_path 自动创建）。 */
export async function ensureRoot(config, repoId, rootDir) {
  return ensureDir(config, repoId, rootDir);
}

/**
 * 上传缓冲区到 {dir}/{relativePath}/{filename}（relativePath 可为空或含子目录，
 * Seafile 会自动建层）。返回 { fileId, path }。
 */
export async function uploadBuffer(config, { repoId, dir, relativePath = '', filename, buffer, contentType = 'application/octet-stream' }) {
  const resolved = resolveConfig(config);
  assertConfigured(resolved);
  const id = String(repoId || resolved.repoId);
  if (!id) throw new NjuboxStorageNotConfigured();
  const parent = String(dir || '/').trim() || '/';
  const safeName = sanitizeFilename(filename);
  if (!safeName) throw new NjuboxStorageError('文件名无效');

  let link;
  try {
    const linkRaw = await apiRequest(resolved, `/api2/repos/${encodeURIComponent(id)}/upload-link/?p=${encodeURIComponent(parent)}`);
    link = unquote(linkRaw);
  } catch (error) {
    // 目标目录不存在时 Seafile 对 upload-link 返回 404：逐级补建后重试一次。
    if (error instanceof NjuboxStorageError && error.code === 'njubox_not_found') {
      await ensureDir(config, id, parent);
      const retryRaw = await apiRequest(resolved, `/api2/repos/${encodeURIComponent(id)}/upload-link/?p=${encodeURIComponent(parent)}`);
      link = unquote(retryRaw);
    } else {
      throw error;
    }
  }
  if (!link) throw new NjuboxStorageError('NJU Box 未返回上传直链', { detail: 'empty upload link' });

  const form = new FormData();
  form.append('parent_dir', parent);
  const relative = String(relativePath || '').replace(/^\/+|\/+$/g, '');
  if (relative) form.append('relative_path', relative);
  form.append('file', new Blob([buffer], { type: contentType }), safeName);
  let response;
  try {
    response = await resolved.fetch(link, {
      method: 'POST',
      headers: { Authorization: `Token ${resolved.token}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    throw new NjuboxStorageError(`NJU Box 上传失败：${error?.message || error}`, { code: 'njubox_network_error' });
  }
  const bodyText = (await response.text()).trim();
  if (!response.ok) {
    throw new NjuboxStorageError(`NJU Box 上传被拒绝（HTTP ${response.status}）`, { code: 'njubox_upload_failed', detail: bodyText.slice(0, 300) });
  }
  const parts = [parent, relative, safeName].filter(Boolean).map((part) => `/${part.replace(/^\/+|\/+$/g, '')}`).join('');
  return { fileId: unquote(bodyText), path: parts || `/${safeName}` };
}

/** 列目录：返回 [{ name, type, size }]；目录不存在返回 null（由调用方决定语义）。 */
export async function listDir(config, repoId, dirPath, { type = 'all' } = {}) {
  const resolved = resolveConfig(config);
  assertConfigured(resolved);
  const typeParam = type === 'file' ? '&t=f' : type === 'dir' ? '&t=d' : '';
  try {
    const raw = await apiRequest(resolved, `/api2/repos/${encodeURIComponent(repoId || resolved.repoId)}/dir/?p=${encodeURIComponent(dirPath)}${typeParam}`);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => ({
      name: String(entry.name || ''),
      type: entry.type === 'dir' ? 'dir' : 'file',
      size: Number(entry.size) || 0,
      mtime: entry.mtime || null,
      id: entry.id ? String(entry.id) : '',
    }));
  } catch (error) {
    if (error instanceof NjuboxStorageError && error.code === 'njubox_not_found') return null;
    throw error;
  }
}

/** 文件临时下载直链（seafhttp 链接有时效；每次展示现取）。 */
export async function fileLink(config, repoId, filePath) {
  const resolved = resolveConfig(config);
  assertConfigured(resolved);
  const raw = await apiRequest(resolved, `/api2/repos/${encodeURIComponent(repoId || resolved.repoId)}/file/?p=${encodeURIComponent(filePath)}&reuse=1`);
  return unquote(raw);
}

/** 文件更名（同目录内），返回新的完整路径。 */
export async function renameFile(config, repoId, filePath, newFilename) {
  const resolved = resolveConfig(config);
  assertConfigured(resolved);
  const safeName = sanitizeFilename(newFilename);
  if (!safeName) throw new NjuboxStorageError('新文件名无效');
  const parent = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
  await apiRequest(resolved, `/api2/repos/${encodeURIComponent(repoId || resolved.repoId)}/file/?p=${encodeURIComponent(filePath)}`, {
    method: 'POST',
    form: new URLSearchParams({ operation: 'rename', newname: safeName }).toString(),
  });
  return { path: `${parent}/${safeName}`, filename: safeName };
}

/** 删除文件；目标不存在视为已删除（幂等）。 */
export async function deleteFile(config, repoId, filePath) {
  const resolved = resolveConfig(config);
  assertConfigured(resolved);
  try {
    await apiRequest(resolved, `/api2/repos/${encodeURIComponent(repoId || resolved.repoId)}/file/?p=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (error instanceof NjuboxStorageError && (error.code === 'njubox_not_found' || /404/.test(error.message))) return false;
    throw error;
  }
}

/** 删除目录（递归）；目录不存在视为已删除（幂等）。 */
export async function deleteDir(config, repoId, dirPath) {
  const resolved = resolveConfig(config);
  assertConfigured(resolved);
  try {
    await apiRequest(resolved, `/api2/repos/${encodeURIComponent(repoId || resolved.repoId)}/dir/?p=${encodeURIComponent(dirPath)}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (error instanceof NjuboxStorageError && error.code === 'njubox_not_found') return false;
    throw error;
  }
}

/** SHA-256 校验和（十六进制）。 */
export function checksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
