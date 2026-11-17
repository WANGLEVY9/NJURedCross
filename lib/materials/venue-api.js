/* ==========================================================================
   venue-api.js — HTTP routes for activity-room borrowing.
   Management routes sit behind console access (`/api/venues*`); public routes
   sit behind portal session for writes (`/api/public/venues*`). Both delegate
   to the venue service so conflict checking and the state machine live in one
   place.
   ========================================================================== */

export async function venueManagementRoutes(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/venues')) return false;
  const root = '/api/venues', path = url.pathname.slice(root.length);
  const session = ctx.requireConsoleAccess(req, res); if (!session) return true;
  const actor = ctx.actorFor(session);
  if (!actor) { ctx.json(res, 403, { ok: false, message: '当前账号无场地管理权限。' }); return true; }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !ctx.requireCsrf(req, res, session)) return true;
  const service = ctx.venue(actor);
  const { json, readJson } = ctx;

  let result;
  if (req.method === 'GET' && path === '') result = await service.rooms(false);
  else if (req.method === 'GET' && path === '/calendar') result = await service.calendar(url.searchParams);
  else if (req.method === 'GET' && path === '/applications') result = await service.listApplications(url.searchParams);
  else if (req.method === 'POST' && path === '/rooms') result = await service.createRoom(await readJson(req));
  else if (req.method === 'PATCH') {
    const roomMatch = path.match(/^\/rooms\/([^/]+)$/);
    if (roomMatch) result = await service.updateRoom(decodeURIComponent(roomMatch[1]), await readJson(req));
    else { ctx.json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }
  } else if (req.method === 'POST') {
    const reviewMatch = path.match(/^\/applications\/([^/]+)\/review$/);
    const cancelMatch = path.match(/^\/applications\/([^/]+)\/cancel$/);
    if (reviewMatch) result = await service.reviewApplication(decodeURIComponent(reviewMatch[1]), await readJson(req));
    else if (cancelMatch) result = await service.cancelApplication(decodeURIComponent(cancelMatch[1]), null, { admin: true });
    else { ctx.json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }
  } else { ctx.json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) await ctx.audit(req, session, `venue.${path.split('/')[1] || 'list'}`, 'success');
  ctx.json(res, 200, result); return true;
}

export async function venuePublicRoutes(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/public/venues')) return false;
  const { json, readJson } = ctx;
  const roomList = url.pathname === '/api/public/venues';
  const mine = url.pathname === '/api/public/venues/my-applications';

  if (req.method === 'GET' && roomList) return json(res, 200, await ctx.venue.rooms(true));
  if (req.method === 'GET' && mine) {
    const session = ctx.requirePortalSession(req, res); if (!session) return;
    const data = await ctx.venue.listApplications(url.searchParams);
    data.applications = data.applications.filter(application => application.applicantAccount === session.username);
    return json(res, 200, data);
  }

  const submitMatch = url.pathname.match(/^\/api\/public\/venues\/([^/]+)\/applications$/);
  if (submitMatch && req.method === 'POST') {
    const session = ctx.requirePortalWrite(req, res); if (!session) return;
    ctx.enforceLimit(req, 'venue-application', 10, session.username);
    const actor = ctx.actorFor(session);
    const body = await readJson(req);
    body.roomId = decodeURIComponent(submitMatch[1]);
    const result = await ctx.venue.submitApplication(body, { id: actor?.id, realName: actor?.realName, account: session.username });
    await ctx.recordAudit(req, session, 'public.venue.application', result.application.id, 'success', { roomId: body.roomId, start: body.start });
    return json(res, 201, result);
  }

  const cancelMatch = url.pathname.match(/^\/api\/public\/venues\/applications\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    const session = ctx.requirePortalWrite(req, res); if (!session) return;
    const result = await ctx.venue.cancelApplication(decodeURIComponent(cancelMatch[1]), session.username, { admin: false });
    await ctx.recordAudit(req, session, 'public.venue.application.cancel', result.application.id, 'success', {});
    return json(res, 200, result);
  }

  return false;
}
