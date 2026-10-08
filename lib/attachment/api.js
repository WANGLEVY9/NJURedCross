/**
 * 内容投稿附件域路由：槽位申请、服务端中转上传、删除与审核端读取。
 *
 * 挂载前缀：
 *   · /api/public/attachments*          —— 门户侧（登录 + CSRF + 分桶限流）
 *   · /api/outreach/public-submissions/:id/attachments —— 控制台 outreach scope
 *
 * ctx 注入契约（对齐 lib/events/api.js 的 eventsOpsRoutes 模式）：
 *   json / readJson / getBase / recordAudit / enforceLimit /
 *   requirePortalSession / requireCsrf / requireConsoleAccess /
 *   ownsBusinessRef / tables{ attachment, submission } / config{ aliyunOss* }
 *
 * 上传走服务端流式中转（路线 A）：浏览器只与本站通信，由本模块调
 * lib/attachment/oss.js 写入阿里云 OSS，CSP 保持 connect-src 'self'。
 * OSS 未配置时上传端点返回 503，投稿页自动退回「贴链接」模式。
 */

import * as oss from './oss.js';
import {
  ATTACHMENT_STATUS,
  attachmentFromRow,
  attachmentIdentifier,
  attachmentRow,
} from './store.js';

/** 单个上传请求的硬上限：200MB 视频 + multipart 开销。 */
const MAX_UPLOAD_BYTES = 210 * 1024 * 1024;
/** 每篇投稿最多可绑定附件数。 */
export const MAX_FILES_PER_SUBMISSION = 6;
/** 每账号「待上传/已上传未绑定」并存上限（防囤积）。 */
export const MAX_UNBOUND_PER_ACCOUNT = 10;
/** 槽位申请限流（次/小时/客户端）。 */
export const SLOT_LIMIT_PER_HOUR = 20;

/** 文件类型矩阵：MIME 前缀 → 大小上限（字节）。服务端只认这张表。 */
const FILE_RULES = [
  { kind: 'image', match: /^image\//, maxSize: 20 * 1024 * 1024, label: '图片（20MB）' },
  { kind: 'video', match: /^video\//, maxSize: 200 * 1024 * 1024, label: '视频（200MB）' },
  { kind: 'pdf', match: /^application\/pdf$/, maxSize: 20 * 1024 * 1024, label: 'PDF（20MB）' },
  { kind: 'archive', match: /^(application\/zip|application\/x-7z-compressed|application\/x-rar-compressed)$/, maxSize: 50 * 1024 * 1024, label: '压缩包（50MB）' },
  { kind: 'design', match: /^(application\/postscript|image\/vnd\.adobe\.photoshop)$/, maxSize: 50 * 1024 * 1024, label: '设计源文件（50MB）' },
];

const ALLOWED_MIME_HINT = '图片（≤20MB）/ 视频（≤200MB）/ PDF（≤20MB）/ 压缩包或设计源文件（≤50MB）';

function ruleFor(mimeType) {
  const value = String(mimeType || '').trim().toLowerCase();
  return FILE_RULES.find((rule) => rule.match.test(value)) || null;
}

/** 收集请求体为 Buffer，超出上限抛 413（对齐 lib/events/api.js 的 readBodyBuffer）。 */
async function readBodyBuffer(req, maxBytes = MAX_UPLOAD_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`上传文件超过 ${Math.floor(maxBytes / (1024 * 1024))}MB 上限`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function listAttachmentRows(ctx) {
  const client = await ctx.getBase();
  return client.listRows(ctx.tables.attachment, '', '', false, '', 1000);
}

/** 门户视图：只暴露展示所需字段，不泄露对象存储内部坐标。 */
function toPortalView(record) {
  return {
    id: record.id,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    status: record.status,
    uploadedAt: record.uploadedAt || null,
  };
}

/** 审核视图：附带校验和与对象坐标，便于人工核验与运维排查。 */
function toConsoleView(record) {
  return {
    id: record.id,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    checksum: record.checksum,
    bucket: record.bucket,
    objectKey: record.objectKey,
    status: record.status,
    uploader: record.uploader,
    uploadedAt: record.uploadedAt || null,
    boundAt: record.boundAt || null,
  };
}

/** 附件配置公告：前端据此渲染上传区与降级提示。 */
function attachmentConfig(ctx) {
  const status = oss.ossStatus(ctx.config);
  return {
    storageConfigured: status.configured,
    maxFilesPerSubmission: MAX_FILES_PER_SUBMISSION,
    maxUnboundPerAccount: MAX_UNBOUND_PER_ACCOUNT,
    acceptedHint: ALLOWED_MIME_HINT,
  };
}

/**
 * 门户侧路由总入口。返回 false 表示路径不属于本域，交还 server.js。
 * 所有子路由都要求登录；写操作额外过 CSRF。
 */
export async function attachmentRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/public\/attachments\/?/, ''));
  const session = ctx.requirePortalSession(req, res);
  if (!session) return;

  // GET /api/public/attachments/mine —— 我的待绑定附件 + 配置公告
  if (req.method === 'GET' && tail === 'mine') {
    const rows = await listAttachmentRows(ctx);
    const mine = rows
      .filter((row) => String(row['投稿ID'] || '') === '' && String(row['上传状态'] || '') !== ATTACHMENT_STATUS.deleted)
      .map((row) => attachmentFromRow(row))
      .filter((record) => ctx.ownsBusinessRef(session, record.uploader))
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    return ctx.json(res, 200, { ok: true, attachments: mine.map(toPortalView), config: attachmentConfig(ctx) });
  }

  // POST /api/public/attachments —— 申请上传槽位
  if (req.method === 'POST' && tail === '') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleSlot(req, res, ctx, session);
  }

  const idMatch = tail.match(/^([A-Za-z0-9-]+)$/);
  if (!idMatch) return false;

  // POST /api/public/attachments/:id —— 中转上传（multipart，file 字段）
  if (req.method === 'POST') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleUpload(req, res, ctx, session, idMatch[1]);
  }

  // DELETE /api/public/attachments/:id —— 删除（本人 + 未绑定）
  if (req.method === 'DELETE') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleDelete(req, res, ctx, session, idMatch[1]);
  }

  return false;
}

