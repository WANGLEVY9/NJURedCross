/** Local synthetic materials preview. No .env, SeaTable client, SMTP or external fetch. */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createMaterialsService } from '../lib/materials/service.js';
import { createMaterialsFixtures, FIXTURE_TABLES } from '../lib/materials/fixtures.js';
import { createPreviewLifecycle } from '../lib/materials/preview-lifecycle.js';
import { createLocalMovements } from '../lib/materials/local-movements.js';
import { createLocalMaterialsPortal } from '../lib/materials/local-portal.js';
import { createStaticHandler } from '../lib/http/static.js';
import { json, securityHeaders } from '../lib/http/response.js';
import { apiFailure } from '../lib/http/errors.js';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { createReimbursementLocalHandler } from '../lib/reimbursements/local-http.js';
import { UPLOAD_LIMITS } from '../public/app/shared/reimbursement-limits.js';

export const PREVIEW_NOTICE = '本地合成数据：只用于物资管理开发与演示，所有修改仅保存在内存，重启后重置。登录为模拟会话。';
const COOKIE_NAME = 'synthetic_materials_session';

function failure(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw failure(413, '本地预览请求体超过大小限制');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = await readBody(req);
  try {
    const value = JSON.parse(raw.length ? raw.toString('utf8') : '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw failure(400, '请求体必须是 JSON 对象');
  }
}

async function readAction(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().startsWith('multipart/form-data')) return { body: await readJson(req), photo: null };
  const raw = await readBody(req, 8 * 1024 * 1024 + 64 * 1024);
  let form;
  try {
    form = await new Request('http://127.0.0.1/materials-preview-upload', {
      method: 'POST', headers: { 'Content-Type': type }, body: raw,
    }).formData();
  } catch {
    throw failure(400, '照片表单格式不正确');
  }
  const body = {};
  for (const [key, value] of form) if (typeof value === 'string') body[key] = value;
  const photo = form.get('photo');
  return { body, photo: photo instanceof File && photo.size ? photo : null };
}

/** Enforce loopback even when a caller omits a host or tries to widen it. */
function restrictListen(server) {
  const listen = server.listen.bind(server);
  server.listen = (...args) => {
    if (typeof args[0] === 'object' && args[0] !== null) {
      const options = args[0];
      if (options.path || options.fd !== undefined || options.handle || !Number.isInteger(options.port)
        || (options.host && options.host !== '127.0.0.1')) throw new Error('合成预览仅允许监听 127.0.0.1');
      return listen({ ...options, host: '127.0.0.1' }, ...args.slice(1));
    }
    if (typeof args[0] !== 'number') throw new Error('合成预览必须使用本机 TCP 端口');
    if (typeof args[1] === 'string') {
      if (args[1] !== '127.0.0.1') throw new Error('合成预览仅允许监听 127.0.0.1');
      return listen(...args);
    }
    return listen(args[0], '127.0.0.1', ...args.slice(1));
  };
  return server;
}

