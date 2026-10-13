/**
 * 阿里云 OSS 客户端（投稿附件的首选对象存储）。
 *
 * 契约：阿里云 OSS V4 签名（OSS4-HMAC-SHA256）。零第三方依赖——仅用
 * node:crypto 与全局 fetch（undici）实现，延续仓库「运行时依赖最小化」
 * 约束；适配器形态对齐 lib/events/njubox.js：
 *   · 凭证齐全时 ossStatus().configured 为 true
 *   · 凭证缺失时所有需要凭证的函数抛出 OssNotConfigured，路由层可回 503
 *   · probeBucket() 用 ListObjectsV2 真实探测，可区分凭证/Bucket/网络错误
 *
 * 上传走服务端流式中转（开发方案 §6 路线 A）：浏览器只与 njuredcross.cn
 * 通信，由本模块代为读写 OSS，前端 CSP（connect-src 'self'）零改动。
 *
 * 对象 Key 布局：<prefix>/<附件ID>/<安全文件名>，prefix 默认 submissions/。
 * 文件名经 sanitizeFilename 清洗（防路径穿越与控制字符），保留原可读名。
 */

import { createHash, createHmac } from 'node:crypto';

export const OSS_DEFAULT_REGION = 'oss-cn-nanjing';
export const OSS_SIGNATURE_VERSION = 'OSS4-HMAC-SHA256';
export const OSS_LINK_TTL_DEFAULT_SECONDS = 900;
export const OSS_LINK_TTL_MAX_SECONDS = 604800;

/** SHA-256("")——空 body 请求（GET/HEAD/DELETE）的固定哈希。 */
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** 未配置凭证时抛出：携带可识别 code 与 503 状态，对齐 NjuboxNotConfigured。 */
export class OssNotConfigured extends Error {
  constructor(message = '阿里云 OSS 未配置（缺少 AccessKey 或 Bucket）。') {
    super(message);
    this.name = 'OssNotConfigured';
    this.code = 'aliyun_oss_not_configured';
    this.statusCode = 503;
  }
}

/** OSS 返回非 2xx 时抛出：对客户端统一表现为 502，上游状态保留在 ossStatus。 */
export class OssRequestError extends Error {
  constructor(message, upstreamStatus = 0) {
    super(message);
    this.name = 'OssRequestError';
    this.code = 'aliyun_oss_request_failed';
    this.statusCode = 502;
    this.ossStatus = upstreamStatus;
  }
}

