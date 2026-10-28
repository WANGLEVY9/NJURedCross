import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath, URL } from 'node:url';
import { materialProductionFixture, productionOwner, productionManager } from './material-production-fixture.js';
import { materialManagementRoutes } from '../../lib/materials/management-api.js';
import { publicMaterialRoutes } from '../../lib/materials/public-api.js';
import { createProductionReimbursementApi } from '../../lib/reimbursements/production-api.js';
import { createStaticHandler } from '../../lib/http/static.js';
import { json } from '../../lib/http/response.js';
import { apiFailure } from '../../lib/http/errors.js';
import { createMutationQueue } from '../../lib/events/safety.js';
import { collectRequestBody } from '../../lib/http/request-body.js';
const { Response, File } = globalThis;

export async function materialProductionServer(options = {}) {
  const f = await materialProductionFixture(options), csrf = 'synthetic-materials-csrf', state = Object.assign(f.state, { role: 'owner', signedIn: true, limited: false }), requests = [];
  const user = () => state.role === 'manager' ? productionManager : state.role === 'other' ? { ...productionOwner, id: 'other-owner', studentId: '987654321' } : productionOwner;
  const session = () => ({ username: user().id });
  const requireSession = (_req, res) => { if (!state.signedIn) { json(res, 401, { ok: false, message: '请先登录。' }); return null; } return session(); };
  const requireCsrf = (req, res) => { if (req.headers['x-csrf-token'] !== csrf) { json(res, 403, { ok: false, code: 'csrf_failed', message: '请刷新页面。' }); return false; } return true; };
  const requireWrite = (req, res) => { const s = requireSession(req, res); return s && requireCsrf(req, res) ? s : null; };
  const requireConsole = (req, res) => {
    const s = requireSession(req, res); if (!s) return null;
    if (state.role !== 'manager') { json(res, 403, { ok: false, message: '需要管理权限。' }); return null; } return s;
  };
  const readJson = async req => JSON.parse(await collectRequestBody(req, 100000) || '{}');
  const readAction = async req => {
    if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) return { body: await readJson(req), photo: null };
    const form = await new Response(await collectRequestBody(req, 8 * 1024 ** 2), { headers: { 'content-type': req.headers['content-type'] } }).formData();
    const body = {}; for (const [key, value] of form) { if (!(value instanceof File)) Object.defineProperty(body, key, { value, enumerable: true }); }
    return { body, photo: form.get('photo') };
  };
  const portal = { catalog: async () => (await f.workflow.overview(productionManager)).inventory.filter(item => item.availability !== 'disabled').map(item => ({ id: item.id, assetCode: item.code, name: item.name, remaining: item.quantity, unit: item.unit })),
    eligibility: async () => ({ eligible: true, status: 'eligible' }) };
  const publicCtx = { portal, returns: f.workflow, client: f.client, json, actorFor: user, requirePortalSession: requireSession, requirePortalWrite: requireWrite, readJson, readAction,
    enforceLimit: () => { if (state.limited) throw Object.assign(Error('Synthetic rate limit'), { statusCode: 429 }); }, recordAudit: async () => {} };
  const adminCtx = { workflow: f.workflow, core: f.core, client: f.client, json, actorFor: user, requireConsoleAccess: requireConsole, requireCsrf, readAction, readJson,
    performApplication: f.perform, audit: async () => {} };
  const financeConfig = { enabled: false, allowWrites: false, table: {}, box: {} };
  const finance = createProductionReimbursementApi({ config: financeConfig, service: {}, store: {}, actorFor: () => ({ ...user(), financePermissions: [] }), requirePortalSession: requireSession, requirePortalWrite: requireWrite });
  const staticHandler = createStaticHandler(fileURLToPath(new URL('../../public/', import.meta.url))), queue = createMutationQueue();
  const dispatch = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); requests.push({ path: url.pathname, method: req.method });
    try {
      if (url.pathname === '/api/auth/session') return json(res, 200, { ok: true, authenticated: state.signedIn, csrfToken: csrf, user: state.signedIn ? {
        ...user(), username: user().id, role: state.role === 'manager' ? 'platform_admin' : 'member', consoleAccess: state.role === 'manager', permissions: state.role === 'manager' ? ['materials'] : [], localPreview: false } : null });
      if (await publicMaterialRoutes(req, res, url, publicCtx) !== false) return;
      if (await materialManagementRoutes(req, res, url, adminCtx) !== false) return;
      if (await finance(req, res, url) !== false) return;
      if (url.pathname === '/api/public/warmth/capabilities') return json(res, 200, { ok: true, morning: { enabled: false }, birthday: { enabled: false } });
      if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, message: 'Isolated route not mounted' });
      await staticHandler(req, res, url);
    } catch (error) { const result = apiFailure(error); json(res, result.status, result.payload); }
  };
  const server = http.createServer((req, res) => { void (req.method === 'GET' ? dispatch(req, res) : queue(() => dispatch(req, res))); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { ...f, state, csrf, requests, financeConfig, server, origin: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); f.close(); } };
}
