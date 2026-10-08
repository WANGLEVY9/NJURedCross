/**
 * 活动运维扩展路由：报名通知生成 + njubox 附件。
 *
 * 挂载前缀：`/api/event-notices/*` 与 `/api/event-attachments/*`。
 * 任何不属于这两个前缀、或前缀下不匹配已知子路由的路径都 `return false`，
 * 交还给 server.js 的通用控制台处理，绝不干扰既有的 `/api/events/*`。
 *
 * 守卫：所有路由都先 `requireConsoleAccess`；写操作额外 `requireCsrf`。
 * 契约见 .workbuddy/parallel-contract.md §3。
 */

import { createHash } from 'node:crypto';
import * as notice from './notice.js';
import * as njubox from './njubox.js';
import { collectRequestBody } from '../http/request-body.js';
import { readPagedRows } from '../http/paged-rows.js';
import { apiFailure } from '../http/errors.js';

const NOTICE_TABLE = notice.NOTICE_TABLE;
const ATTACHMENT_TABLE = njubox.ATTACHMENT_TABLE;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB

/** 收集请求体为 Buffer，超出 8MB 抛 413。 */
async function readBodyBuffer(req, maxBytes = MAX_BODY_BYTES) {
  return collectRequestBody(req, maxBytes);
}

function toNoticeView(row) {
  return {
    id: row._id || null,
    noticeId: row['通知ID'] || '',
    eventId: row['活动ID'] || '',
    name: row['活动名称'] || '',
    category: row['活动类别'] || '',
    time: row['活动时间'] || '',
    place: row['活动地点'] || '',
    window: row['报名窗口'] || '',
    body: row['正文'] || '',
    status: row['状态'] || '草稿',
    generator: row['生成人'] || '',
    generatedAt: row['生成时间'] || null,
    publishedAt: row['发布时间'] || null,
  };
}

function toAttachmentView(row) {
  return {
    id: row._id || null,
    attachmentId: row['附件ID'] || '',
    eventId: row['活动ID'] || '',
    purpose: row['用途'] || '',
    filename: row['文件名'] || '',
    size: row['大小'] || '',
    checksum: row['校验和'] || '',
    repoId: row['库ID'] || '',
    path: row['路径'] || '',
    downloadUrl: row['下载链接'] || '',
    uploader: row['上传人'] || '',
    uploadedAt: row['上传时间'] || null,
  };
}

function ownsPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export async function eventsOpsRoutes(req, res, url, ctx) {
  if (ownsPrefix(url.pathname, '/api/event-notices')) return noticeRoutes(req, res, url, ctx);
  if (ownsPrefix(url.pathname, '/api/event-attachments')) return attachmentRoutes(req, res, url, ctx);
  return false;
}

/* -------------------------------------------------------------------------- *
 * 活动通知
 * -------------------------------------------------------------------------- */
async function noticeRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/event-notices\/?/, ''));
  const session = ctx.requireConsoleAccess(req, res, 'events');
  if (!session) return;

  // GET /api/event-notices?eventId=
  if (req.method === 'GET' && tail === '') {
    const eventId = url.searchParams.get('eventId') || '';
    const client = await ctx.getBase();
    const rows = await readPagedRows(client, NOTICE_TABLE, {
      requireComplete: true,
    });
    const filtered = eventId ? rows.filter((row) => String(row['活动ID'] || '') === eventId) : rows;
    return ctx.json(res, 200, { ok: true, notices: filtered.map(toNoticeView) });
  }

  // POST /api/event-notices/preview —— 只渲染不落库
  if (req.method === 'POST' && tail === 'preview') {
    const body = await ctx.readJson(req);
    const rendered = notice.renderRegistrationNotice(body);
    return ctx.json(res, 200, { ok: true, notice: rendered });
  }

  // POST /api/event-notices —— 落库为草稿，可选回填 活动简介