/** Importing this module does not open a port. Each instance owns fresh synthetic rows. */
export async function createPreviewServer({
  signedIn = true, seedSyncFailure = true, fixture = createMaterialsFixtures(),
  sourceInfo = null, reimbursementService = null, activitySource = null,
  portalActor = { id: 'synthetic-materials-admin', memberCode: 'LOCAL-DEMO-MEMBER', canReview: true },
  publicDir = fileURLToPath(new URL('../public/', import.meta.url)),
} = {}) {
  const photos = new Map();
  let photoSequence = 0;
  const uploadPhoto = async (file) => {
    if (!file) return null;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw failure(400, '仅支持 JPG、PNG、WebP 照片');
    if (file.size > 8 * 1024 * 1024) throw failure(413, '照片不能超过 8 MB');
    const path = `/api/preview/photos/${++photoSequence}`;
    photos.set(path, { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return path;
  };
  const actor = sourceInfo ? '本地模拟管理员' : '本地合成管理员';
  const coreService = createMaterialsService({ client: fixture.client, listRows: fixture.listRows,
    uploadPhoto, actor, ...(sourceInfo ? {} : { today: () => '2026-10-04' }) });
  if (seedSyncFailure) {
    // Exercise the actual recovery path rather than inventing a second ledger format.
    fixture.failNextUpdate(FIXTURE_TABLES.applications, 'synthetic-sync');
    const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
    try {
      await coreService.applicationAction('synthetic-sync', 'checkout', {
        assetCode: 'NJU-RC-synthetic-camera', quantity: 1, idempotencyKey: 'fixture:pending-sync',
        note: '合成场景：库存流水已记账，申请状态等待补齐',
      }, new File([onePixelPng], 'synthetic.png', { type: 'image/png' }));
    } catch (error) {
      if (error.statusCode !== 502) throw error;
    }
  }
  const service = createPreviewLifecycle({ service: coreService, fixture, actor, seedDisabled: !sourceInfo,
    ...(sourceInfo ? { now: () => new Date().toISOString() } : {}) });
  const registerMovement = createLocalMovements(service);
  const portal = createLocalMaterialsPortal({ service, fixture });
  const reimbursements = reimbursementService || createLocalReimbursementService();
  for (const activity of activitySource?.activities || []) await reimbursements.summaries.saveActivity({ id: 'local-source-loader', canReview: true }, activity);
  const reimbursementHandler = createReimbursementLocalHandler(reimbursements);
  const staticFile = createStaticHandler(publicDir);
  const pdfAssets = createStaticHandler(fileURLToPath(new URL('../node_modules/pdfjs-dist/', import.meta.url)));
  const sessions = new Map();
  const audit = [];
  const preview = { synthetic: !sourceInfo, message: sourceInfo
    ? '真实 API 本地副本：远端只读，所有登记仅保存在本机内存；重启后清空本地改动。登录为模拟会话。'
    : PREVIEW_NOTICE, authentication: 'simulated-session', ...(sourceInfo ? { source: sourceInfo, remoteWrites: false } : {}) };
  function getSession(req, res) {
    const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    let session = sessions.get(cookie);
    if (!session) {
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(24).toString('hex');
      session = { authenticated: signedIn, csrf: randomBytes(24).toString('hex') };
      sessions.set(id, session);
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Strict; Path=/`);
    }
    return session;
  }
  function sessionPayload(session) {
    return { ok: true, authenticated: session.authenticated, preview,
      ...(session.authenticated ? { csrfToken: session.csrf, user: {
        username: portalActor.id, memberCode: portalActor.memberCode, realName: '本地测试申请人', studentId: 'LOCAL-DEMO', email: 'local-demo@example.invalid',
        role: portalActor.canReview ? 'platform_admin' : 'volunteer', roleLabel: '本地模拟会话',
        label: sourceInfo ? '真实数据副本 · 本地模拟会话' : '本地合成数据 · 模拟会话', consoleAccess: portalActor.canReview, permissions: portalActor.canReview ? ['materials'] : [],
        surfaces: portalActor.canReview ? ['console', 'portal'] : ['portal'], synthetic: !sourceInfo, localPreview: true,
      } } : {}) };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Preview-Data', sourceInfo ? 'api-snapshot-local-writes-only' : 'synthetic-memory-only');
    try {
      const port = server.address()?.port;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !allowedHosts.has(req.headers.host)) {
        throw failure(403, '本地合成预览只接受本机地址访问', 'preview_loopback_only');
      }
      if (req.headers.origin && ![...allowedHosts].some((host) => req.headers.origin === `http://${host}`)) {
        throw failure(403, '本地合成预览拒绝外部来源', 'preview_origin_rejected');
      }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) {
        const session = getSession(req, res);
        if (req.method === 'GET' && url.pathname === '/api/auth/session') return json(res, 200, sessionPayload(session));
        if (req.method === 'GET' && url.pathname === '/api/public/materials/catalog') return json(res, 200, await portal.catalog());
        if (req.method === 'POST' && url.pathname === '/api/auth/login') {
          await readJson(req); // User credentials are neither validated nor retained in this simulation.
          session.authenticated = true;
          session.csrf = randomBytes(24).toString('hex');
          return json(res, 200, sessionPayload(session));
        }
        if (!session.authenticated) throw failure(401, '请进入本地模拟会话', 'preview_session_required');
        if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf) {
          throw failure(403, '本地模拟会话的 CSRF 校验失败', 'csrf_failed');
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
          session.authenticated = false;
          session.csrf = randomBytes(24).toString('hex');
          return json(res, 200, { ok: true, preview });
        }
        if (url.pathname === '/api/preview/reimbursements/config' && req.method === 'GET') return json(res, 200, {
          ok: true, local: true, notice: reimbursements.list(portalActor).notice, activityWarning: activitySource?.warning || '',
          limits: UPLOAD_LIMITS,
        });
        if (url.pathname === '/api/public/materials/requests' && req.method === 'POST') {
          const result = await portal.borrow(portalActor, await readJson(req)); return json(res, result.duplicate ? 200 : 201, { ...result, preview });
        }
        if (url.pathname === '/api/public/materials/inbound' && req.method === 'POST') {
          const result = await portal.submitInbound(portalActor, await readJson(req)); return json(res, result.duplicate ? 200 : 201, { ...result, preview });
        }
        if (req.method === 'GET' && ['/api/public/materials/inbound', '/api/preview/materials/inbound'].includes(url.pathname))
          return json(res, 200, { ...portal.listInbound(portalActor, url.pathname.includes('/preview/')), preview });
        const inboundReview = url.pathname.match(/^\/api\/preview\/materials\/inbound\/([^/]+)\/review$/);
        if (inboundReview && req.method === 'POST') return json(res, 200, { ...await portal.reviewInbound(portalActor, decodeURIComponent(inboundReview[1]), await readJson(req)), preview });
        if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, {
          ok: true, server: sourceInfo ? 'local-api-sandbox' : 'local-synthetic', tableCount: 4, tables: Object.values(FIXTURE_TABLES), preview,
        });
        if (req.method === 'GET' && url.pathname === '/api/notifications/overview') return json(res, 200, {
          ok: true, items: [], stats: { high: 0, medium: 0, low: 0 }, preview,
        });
        if (req.method === 'GET' && url.pathname === '/api/audit/recent') return json(res, 200, {
          ok: true, entries: audit.slice(-60).reverse(), preview,
        });
        const photo = photos.get(url.pathname);
        if (req.method === 'GET' && photo) {
          res.writeHead(200, { ...securityHeaders(), 'Content-Type': photo.type, 'Cache-Control': 'no-store' });
          return res.end(photo.bytes);
        }
        if (await reimbursementHandler(req, res, url, portalActor)) return;
        if (portalActor.canReview !== true) throw failure(403, '需要物资管理权限。');
        let payload;
        let status = 200;
        if (req.method === 'GET' && url.pathname === '/api/materials/overview') payload = await service.overview();
        else if (req.method === 'GET' && url.pathname === '/api/materials/scan') payload = await service.scan(url.searchParams.get('code'));
        else if (req.method === 'GET' && url.pathname === '/api/materials/schema') {
          payload = await service.schema();
          payload.capabilities.stockMovements = { mode: 'local-only', remoteWrites: false };
        }
        else if (req.method === 'GET' && url.pathname === '/api/materials/flows') payload = await service.listFlows(url.searchParams);
        else if (req.method === 'POST' && url.pathname === '/api/preview/materials/movements') {
          const { body, photo } = await readAction(req);
          delete body.photo;
          payload = await registerMovement(body, photo); status = 201;
        }
        else if (req.method === 'POST' && url.pathname === '/api/preview/materials/inventory') {
          payload = await service.createInventory(await readJson(req)); status = 201;
        }
        else if (req.method === 'POST' && url.pathname === '/api/materials/transactions') {
          payload = await service.transaction(await readJson(req)); status = 201;
        } else {
          const inventory = url.pathname.match(/^\/api\/materials\/inventory\/([^/]+)$/);
          const availability = url.pathname.match(/^\/api\/preview\/materials\/inventory\/([^/]+)\/availability$/);
          const qr = url.pathname.match(/^\/api\/materials\/inventory\/([^/]+)\/qr$/);
          const flow = url.pathname.match(/^\/api\/materials\/flows\/([^/]+)\/(retry-sync|review)$/);
          const application = url.pathname.match(/^\/api\/materials\/applications\/([^/]+)\/(approve|reject|checkout|return)$/);
          if (availability && req.method === 'PATCH') payload = await service.changeAvailability(decodeURIComponent(availability[1]), await readJson(req));
          else if (inventory && req.method === 'PATCH') payload = await service.updateInventory(decodeURIComponent(inventory[1]), await readJson(req));
          else if (qr && req.method === 'GET') {
            const code = `NJU-RC-${decodeURIComponent(qr[1])}`;
            await service.scan(code);
            const { default: QRCode } = await import('qrcode');
            const svg = await QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
            res.writeHead(200, { ...securityHeaders(), 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(svg);
          } else if (flow && ((flow[2] === 'retry-sync' && req.method === 'POST')
            || (flow[2] === 'review' && ['PATCH', 'POST'].includes(req.method)))) {
            const id = decodeURIComponent(flow[1]);
            payload = flow[2] === 'retry-sync' ? await service.retrySync(id) : await service.reviewFlow(id, await readJson(req));
          } else if (application && req.method === 'POST') {
            const id = decodeURIComponent(application[1]);
            const action = application[2];
            if (['approve', 'reject'].includes(action)) payload = await service.reviewApplication(id, action === 'approve', await readJson(req));
            else {
              const { body, photo: uploadedPhoto } = await readAction(req);
              payload = await service.applicationAction(id, action, body, uploadedPhoto); status = 201;
            }
          } else throw failure(404, '本地物资合成预览不提供此接口', 'preview_route_not_found');
        }
        if (payload?.syncPending) status = 202;
        else if (payload?.duplicate) status = 200;
        if (!['GET', 'HEAD'].includes(req.method)) audit.push({ id: `synthetic-audit-${audit.length + 1}`,
          actor, action: `${req.method} ${url.pathname}`, result: 'success', time: new Date().toISOString() });
        return json(res, status, { ...payload, preview });
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, '静态预览只允许读取');
      if (/^\/vendor\/pdfjs\/(?:build\/pdf(?:\.worker)?\.mjs|cmaps\/[A-Za-z0-9_-]+\.bcmap|standard_fonts\/[A-Za-z0-9_.-]+)$/.test(url.pathname)) {
        const assetUrl = new URL(url); assetUrl.pathname = url.pathname.replace('/vendor/pdfjs', '');
        return await pdfAssets(req, res, assetUrl);
      }
      return await staticFile(req, res, url);
    } catch (error) {
      const result = apiFailure(error);
      if (!res.headersSent) json(res, result.status, result.payload);
      else res.destroy();
    }
  });
  return restrictListen(server);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3122);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 到 65535 的整数');
  const server = await createPreviewServer();
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, () => {
    console.log(`物资管理本地预览：http://127.0.0.1:${port}/console/materials`);
    console.log(PREVIEW_NOTICE);
    console.log('未加载 .env；不连接 SeaTable；不发送邮件；仅监听 127.0.0.1。');
  });
}
