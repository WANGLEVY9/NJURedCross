/** Local synthetic materials preview. No .env, SeaTable client, SMTP or external fetch. */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createMaterialsService } from '../lib/materials/service.js';
import { createMaterialsFixtures, FIXTURE_TABLES } from '../lib/materials/fixtures.js';
import { createStaticHandler } from '../lib/http/static.js';
import { json, securityHeaders } from '../lib/http/response.js';
import { apiFailure } from '../lib/http/errors.js';

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
  const service = createMaterialsService({ client: fixture.client, listRows: fixture.listRows,
    uploadPhoto, actor: '本地合成管理员', today: () => '2026-10-04' });
  if (seedSyncFailure) {
    // Exercise the actual recovery path rather than inventing a second ledger format.
    fixture.failNextUpdate(FIXTURE_TABLES.applications, 'synthetic-sync');
    const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
    try {
      await service.applicationAction('synthetic-sync', 'checkout', {
        assetCode: 'NJU-RC-synthetic-camera', quantity: 1, idempotencyKey: 'fixture:pending-sync',
        note: '合成场景：库存流水已记账，申请状态等待补齐',
      }, new File([onePixelPng], 'synthetic.png', { type: 'image/png' }));
    } catch (error) {
      if (error.statusCode !== 502) throw error;
    }
  }
  const staticFile = createStaticHandler(publicDir);
  const sessions = new Map();
  const audit = [];
  const preview = { synthetic: true, message: PREVIEW_NOTICE, authentication: 'simulated-session' };
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
        username: 'synthetic-materials-admin', role: 'platform_admin', roleLabel: '本地模拟管理员',
        label: '本地合成数据 · 物资管理员', consoleAccess: true, permissions: ['materials'],
        surfaces: ['console'], synthetic: true,
      } } : {}) };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Preview-Data', 'synthetic-memory-only');
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
        if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, {
          ok: true, server: 'local-synthetic', tableCount: 4, tables: Object.values(FIXTURE_TABLES), preview,
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
        let payload;
        let status = 200;
        if (req.method === 'GET' && url.pathname === '/api/materials/overview') payload = await service.overview();
        else if (req.method === 'GET' && url.pathname === '/api/materials/scan') payload = await service.scan(url.searchParams.get('code'));
        else if (req.method === 'GET' && url.pathname === '/api/materials/schema') payload = await service.schema();
        else if (req.method === 'GET' && url.pathname === '/api/materials/flows') payload = await service.listFlows(url.searchParams);
        else if (req.method === 'POST' && url.pathname === '/api/materials/transactions') {
          payload = await service.transaction(await readJson(req)); status = 201;
        } else {
          const inventory = url.pathname.match(/^\/api\/materials\/inventory\/([^/]+)$/);
          const qr = url.pathname.match(/^\/api\/materials\/inventory\/([^/]+)\/qr$/);
          const flow = url.pathname.match(/^\/api\/materials\/flows\/([^/]+)\/(retry-sync|review)$/);
          const application = url.pathname.match(/^\/api\/materials\/applications\/([^/]+)\/(approve|reject|checkout|return)$/);
          if (inventory && req.method === 'PATCH') payload = await service.updateInventory(decodeURIComponent(inventory[1]), await readJson(req));
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
          actor: '本地合成管理员', action: `${req.method} ${url.pathname}`, result: 'success', time: '2026-10-04T12:00:00+08:00' });
        return json(res, status, { ...payload, preview });
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, '静态预览只允许读取');
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