if (req.method === 'POST' && tail === '') {
  if (!ctx.requireCsrf(req, res, session)) return;

  const body = await ctx.readJson(req);
  const eventId = String(body.eventId || '').trim();

  if (!eventId) {
    return ctx.json(res, 400, {
      ok: false,
      message: '缺少活动ID',
    });
  }

  const client = await ctx.getBase();
  let project = null;

  if (body.fillDescription) {
    const projects = await readPagedRows(
      client,
      ctx.tables.project,
      { requireComplete: true },
    );

    const matches = projects.filter(
      row => row['活动ID'] === eventId,
    );

    if (matches.length > 1) {
      return ctx.json(res, 409, {
        ok: false,
        code: 'ambiguous_event_project',
        message: '活动编号对应多个记录，已停止生成通知，请先核对。',
      });
    }

    project = matches[0] || null;
  }

  const rendered = notice.renderRegistrationNotice(body);
  const noticeId = ctx.identifier('NOT');
  const row = notice.buildNoticeRow({
    rendered,
    input: body,
    eventId,
    generator: session.username,
    noticeId,
    status: '草稿',
  });

  const result = await client.appendRow(NOTICE_TABLE, row);

  await ctx.recordAudit(
    req,
    session,
    'event.notice.generate',
    noticeId,
    'success',
    { eventId, missing: rendered.missing },
  );

  if (project) {
    await client.updateRow(ctx.tables.project, project._id, {
      活动简介: rendered.body,
    });

    await ctx.recordAudit(
      req,
      session,
      'event.notice.fill-description',
      eventId,
      'success',
      {},
    );
  }

  return ctx.json(res, 201, {
    ok: true,
    notice: toNoticeView({ ...row, _id: result?._id || null }),
  });
}

  // POST /api/event-notices/:id/(publish|archive)
  const statusMatch = tail.match(/^([^/]+)\/(publish|archive)$/);
  if (req.method === 'POST' && statusMatch) {
    if (!ctx.requireCsrf(req, res, session)) return;
    const noticeId = decodeURIComponent(statusMatch[1]);
    const target = statusMatch[2] === 'publish' ? '已发布' : '已归档';
    const client = await ctx.getBase();
    const rows = await readPagedRows(client, NOTICE_TABLE, {
      requireComplete: true,
    });
    const found = rows.find((row) => row['通知ID'] === noticeId || row._id === noticeId);
    if (!found) return ctx.json(res, 404, { ok: false, message: '通知不存在' });
    const patch = target === '已发布'
      ? { '状态': '已发布', '发布时间': new Date().toISOString() }
      : { '状态': '已归档' };
    await client.updateRow(NOTICE_TABLE, found._id, patch);
    await ctx.recordAudit(req, session, `event.notice.${statusMatch[2]}`, noticeId, 'success', {});
    return ctx.json(res, 200, { ok: true, notice: toNoticeView({ ...found, ...patch }) });
  }

  return false;
}

/* -------------------------------------------------------------------------- *
 * 活动附件
 * -------------------------------------------------------------------------- */
async function attachmentRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/event-attachments\/?/, ''));
  const session = ctx.requireConsoleAccess(req, res, 'events');
  if (!session) return;

  // GET /api/event-attachments/njubox-status
  if (req.method === 'GET' && tail === 'njubox-status') {
    const status = njubox.njuboxStatus(ctx.config);
    const probe = await njubox.probeServer(ctx.config);
    return ctx.json(res, 200, { ok: true, status, probe });
  }

  // GET /api/event-attachments?eventId=
  if (req.method === 'GET' && tail === '') {
    const eventId = url.searchParams.get('eventId') || '';
    const client = await ctx.getBase();
    const rows = await readPagedRows(client, ATTACHMENT_TABLE, {
      requireComplete: true,
    });
    const filtered = eventId ? rows.filter((row) => String(row['活动ID'] || '') === eventId) : rows;
    return ctx.json(res, 200, { ok: true, attachments: filtered.map(toAttachmentView) });
  }

  // POST /api/event-attachments —— 上传(multipart) 或 引用(JSON)
  if (req.method === 'POST' && tail === '') {
    if (!ctx.requireCsrf(req, res, session)) return;
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.startsWith('multipart/form-data')) return handleUpload(req, res, ctx, session);
    return handleReference(req, res, ctx, session);
  }

  return false;
}

