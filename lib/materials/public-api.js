/** Production borrowing only. Never mounts the memory-only finance service. */
export async function publicMaterialRoutes(req, res, url, ctx) {
  const { portal, client, json, actorFor } = ctx;
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
