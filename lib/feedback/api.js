/* ==========================================================================
   api.js — HTTP routes for platform problem feedback.
   Public submit sits behind portal write (`POST /api/public/feedback`);
   management processing behind console access (`/api/feedback*`). Both submit
   paths and the processing console share the feedback service + state machine.
   ========================================================================== */

export async function feedbackManagementRoutes(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/feedback')) return false;
  const root = '/api/feedback', path = url.pathname.slice(root.length);
  const session = ctx.requireConsoleAccess(req, res, 'settings'); if (!session) return true;
  const actor = ctx.actorFor(session);
  if (!actor) { ctx.json(res, 403, { ok: false, message: '当前账号无问题处理权限。' }); return true; }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !ctx.requireCsrf(req, res, session)) return true;
  const service = ctx.feedback(actor);
  const { json, readJson } = ctx;

  let result;
  if (req.method === 'GET' && path === '') result = await service.list(url.searchParams);
  else if (req.method === 'GET' && path === '/summary') result = await service.summary();
  else if (req.method === 'GET' && path === '/dispatch') result = service.dispatchOptions();
  else if (req.method === 'POST' && path === '') {
    const body = await readJson(req);
    body.source = 'console';
    result = await service.submit(body, { id: actor.id, realName: actor.realName, account: session.username });
  } else if (req.method === 'GET') {
    const idMatch = path.match(/^\/([^/]+)$/);
    if (idMatch) result = await service.get(decodeURIComponent(idMatch[1]));
    else { ctx.json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }
  } else if (req.method === 'POST') {
    const transitionMatch = path.match(/^\/([^/]+)\/transition$/);
    if (transitionMatch) result = await service.transition(decodeURIComponent(transitionMatch[1]), await readJson(req));
    else { ctx.json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }
  } else { ctx.json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) await ctx.audit(req, session, `feedback.${path.split('/')[1] || 'submit'}`, 'success');
  ctx.json(res, 200, result); return true;
}

export async function feedbackPublicRoutes(req, res, url, ctx) {
  if (req.method === 'POST' && url.pathname === '/api/public/feedback') {
    const session = ctx.requirePortalWrite(req, res); if (!session) return;
    ctx.enforceLimit(req, 'feedback', 5, session.username);
    const actor = ctx.actorFor(session);
    const body = await ctx.readJson(req);
    body.source = 'portal';
    const result = await ctx.feedback.submit(body, { id: actor?.id, realName: actor?.realName, account: session.username });
    await ctx.recordAudit(req, session, 'public.feedback.submit', result.issue.id, 'success', { category: body.category });
    return ctx.json(res, 201, result);
  }
  return false;
}