/** OSS 规范的百分号编码：除 A-Za-z0-9-._~ 外全部编码（query 中 '/' 亦编码）。 */
function encodeOss(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Canonical URI 的 Key 编码：按 '/' 分段，分隔符保留，其余按 OSS 规则编码。 */
function encodeOssPath(key) {
  return String(key || '')
    .split('/')
    .map((segment) => encodeOss(segment))
    .join('/');
}

/** Canonical Query：参数名字典序，key 与 value 均按 OSS 规则编码。 */
function encodeOssQuery(query) {
  return Object.keys(query)
    .sort()
    .map((name) => `${encodeOss(name)}=${encodeOss(query[name])}`)
    .join('&');
}

/** ISO8601 基本格式：2026-10-05T12:00:00.000Z → 20261005T120000Z。 */
function toIso8601(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 签名 Scope 的日期段：2026-10-05T12:00:00.000Z → 20261005。 */
function toDatePath(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** 读取三元组凭证（AK/SK/Bucket）；任一缺失返回 null。 */
function readCredentials(config = {}) {
  const accessKeyId = (config.aliyunOssAccessKeyId || '').trim();
  const accessKeySecret = (config.aliyunOssAccessKeySecret || '').trim();
  const bucket = (config.aliyunOssBucket || '').trim();
  if (!accessKeyId || !accessKeySecret || !bucket) return null;
  return { accessKeyId, accessKeySecret, bucket };
}

/**
 * 解析请求目标。默认虚拟主机风格 https://<bucket>.<region>.aliyuncs.com；
 * 显式 ALIYUN_OSS_ENDPOINT 时视为「不含 Bucket 的 endpoint」（如 ECS 内网
 * oss-cn-nanjing-internal.aliyuncs.com），仍拼上 Bucket 前缀。
 * region 同时接受 cn-nanjing / oss-cn-nanjing 两种写法。
 */
function resolveTarget(config = {}) {
  const bucket = (config.aliyunOssBucket || '').trim();
  const regionInput = (config.aliyunOssRegion || OSS_DEFAULT_REGION).trim() || OSS_DEFAULT_REGION;
  const region = regionInput.startsWith('oss-') ? regionInput : `oss-${regionInput}`;
  const explicit = (config.aliyunOssEndpoint || '').trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const host = explicit ? `${bucket}.${explicit}` : `${bucket}.${region}.aliyuncs.com`;
  return { bucket, region, host, endpoint: `https://${host}` };
}

/** 对象 Key 前缀归一：去首尾斜杠；空串表示 Bucket 根。 */
function normalizePrefix(value) {
  return String(value ?? 'submissions/').trim().replace(/^\/+|\/+$/g, '');
}

/** 链接有效期归一：非法或未配置回默认 15 分钟，上限 7 天（OSS V4 上限）。 */
function normalizeTtl(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return OSS_LINK_TTL_DEFAULT_SECONDS;
  return Math.min(parsed, OSS_LINK_TTL_MAX_SECONDS);
}

/** V4 派生签名密钥：HMAC("aliyun_v4"+SK, date) → region → "oss" → "aliyun_v4_request"。 */
function deriveSigningKey(accessKeySecret, datePath, region) {
  const dateKey = createHmac('sha256', `aliyun_v4${accessKeySecret}`).update(datePath).digest();
  const dateRegionKey = createHmac('sha256', dateKey).update(region).digest();
  const dateRegionServiceKey = createHmac('sha256', dateRegionKey).update('oss').digest();
  return createHmac('sha256', dateRegionServiceKey).update('aliyun_v4_request').digest();
}

/**
 * Canonical Request：method、URI、Query、Canonical Headers（每行以 \n 结尾）、
 * Additional Headers（本模块恒为空，与官方 SDK 空段行为一致）、Hashed Payload。
 */
function buildCanonicalRequest({ method, canonicalUri, canonicalQuery, headers, payloadHash }) {
  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name.toLowerCase()}:${String(value).trim()}\n`)
    .join('');
  return [method, canonicalUri, canonicalQuery, canonicalHeaders, '', payloadHash].join('\n');
}

/** 计算 Authorization 头（header 签名路径，AdditionalHeaders 恒为空）。 */
function signV4({ method, canonicalUri, canonicalQuery, headers, payloadHash, accessKeyId, accessKeySecret, region, date }) {
  const datePath = toDatePath(date);
  const scope = `${datePath}/${region}/oss/aliyun_v4_request`;
  const canonicalRequest = buildCanonicalRequest({ method, canonicalUri, canonicalQuery, headers, payloadHash });
  const stringToSign = [
    OSS_SIGNATURE_VERSION,
    toIso8601(date),
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signingKey = deriveSigningKey(accessKeySecret, datePath, region);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `${OSS_SIGNATURE_VERSION} Credential=${accessKeyId}/${scope},AdditionalHeaders=,Signature=${signature}`;
}

/**
 * 统一的签名请求入口：构造 Canonical Request → V4 签名 → fetch。
 * extraHeaders 里只放需要参与签名的头（content-type 等）；host 由 fetch
 * 依据 URL 自动设置，与签名所用 resolveTarget().host 一致。
 */
async function ossFetch(config, { method, key = '', query = {}, extraHeaders = {}, body = null, date = new Date() }) {
  const credentials = readCredentials(config);
  if (!credentials) throw new OssNotConfigured();
  const target = resolveTarget(config);
  const canonicalUri = `/${encodeOssPath(key)}`;
  const canonicalQuery = encodeOssQuery(query);
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_BODY_SHA256;
  const signedHeaders = {
    host: target.host,
    'x-oss-content-sha256': payloadHash,
    'x-oss-date': toIso8601(date),
  };
  for (const [name, value] of Object.entries(extraHeaders)) {
    signedHeaders[name.toLowerCase()] = String(value).trim();
  }
  const authorization = signV4({
    method,
    canonicalUri,
    canonicalQuery,
    headers: signedHeaders,
    payloadHash,
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    region: target.region,
    date,
  });
  const requestUrl = `${target.endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  const requestHeaders = { ...signedHeaders, authorization };
  delete requestHeaders.host;
  return fetch(requestUrl, { method, headers: requestHeaders, body: body ?? undefined });
}

/** 上游非 2xx 时读取响应体前 300 字符组装错误（保留上游状态码）。 */
async function toRequestError(action, res) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300).replace(/\s+/g, ' ').trim();
  } catch { /* 响应体不可读时仅保留状态码 */ }
  const message = `阿里云 OSS ${action}失败：HTTP ${res.status}${detail ? `（${detail}）` : ''}`;
  return new OssRequestError(message, res.status);
}

