import { createLocalMovements } from './local-movements.js';

/** Formal management routes, mounted behind the same materials permission as the ledger. */
export async function materialManagementRoutes(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/materials/')) return false;
  const root = '/api/materials', path = url.pathname.slice(root.length);
  const matched = ['/overview', '/schema', '/scan', '/flows', '/movements', '/inventory', '/returns', '/inbound'].includes(path)
    || /^\/(?:returns|inbound)\/[^/]+\/review$/.test(path)
    || /^\/inventory\/[^/]+(?:\/availability)?$/.test(path)
    || /^\/flows\/[^/]+\/(?:retry-sync|review)$/.test(path);
  if (!matched) return false;
  const session = ctx.requireConsoleAccess(req, res); if (!session) return true;
  const actor = ctx.actorFor(session);
  if (!actor?.canReview) { ctx.json(res, 403, { ok: false, message: '需要物资管理权限。' }); return true; }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !ctx.requireCsrf(req, res, session)) return true;
  const { workflow, core } = ctx, context = { req, session, client: ctx.client };
  let result;
  if (req.method === 'GET' && path === '/overview') result = await workflow.overview(actor);
  else if (req.method === 'GET' && path === '/schema') result = await workflow.schema(actor);
  else if (req.method === 'GET' && path === '/scan') result = await workflow.scan(actor, url.searchParams.get('code'));
  else if (req.method === 'GET' && path === '/flows') result = await core(actor).listFlows(url.searchParams);
  else if (req.method === 'GET' && path === '/returns') result = await workflow.list(actor, true);
  else if (req.method === 'GET' && path === '/inbound') result = await workflow.inbound.list(actor);
  else if (req.method === 'POST' && path === '/movements') {
    const { body, photo } = await ctx.readAction(req);
    result = await createLocalMovements({ transaction: body => workflow.transaction(actor, body),
      applicationAction: (id, action, body, photo) => ctx.performApplication(context, id, action, body, photo) })(body, photo);
  } else if (req.method === 'POST' && path === '/inventory') result = await workflow.createInventory(actor, await ctx.readJson(req));
  else {
    const review = path.match(/^\/(returns|inbound)\/([^/]+)\/review$/), inventory = path.match(/^\/inventory\/([^/]+)(\/availability)?$/), flow = path.match(/^\/flows\/([^/]+)\/(retry-sync|review)$/);
    if (review && req.method === 'POST') result = await workflow.review(actor, decodeURIComponent(review[2]), await ctx.readJson(req), context, review[1] === 'returns' ? 'return' : 'inbound');
    else if (inventory && req.method === 'PATCH') result = inventory[2]
      ? await workflow.changeAvailability(actor, decodeURIComponent(inventory[1]), await ctx.readJson(req))
      : await core(actor).updateInventory(decodeURIComponent(inventory[1]), await ctx.readJson(req));
    else if (flow && flow[2] === 'retry-sync' && req.method === 'POST') result = await core(actor).retrySync(decodeURIComponent(flow[1]));
    else if (flow && flow[2] === 'review' && req.method === 'PATCH') result = await core(actor).reviewFlow(decodeURIComponent(flow[1]), await ctx.readJson(req));
    else { ctx.json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) await ctx.audit(req, session, `materials.${path.split('/')[1]}`, 'success');
  ctx.json(res, 200, result); return true;
}