/** 引用 box 上已有文件：能校验就校验，不能则标注「未校验」。 */
async function handleReference(req, res, ctx, session) {
  const body = await ctx.readJson(req);
  const eventId = String(body.eventId || '').trim();
  const purpose = ['策划案', '宣传物料', '其他'].includes(body.purpose) ? body.purpose : '其他';
  const name = String(body.name || '').trim();
  const path = String(body.path || '').trim();
  const repoId = String(body.repoId || ctx.config?.njuboxRepoId || '').trim();
  if (!eventId) return ctx.json(res, 400, { ok: false, message: '缺少活动ID' });
  if (!name || !path) return ctx.json(res, 400, { ok: false, message: '引用模式需要文件名与路径' });

  let verification = '未校验';
  let link = '';
  if (njubox.njuboxStatus(ctx.config).configured) {
    try {
      const probe = await njubox.verifyPathExists(ctx.config, repoId, path);
      verification = probe.exists ? '已校验' : '校验失败';
      link = probe.link || '';
    } catch {
      verification = '校验异常';
    }
  }

  const row = {
    附件ID: ctx.identifier('ATT'),
    活动ID: eventId,
    用途: purpose,
    文件名: name,
    大小: String(body.size || ''),
    校验和: String(body.checksum || `引用模式 · ${verification}`),
    库ID: repoId,
    路径: path,
    下载链接: link,
    上传人: session.username,
    上传时间: new Date().toISOString(),
  };
  const client = await ctx.getBase();
  const result = await client.appendRow(ATTACHMENT_TABLE, row);
  await ctx.recordAudit(req, session, 'event.attachment.add', row['附件ID'], 'success', { eventId, mode: 'reference', purpose });
  return ctx.json(res, 201, { ok: true, attachment: toAttachmentView({ ...row, _id: result?._id || null }) });
}

/** 上传文件到 box：未配置 Token 时直接 503，且绝不落半条记录。 */
async function handleUpload(req, res, ctx, session) {
  const status = njubox.njuboxStatus(ctx.config);
  if (!status.configured) {
    return ctx.json(res, 503, { ok: false, code: 'njubox_not_configured', message: 'njubox 存储未配置（缺少 API Token），暂时无法上传附件。' });
  }

  let buffer;
  try {
    buffer = await readBodyBuffer(req, MAX_BODY_BYTES);
  } catch (error) {
    if (req.destroyed || res.destroyed) throw error;
    const failure = apiFailure(error);
    return ctx.json(res, failure.status, failure.payload);
  }

  let form;
  try {
    form = await new Response(buffer, { headers: { 'content-type': req.headers['content-type'] } }).formData();
  } catch {
    return ctx.json(res, 400, { ok: false, message: '无法解析上传表单' });
  }

  const file = form.get('file');
  const eventId = String(form.get('eventId') || '').trim();
  const purpose = ['策划案', '宣传物料', '其他'].includes(form.get('purpose')) ? String(form.get('purpose')) : '其他';
  if (!file || !file.size) return ctx.json(res, 400, { ok: false, message: '缺少上传文件' });
  if (!eventId) return ctx.json(res, 400, { ok: false, message: '缺少活动ID' });

  const client = await ctx.getBase();
  let link = '';
  try {
    await njubox.uploadFileBuffer(ctx.config, {
      repoId: ctx.config.njuboxRepoId,
      parentDir: ctx.config.njuboxUploadDir,
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    // The upload response is not a stable download URL; resolve one explicitly.
    link = await njubox.getFileLink(ctx.config, ctx.config.njuboxRepoId, `${ctx.config.njuboxUploadDir === '/' ? '' : ctx.config.njuboxUploadDir}/${file.name}`);
  } catch (error) {
    const failure = apiFailure(error);
    return ctx.json(res, failure.status, failure.payload);
  }

  const digest = createHash('sha256').update(buffer).digest('hex');
  const row = {
    附件ID: ctx.identifier('ATT'),
    活动ID: eventId,
    用途: purpose,
    文件名: file.name,
    大小: String(file.size),
    校验和: digest,
    库ID: ctx.config.njuboxRepoId,
    路径: ctx.config.njuboxUploadDir,
    下载链接: link,
    上传人: session.username,
    上传时间: new Date().toISOString(),
  };
  const result = await client.appendRow(ATTACHMENT_TABLE, row);
  await ctx.recordAudit(req, session, 'event.attachment.add', row['附件ID'], 'success', { eventId, mode: 'upload', purpose });
  return ctx.json(res, 201, { ok: true, attachment: toAttachmentView({ ...row, _id: result?._id || null }) });
}