/** 返回当前配置状态；纯函数，不联网，Token 缺失时 configured=false 不崩溃。 */
export function ossStatus(config = {}) {
  const target = resolveTarget(config);
  const credentials = readCredentials(config);
  return {
    configured: Boolean(credentials),
    transport: 'aliyun-oss-v4',
    endpoint: target.endpoint,
    bucket: target.bucket,
    region: target.region,
    hasAccessKeyId: Boolean((config.aliyunOssAccessKeyId || '').trim()),
    hasAccessKeySecret: Boolean((config.aliyunOssAccessKeySecret || '').trim()),
    hasBucket: Boolean(target.bucket),
    uploadPrefix: normalizePrefix(config.aliyunOssUploadPrefix),
    linkTtlSeconds: normalizeTtl(config.aliyunOssLinkTtlSeconds),
  };
}

/**
 * 真实探测：ListObjectsV2（max-keys=1）验证 AK/SK/Bucket 三者同时可用。
 * 403 → 凭证或权限问题；404 → Bucket 不存在或地域不匹配。
 */
export async function probeBucket(config = {}) {
  const status = ossStatus(config);
  const result = {
    ok: false,
    configured: status.configured,
    bucket: status.bucket,
    region: status.region,
    endpoint: status.endpoint,
    error: null,
  };
  if (!status.configured) {
    result.error = '阿里云 OSS 未配置（缺少 AccessKey 或 Bucket）。';
    return result;
  }
  try {
    const res = await ossFetch(config, { method: 'GET', query: { 'list-type': '2', 'max-keys': '1' } });
    if (res.ok) {
      result.ok = true;
      return result;
    }
    result.error = res.status === 403 ? '凭证无效或无该 Bucket 权限。'
      : res.status === 404 ? 'Bucket 不存在（检查名称与地域）。'
        : `HTTP ${res.status}`;
  } catch (error) {
    result.error = error?.message || String(error);
  }
  return result;
}

/** 清洗用户文件名：取末段、去控制字符、去首部点号、折叠空白、限长保扩展名。 */
export function sanitizeFilename(filename) {
  let name = String(filename ?? '').trim();
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSlash >= 0) name = name.slice(lastSlash + 1);
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '');
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    if (dot > 0 && name.length - dot <= 10) {
      name = `${name.slice(0, 120 - (name.length - dot))}${name.slice(dot)}`;
    } else {
      name = name.slice(0, 120);
    }
  }
  return name;
}

