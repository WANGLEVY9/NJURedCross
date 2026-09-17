/**
 * njubox 客户端：南京大学自部署的 Seafile 企业版。
 *
 * 契约：<server>/api2/ 是 Seafile Web API。匿名端点（/api2/ping/、/api2/server-info/）
 * 不需要凭据即可探测，因此 `probeServer()` 即使 Token 为空也能返回真实结果。
 *
 * Token 为空时（.env 里 NJUBOX_API_TOKEN 故意留空）：
 *   · `njuboxStatus()` 返回 { configured:false } 且不崩溃
 *   · 所有需要凭据的写入函数抛出 NjuboxNotConfigured，便于路由层返回 503
 *
 * 依赖 Node 18+ 的全局 FormData / Blob（undici）。契约见 §3。
 */

import { createHash } from 'node:crypto';

export const ATTACHMENT_TABLE = '活动附件表';
export const ATTACHMENT_COLUMNS = [
  '附件ID', '活动ID', '用途', '文件名', '大小', '校验和',
  '库ID', '路径', '下载链接', '上传人', '上传时间',
];

/** 未配置 Token 时抛出的错误：携带可识别的 code 与 503 状态。 */
export class NjuboxNotConfigured extends Error {
  constructor(message = 'njubox 存储未配置（缺少 API Token）。') {
    super(message);
    this.name = 'NjuboxNotConfigured';
    this.code = 'njubox_not_configured';
    this.statusCode = 503;
  }
}

function resolveServer(config = {}) {
  return (config.njuboxServerUrl || 'https://box.nju.edu.cn').replace(/\/$/, '');
}

/** 返回当前配置状态；Token 为空则 configured=false。 */
export function njuboxStatus(config = {}) {
  const serverUrl = resolveServer(config);
  const token = (config.njuboxToken || '').trim();
  const repoId = (config.njuboxRepoId || '').trim();
  return {
    configured: Boolean(token),
    transport: 'seafile-web-api',
    serverUrl,
    hasToken: Boolean(token),
    hasRepo: Boolean(repoId),
    repoId,
    uploadDir: config.njuboxUploadDir || '/',
  };
}

/**
 * 匿名探测：ping + server-info，二者都不需要 Token。
 * 真实发起 HTTP 请求，返回可达性与版本信息。
 */
export async function probeServer(config = {}) {
  const serverUrl = resolveServer(config);
  const result = { ok: false, ping: null, serverInfo: null, error: null, serverUrl };
  try {
    const pingRes = await fetch(`${serverUrl}/api2/ping/`);
    const text = await pingRes.text();
    result.ping = text.replace(/^"|"$/g, '').trim() || (pingRes.ok ? 'ok' : null);
    result.ok = pingRes.ok;
  } catch (error) {
    result.error = error?.message || String(error);
  }
  try {
    const infoRes = await fetch(`${serverUrl}/api2/server-info/`);
    if (infoRes.ok) {
      try {
        result.serverInfo = await infoRes.json();
      } catch {
        result.serverInfo = 'unparseable-json';
      }
      result.ok = true;
    } else {
      result.serverInfo = `HTTP ${infoRes.status}`;
      if (!result.error) result.error = result.serverInfo;
    }
  } catch (error) {
    result.serverInfo = `error: ${error?.message || error}`;
    if (!result.error) result.error = result.serverInfo;
  }
  return result;
}

async function apiGet(url, token) {
  const headers = token ? { Authorization: `Token ${token}` } : {};
  return fetch(url, { method: 'GET', headers });
}

/** 列举资料库（需要 Token）。 */
export async function listLibraries(config = {}) {
  const status = njuboxStatus(config);
  if (!status.configured) throw new NjuboxNotConfigured();
  const res = await apiGet(`${status.serverUrl}/api2/repos/`, config.njuboxToken);
  if (!res.ok) throw new Error(`njubox 列举资料库失败：HTTP ${res.status}`);
  return res.json();
}

/** 获取上传链接（需要 Token）。 */
export async function getUploadLink(config, repoId, path = '/') {
  const status = njuboxStatus(config);
  if (!status.configured) throw new NjuboxNotConfigured();
  const id = (repoId || config.njuboxRepoId || '').trim();
  if (!id) throw new Error('缺少资料库 ID（repoId）。');
  const res = await apiGet(`${status.serverUrl}/api2/repos/${encodeURIComponent(id)}/upload-link/?path=${encodeURIComponent(path)}`, config.njuboxToken);
  if (!res.ok) throw new Error(`njubox 获取上传地址失败：HTTP ${res.status}`);
  return (await res.text()).replace(/^"|"$/g, '').trim();
}

/** 上传二进制到指定资料库/目录（需要 Token）。 */
export async function uploadFileBuffer(config, { repoId, parentDir, filename, buffer }) {
  const status = njuboxStatus(config);
  if (!status.configured) throw new NjuboxNotConfigured();
  const link = await getUploadLink(config, repoId, parentDir || config.njuboxUploadDir || '/');
  const form = new FormData();
  form.append('parent_dir', parentDir || config.njuboxUploadDir || '/');
  form.append('file', new Blob([buffer]), filename);
  const res = await fetch(link, {
    method: 'POST',
    headers: { Authorization: `Token ${config.njuboxToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(`njubox 上传失败：HTTP ${res.status}`);
  return (await res.text()).trim();
}

/** 获取文件直链（需要 Token），也可用于校验文件是否存在。 */
export async function getFileLink(config, repoId, path) {
  const status = njuboxStatus(config);
  if (!status.configured) throw new NjuboxNotConfigured();
  const id = (repoId || config.njuboxRepoId || '').trim();
  if (!id) throw new Error('缺少资料库 ID（repoId）。');
  if (!path) throw new Error('缺少文件路径。');
  const res = await apiGet(`${status.serverUrl}/api2/repos/${encodeURIComponent(id)}/file/?p=${encodeURIComponent(path)}&reuse=1`, config.njuboxToken);
  if (!res.ok) throw new Error(`njubox 获取文件链接失败：HTTP ${res.status}`);
  return (await res.text()).replace(/^"|"$/g, '').trim();
}

/** 生成分享链接（需要 Token）。 */
export async function createShareLink(config, repoId, path) {
  const status = njuboxStatus(config);
  if (!status.configured) throw new NjuboxNotConfigured();
  const id = (repoId || config.njuboxRepoId || '').trim();
  if (!id) throw new Error('缺少资料库 ID（repoId）。');
  const body = new URLSearchParams({ repo_id: id, path }).toString();
  const res = await fetch(`${status.serverUrl}/api2/share-links/`, {
    method: 'POST',
    headers: { Authorization: `Token ${config.njuboxToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`njubox 生成分享链接失败：HTTP ${res.status}`);
  const data = await res.json();
  return data.link || '';
}

/**
 * 校验 box 上某路径是否存在。配置缺失或请求失败时返回 exists:false，
 * 调用方可据此标注「未校验」，而不是直接失败。
 */
export async function verifyPathExists(config, repoId, path) {
  try {
    const link = await getFileLink(config, repoId, path);
    return { exists: Boolean(link), link: link || '' };
  } catch (error) {
    return { exists: false, link: '', error: error?.message || String(error) };
  }
}

/** 计算缓冲区的 SHA-256 校验和（十六进制）。 */
export function checksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