/** 申请槽位：只登记元数据与「待上传」状态，不触碰对象存储。 */
async function handleSlot(req, res, ctx, session) {
  ctx.enforceLimit(req, 'attachments', SLOT_LIMIT_PER_HOUR);
  const body = await ctx.readJson(req);
  const filename = oss.sanitizeFilename(body.filename);
  const mimeType = String(body.mimeType || '').trim().toLowerCase();
  const size = Number(body.size);
  if (!filename) return ctx.json(res, 400, { ok: false, message: '缺少有效文件名。' });
  const rule = ruleFor(mimeType);
  if (!rule) return ctx.json(res, 415, { ok: false, code: 'attachment_type_unsupported', message: `暂不支持该文件类型。支持：${ALLOWED_MIME_HINT}。` });
  if (!Number.isFinite(size) || size <= 0) return ctx.json(res, 400, { ok: false, message: '文件大小无效。' });
  if (size > rule.maxSize) {
    return ctx.json(res, 413, { ok: false, code: 'attachment_too_large', message: `${rule.label} 以内的文件才能上传。` });
  }

  const rows = await listAttachmentRows(ctx);
  const mine = rows
    .map((row) => attachmentFromRow(row))
    .filter((record) => ctx.ownsBusinessRef(session, record.uploader)
      && !record.submissionId
      && record.status !== ATTACHMENT_STATUS.deleted);
  if (mine.length >= MAX_UNBOUND_PER_ACCOUNT) {
    return ctx.json(res, 429, { ok: false, code: 'attachment_quota_exceeded', message: `待绑定附件已有 ${mine.length} 个（上限 ${MAX_UNBOUND_PER_ACCOUNT}），请先提交投稿或删除不需要的文件。` });
  }

  const record = {
    id: attachmentIdentifier(),
    submissionId: '',
    filename,
    mimeType,
    size,
    checksum: '',
    bucket: '',
    objectKey: '',
    status: ATTACHMENT_STATUS.pending,
    uploader: ctx.businessAccountRef(session),
    uploadedAt: '',
    boundAt: '',
  };
  const client = await ctx.getBase();
  await client.appendRow(ctx.tables.attachment, attachmentRow(record));
  await ctx.recordAudit(req, session, 'submission.attachment.slot', record.id, 'success', { filename, mimeType, size });
  return ctx.json(res, 201, { ok: true, attachment: toPortalView(record), config: attachmentConfig(ctx) });
}

