import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { publicMaterialRoutes } from '../../lib/materials/public-api.js';
import { createStaticHandler } from '../../lib/http/static.js';
import { json } from '../../lib/http/response.js';
import { apiFailure } from '../../lib/http/errors.js';
import { publicMaterialsFixture, materialActor } from './public-materials.js';

/** Ephemeral synthetic HTTP host for the real production route module. */
export function publicMaterialsTestServer() {
  const fixture = publicMaterialsFixture(), audit = [], csrf = 'synthetic-csrf-token';
  const state = { signedIn: true, limited: false };
  const session = { username: materialActor.id };
  const requirePortalSession = (req, res) => {
    if (state.signedIn) return session;
    json(res, 401, { ok: false, message: '请先登录。' }); return null;
  };
  const ctx = {
    portal: fixture.portal, client: fixture.client, json, actorFor: () => materialActor,
    requirePortalSession,
    requirePortalWrite(req, res) {
      const actor = requirePortalSession(req, res);
      if (!actor) return null;
      if (req.headers['x-csrf-token'] !== csrf) {
        json(res, 403, { ok: false, code: 'csrf_failed', message: '请刷新后重试。' }); return null;
      }
      return actor;
    },
    enforceLimit() { if (state.limited) throw Object.assign(Error('请求过于频繁。'), { statusCode: 429 }); },
    async readJson(req) { const parts = []; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts)); },
    recordAudit: async (...args) => { audit.push(args); },
  };
  const staticFile = createStaticHandler(fileURLToPath(new URL('../../public/', import.meta.url)));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/api/auth/session') return json(res, 200, { ok: true, authenticated: state.signedIn,
        user: state.signedIn ? { ...materialActor, username: materialActor.id, role: 'member', consoleAccess: false, localPreview: false } : null,
        csrfToken: csrf });
      if (await publicMaterialRoutes(req, res, url, ctx) !== false) return;
      if (url.pathname === '/api/public/warmth/capabilities') return json(res, 200, { morning: { enabled: false }, birthday: { enabled: false } });
      if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, message: '隔离测试未挂载此接口。' });
      await staticFile(req, res, url);
    } catch (error) { const failure = apiFailure(error); json(res, failure.status, failure.payload); }
  });
  return { server, fixture, ctx, state, audit, csrf };
}
