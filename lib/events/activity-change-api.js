const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const objectWith = (body, allowed) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => allowed.includes(key));

/** Runs only inside workflowRoutes, after session, activity authority and CSRF checks. */
export async function activityChangeRoutes(req, res, url, ctx, workflow, session) {
  const match = url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/change-request(?:\/(preview)|\/([^/]+)\/review)?$/);
  if (!match) return false;
  const service = workflow.activityChanges;
  if (!service) return ctx.json(res, 503, { ok: false, message: '活动变更审核尚未启用' });
  const event = decodeURIComponent(match[1]), preview = Boolean(match[2]), requestId = match[3] && decodeURIComponent(match[3]);
  const actor = ctx.actor(session);
  if (preview) {
    if (req.method !== 'POST') return ctx.json(res, 405, { ok: false, message: '预览仅支持 POST' });
    const body = await ctx.readJson(req);
    if (!objectWith(body, ['patch', 'expectedDigest']) || typeof body.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedDigest) || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) return ctx.json(res, 400, { ok: false, message: '变更预览字段或活动版本无效' });
    return ctx.json(res, 200, { ok: true, result: await service.preview(event, body.patch, { actor, expectedDigest: body.expectedDigest }) });
  }
  if (req.method === 'GET' && !requestId) {
    const id = url.searchParams.get('request');
    if (id !== null && !identifier(id)) return ctx.json(res, 400, { ok: false, message: '变更申请编号无效' });
    const result = id ? await service.get(id, actor, event) : await service.active(event, actor);
    return ctx.json(res, 200, { ok: true, result, ...await service.context(event, actor) });
  }
  if (req.method === 'POST' && !requestId) {
    const body = await ctx.readJson(req);
    if (!objectWith(body, ['requestId', 'patch', 'expectedDigest']) || !identifier(body.requestId) || typeof body.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedDigest) || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) return ctx.json(res, 400, { ok: false, message: '变更申请字段或活动版本无效' });
    const result = await service.submit(event, body.patch, { actor, requestId: body.requestId, expectedDigest: body.expectedDigest });
    await ctx.audit(req, session, 'workflow.events.change.submit', body.requestId);
    return ctx.json(res, 201, { ok: true, result });
  }
  if (req.method === 'POST' && requestId) {
    const body = await ctx.readJson(req);
    if (!identifier(requestId) || !objectWith(body, ['version', 'decision', 'reason']) || !Number.isInteger(body.version) || body.version < 1 || !['approve', 'return'].includes(body.decision) || body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500) || body.decision === 'return' && !body.reason?.trim()) return ctx.json(res, 400, { ok: false, message: '变更审核字段或退回原因无效' });
    // Bind the request to the event path before invoking its mutation service.
    await service.get(requestId, actor, event);
    const result = await service.review(requestId, { actor, version: body.version, decision: body.decision, reason: body.reason || '' });
    await ctx.audit(req, session, `workflow.events.change.${body.decision}`, requestId);
    return ctx.json(res, 200, { ok: true, result });
  }
  return ctx.json(res, 405, { ok: false, message: '此变更接口不支持该操作' });
}