/** 中转上传：multipart → OSS putObject → 回写「已上传」。失败保持待上传可重试。 */
async function handleUpload(req, res, ctx, session, attachmentId) {
  ctx.enforceLimit(req, 'attachments', SLOT_LIMIT_PER_HOUR);
  const rows = await listAttachmentRows(ctx);
  const found = rows.find((row) => String(row['附件ID'] || '') === attachmentId);
  if (!found) return ctx.json(res, 404, { ok: false, message: '附件槽位不存在，请刷新后重试。' });
  const record = attachmentFromRow(found);
  if (!ctx.ownsBusinessRef(session, record.uploader)) {
    return ctx.json(res, 403, { ok: false, code: 'attachment_not_owned', message: '仅上传人本人可以操作这个附件。' });
  }
  if (record.submissionId) return ctx.json(res, 409, { ok: false, code: 'attachment_bound', message: '附件已绑定投稿，不能重复上传。' });
  if (record.status === ATTACHMENT_STATUS.deleted) {
    return ctx.json(res, 409, { ok: false, code: 'attachment_deleted', message: '附件已删除。' });
  }

  const storage = oss.ossStatus(ctx.config);
  if (!storage.configured) {
    return ctx.json(res, 503, { ok: false, code: 'aliyun_oss_not_configured', message: '文件直传暂未开放（对象存储未配置），请把作品链接写在正文中投稿。' });
  }

  let buffer;
  try {
    buffer = await readBodyBuffer(req);
  } catch (error) {
    return ctx.json(res, error.statusCode === 413 ? 413 : 400, { ok: false, code: 'attachment_body_invalid', message: error.message });
  }
  let form;
  try {
    form = await new Response(buffer, { headers: { 'content-type': req.headers['content-type'] } }).formData();
  } catch {
    return ctx.json(res, 400, { ok: false, code: 'attachment_form_unparseable', message: '无法解析上传表单。' });
  }
  const file = form.get('file');
  if (!file || !file.size) return ctx.json(res, 400, { ok: false, code: 'attachment_file_missing', message: '缺少上传文件。' });
  const rule = ruleFor(file.type);
  if (!rule) return ctx.json(res, 415, { ok: false, code: 'attachment_type_unsupported', message: `暂不支持该文件类型。支持：${ALLOWED_MIME_HINT}。` });
  if (file.size > rule.maxSize) {
    return ctx.json(res, 413, { ok: false, code: 'attachment_too_large', message: `${rule.label} 以内的文件才能上传。` });
  }

  const filename = oss.sanitizeFilename(file.name);
  if (!filename) return ctx.json(res, 400, { ok: false, code: 'attachment_name_invalid', message: '文件名无效。' });
  const objectKey = oss.buildObjectKey(ctx.config, attachmentId, filename);
  let stored;
  try {
    stored = await oss.putObject(ctx.config, {
      key: objectKey,
      buffer: Buffer.from(await file.arrayBuffer()),
      contentType: String(file.type || 'application/octet-stream'),
    });
  } catch (error) {
    // 对象存储失败时保持「待上传」，槽位可重试；错误细节走审计。
    await ctx.recordAudit(req, session, 'submission.attachment.upload', attachmentId, 'failure', { message: error?.message || String(error) });
    return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'aliyun_oss_request_failed', message: error.message });
  }

  const now = new Date().toISOString();
  const updated = {
    ...record,
    filename,
    mimeType: String(file.type || record.mimeType || 'application/octet-stream'),
    size: stored.size,
    checksum: stored.checksum,
    bucket: stored.bucket,
    objectKey: stored.key,
    status: ATTACHMENT_STATUS.uploaded,
    uploadedAt: now,
  };
  const patch = {
    文件名: updated.filename,
    MIME类型: updated.mimeType,
    大小: String(updated.size),
    校验和: updated.checksum,
    Bucket: updated.bucket,
    对象Key: updated.objectKey,
    上传状态: ATTACHMENT_STATUS.uploaded,
    上传时间: now,
  };
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.attachment, found._id, patch);
  await ctx.recordAudit(req, session, 'submission.attachment.upload', attachmentId, 'success', { filename, size: stored.size, checksum: stored.checksum });
  return ctx.json(res, 200, { ok: true, attachment: toPortalView(updated) });
}

