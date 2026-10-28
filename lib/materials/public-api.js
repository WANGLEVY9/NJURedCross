import { securityHeaders } from '../http/response.js';
/** Formal borrowing and owned returns. Never mounts an in-memory preview. */
export async function publicMaterialRoutes(req, res, url, ctx) {
  const { portal, client, json, actorFor } = ctx;
  const returnPhoto = url.pathname.match(/^\/api\/public\/materials\/returns\/([^/]+)\/photo$/);
  if (['/api/public/materials/loans', '/api/public/materials/returns'].includes(url.pathname) || returnPhoto) {
    const session = req.method === 'POST' ? ctx.requirePortalWrite(req, res) : ctx.requirePortalSession(req, res);
    if (!session) return;
    const actor = actorFor(session);
    if (!ctx.returns) return json(res, 503, { ok: false, code: 'materials_returns_not_ready', message: '归还登记暂未配置完成，请联系物资负责人。' });
    if (req.method === 'GET' && returnPhoto) {
      const file = await ctx.returns.photo(actor, decodeURIComponent(returnPhoto[1]));
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': file.type, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(file.bytes);
    }
    if (req.method === 'GET') return json(res, 200, url.pathname.endsWith('/loans') ? await ctx.returns.listLoans(actor) : await ctx.returns.list(actor));
    if (req.method !== 'POST' || returnPhoto) return json(res, 405, { ok: false, message: '不支持该操作。' });
    ctx.enforceLimit(req, 'material-return', 20, actor?.id);
    const { body, photo } = await ctx.readAction(req);
    const result = await ctx.returns.submit(actor, body, photo);
    if (!result.duplicate) await ctx.recordAudit(req, session, 'public.materials.return', result.record.id, 'success', {});
    return json(res, result.duplicate ? 200 : 201, result);
  }
  if (req.method === 'GET' && url.pathname === '/api/public/materials/catalog') {
    return json(res, 200, await portal.catalog(client));
  }
  if (req.method === 'GET' && url.pathname === '/api/public/materials/borrow-eligibility') {
    const session = ctx.requirePortalSession(req, res);
    if (!session) return;
    return json(res, 200, await portal.eligibility(actorFor(session)));
  }
  if (req.method === 'POST' && url.pathname === '/api/public/materials/requests') {
    const session = ctx.requirePortalWrite(req, res);
    if (!session) return;
    ctx.enforceLimit(req, 'materials', 5);
    const body = await ctx.readJson(req);
    let result;
    try { result = await portal.request(client, actorFor(session), body); }
    catch (error) {
      // Only messages constructed by our domain may expose a known saved row
      // and retry instructions. Never forward upstream exception details.
      if (error.publicMaterialError === true && error.statusCode === 503) {
        return json(res, 503, { ok: false, code: error.code, message: error.message });
      }
      throw error;
    }
    if (!result.replayed) await ctx.recordAudit(req, session, 'public.materials.application', result.request.code, 'success', { quantity: body.quantity });
    return json(res, result.replayed ? 200 : 201, { ok: true, ...result });
  }
  return false;
}