/** 组装对象 Key：<prefix>/<附件ID>/<安全文件名>；附件 ID 不允许含分隔符或空白。 */
export function buildObjectKey(config, attachmentId, filename) {
  const id = String(attachmentId ?? '').trim();
  const safeFilename = sanitizeFilename(filename);
  if (!id || /[\\/\s]/.test(id)) throw new Error('附件 ID 缺失或含非法字符。');
  if (!safeFilename) throw new Error('缺少有效文件名。');
  const prefix = normalizePrefix(config.aliyunOssUploadPrefix);
  return prefix ? `${prefix}/${id}/${safeFilename}` : `${id}/${safeFilename}`;
}

/** 计算缓冲区的 SHA-256 校验和（十六进制），与 njubox.checksum 同一约定。 */
export function checksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 服务端流式写入对象（路线 A 的核心调用）。返回 etag / SHA-256 校验和 /
 * 字节数 / Bucket，供 P3 路由直接落「投稿附件表」。
 */
export async function putObject(config, { key, buffer, contentType = 'application/octet-stream' }) {
  if (!String(key || '').trim()) throw new Error('缺少对象 Key。');
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '');
  if (!body.length) throw new Error('缺少上传内容或内容为空。');
  const res = await ossFetch(config, {
    method: 'PUT',
    key,
    extraHeaders: { 'content-type': contentType },
    body,
  });
  if (!res.ok) throw await toRequestError('上传对象', res);
  const etag = (res.headers.get('etag') || '').replace(/^"|"$/g, '');
  return {
    key,
    etag,
    checksum: checksum(body),
    size: body.length,
    bucket: resolveTarget(config).bucket,
  };
}

/** 删除对象；OSS 的 DELETE 对不存在的对象同样返回 204（幂等）。 */
export async function deleteObject(config, key) {
  if (!String(key || '').trim()) throw new Error('缺少对象 Key。');
  const res = await ossFetch(config, { method: 'DELETE', key });
  if (!res.ok) throw await toRequestError('删除对象', res);
  return { key, deleted: true };
}

/** HEAD 探测对象是否存在：200 → true，404 → false，其余状态抛 OssRequestError。 */
export async function objectExists(config, key) {
  if (!String(key || '').trim()) throw new Error('缺少对象 Key。');
  const res = await ossFetch(config, { method: 'HEAD', key });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw await toRequestError('检查对象', res);
}

/**
 * 生成 V4 presigned GET 链接（审核端下载/预览用）。payload 固定
 * UNSIGNED-PAYLOAD；expiresIn 缺省取配置 TTL（默认 15 分钟，上限 7 天）。
 * date 参数仅供测试注入固定时间，生产调用缺省当前时间。
 */
export function signedUrl(config, key, { expiresIn } = {}, date = new Date()) {
  const credentials = readCredentials(config);
  if (!credentials) throw new OssNotConfigured();
  const target = resolveTarget(config);
  const canonicalUri = `/${encodeOssPath(key)}`;
  const datePath = toDatePath(date);
  const query = {
    'x-oss-credential': `${credentials.accessKeyId}/${datePath}/${target.region}/oss/aliyun_v4_request`,
    'x-oss-date': toIso8601(date),
    'x-oss-expires': String(normalizeTtl(expiresIn ?? config.aliyunOssLinkTtlSeconds)),
    'x-oss-signature-version': OSS_SIGNATURE_VERSION,
  };
  const canonicalQuery = encodeOssQuery(query);
  const canonicalRequest = buildCanonicalRequest({
    method: 'GET',
    canonicalUri,
    canonicalQuery,
    headers: { host: target.host },
    payloadHash: 'UNSIGNED-PAYLOAD',
  });
  const stringToSign = [
    OSS_SIGNATURE_VERSION,
    toIso8601(date),
    `${datePath}/${target.region}/oss/aliyun_v4_request`,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signingKey = deriveSigningKey(credentials.accessKeySecret, datePath, target.region);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `${target.endpoint}${canonicalUri}?${canonicalQuery}&x-oss-signature=${signature}`;
}