/** 删除：仅本人且未绑定；先删 OSS 对象，再回写「已删除」（幂等）。 */
async function handleDelete(req, res, ctx, session, attachmentId) {
  const rows = await listAttachmentRows(ctx);
  const found = rows.find((row) => String(row['附件ID'] || '') === attachmentId);
  if (!found) return ctx.json(res, 404, { ok: false, message: '附件不存在。' });
  const record = attachmentFromRow(found);
  if (!ctx.ownsBusinessRef(session, record.uploader)) {
    return ctx.json(res, 403, { ok: false, code: 'attachment_not_owned', message: '仅上传人本人可以操作这个附件。' });
  }
  if (record.submissionId) {
    return ctx.json(res, 409, { ok: false, code: 'attachment_bound', message: '附件已绑定投稿，删除需通过投稿撤回流程。' });
  }
  if (record.status === ATTACHMENT_STATUS.deleted) {
    return ctx.json(res, 200, { ok: true });
  }
  if (record.objectKey && oss.ossStatus(ctx.config).configured) {
    try {
      await oss.deleteObject(ctx.config, record.objectKey);
    } catch (error) {
      await ctx.recordAudit(req, session, 'submission.attachment.delete', attachmentId, 'failure', { message: error?.message || String(error) });
      return ctx.json(res, error.statusCode || 502, { ok: false, code: error.code || 'aliyun_oss_request_failed', message: `对象存储删除失败，请稍后重试。${error.message}` });
    }
  }
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.attachment, found._id, { 上传状态: ATTACHMENT_STATUS.deleted });
  await ctx.recordAudit(req, session, 'submission.attachment.delete', attachmentId, 'success', { filename: record.filename });
  return ctx.json(res, 200, { ok: true });
}

/**
 * 审核端读取：GET /api/outreach/public-submissions/:id/attachments。
 * 守卫（outreach scope）由 server.js 的通用控制台守卫完成，这里只做读取。
 * 附件以「投稿ID」列为主索引；signedUrl 每次请求时现算（TTL 走配置）。
 */
export async function outreachSubmissionAttachments(req, res, ctx, submissionId) {
  const rows = await listAttachmentRows(ctx);
  const records = rows
    .map((row) => attachmentFromRow(row))
    .filter((record) => record.submissionId === submissionId && record.status !== ATTACHMENT_STATUS.deleted)
    .sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
  const links = {};
  if (records.length && oss.ossStatus(ctx.config).configured) {
    for (const record of records) {
      if (record.status === ATTACHMENT_STATUS.uploaded && record.objectKey) {
        links[record.id] = oss.signedUrl(ctx.config, record.objectKey);
      }
    }
  }
  return ctx.json(res, 200, {
    ok: true,
    attachments: records.map(toConsoleView),
    links,
    storageConfigured: oss.ossStatus(ctx.config).configured,
  });
}

/** 投稿提交时的附件绑定校验：返回可绑定记录；任何不满足即抛 400/403/409。 */
export function validateAttachmentBinding(session, body, rows, { ownsBusinessRef }) {
  const requested = Array.isArray(body?.attachmentIds) ? body.attachmentIds : [];
  const ids = [...new Set(requested.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > MAX_FILES_PER_SUBMISSION) {
    const error = new Error(`每篇投稿最多绑定 ${MAX_FILES_PER_SUBMISSION} 个附件。`);
    error.statusCode = 400;
    throw error;
  }
  const byId = new Map(rows.map((row) => [String(row['附件ID'] || ''), row]));
  const bound = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      const error = new Error(`附件 ${id} 不存在，请移除后重新提交。`);
      error.statusCode = 400;
      throw error;
    }
    const record = attachmentFromRow(row);
    if (!ownsBusinessRef(session, record.uploader)) {
      const error = new Error(`附件 ${record.filename || id} 不属于当前账号。`);
      error.statusCode = 403;
      throw error;
    }
    if (record.submissionId) {
      const error = new Error(`附件 ${record.filename || id} 已绑定其他投稿。`);
      error.statusCode = 409;
      throw error;
    }
    if (record.status !== ATTACHMENT_STATUS.uploaded) {
      const error = new Error(`附件 ${record.filename || id} 尚未完成上传，请先上传或移除。`);
      error.statusCode = 400;
      throw error;
    }
    bound.push({ row, record });
  }
  return bound;
}
