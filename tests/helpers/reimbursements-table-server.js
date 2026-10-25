import http from 'node:http';
import { once } from 'node:events';
import { URL, fileURLToPath } from 'node:url';
import { reimbursementTableFixture } from './reimbursement-table-fixture.js';
import { createProductionReimbursementApi, productionReimbursementActor, reimbursementFeatureEnabled } from '../../lib/reimbursements/production-api.js';
import { createStaticHandler } from '../../lib/http/static.js';
import { createPdfAssets } from '../../lib/http/pdf-assets.js';
import { renderTestSummary } from './reimbursement-summary-renderer.js';
import { apiFailure } from '../../lib/http/errors.js';
import { json } from '../../lib/http/response.js';
import { resolveFinanceReviewerBindings } from '../../lib/reimbursements/review-routing.js';

export async function reimbursementTableServer({ workflowVersion = 3 } = {}) {
  const fixture = reimbursementTableFixture(), csrf = 'synthetic-finance-csrf';
  const config = { enabled: true, allowWrites: true, table: { token: 'synthetic-token', uuid: 'synthetic-base' }, box: { ...fixture.box.config } };
  const bindings = { 'initial-suzhou': 'synthetic-initial-suzhou', 'initial-other': 'synthetic-initial-other', final: 'synthetic-final' };
  const state = { username: 'owner', signedIn: true };
  const accounts = new Map([
    ['owner', { username: 'owner', accountId: 'synthetic-owner', role: 'member', realName: '合成申请人', studentId: 'SYNTHETIC', email: 'synthetic@example.invalid', emailVerified: true }],
    ['admin', { username: 'admin', accountId: 'synthetic-admin', role: 'super_admin', realName: '合成审核人' }],
    ['initial-suzhou', { username: 'initial-suzhou', accountId: bindings['initial-suzhou'], role: 'platform_admin', realName: '李婉荣', emailVerified: true, email: 'initial-suzhou@example.invalid' }],
    ['initial-other', { username: 'initial-other', accountId: bindings['initial-other'], role: 'platform_admin', realName: '邹孟窈', emailVerified: true, email: 'initial-other@example.invalid' }],
    ['final', { username: 'final', accountId: bindings.final, role: 'platform_admin', realName: '顾语涵', emailVerified: true, email: 'final@example.invalid' }],
    ['material-admin', { username: 'material-admin', accountId: 'synthetic-material-admin', role: 'platform_admin', permissions: ['materials'] }],
  ]);
  const service = () => fixture.makeService({ workflowVersion, generateSummary: renderTestSummary, activityProvider: async () => [{ eventId: 'synthetic-event', name: '合成活动', startAt: new Date().toISOString(), campus: '苏州', location: '合成地点' }] });
  const authenticate = (req, res) => {
    const username = req.headers['x-synthetic-user'] || state.username;
    if (state.signedIn && accounts.has(username)) return { username };
    json(res, 401, { ok: false, message: '请先登录。' }); return null;
  };
  const makeApi = () => createProductionReimbursementApi({ config, store: fixture.makeStore(), service: service(),
    actorFor: session => productionReimbursementActor(accounts.get(session.username), resolveFinanceReviewerBindings(accounts.values())), requirePortalSession: authenticate,
    requirePortalWrite(req, res) {
      const session = authenticate(req, res); if (!session) return null;
      if (req.headers['x-csrf-token'] === csrf) return session;
      json(res, 403, { ok: false, code: 'csrf_failed' }); return null;
    } });
  let api = makeApi();
  const staticFile = createStaticHandler(fileURLToPath(new URL('../../public/', import.meta.url)));
  const pdfAssets = createPdfAssets();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/api/auth/session') {
        const account = accounts.get(state.username), actor = productionReimbursementActor(account, resolveFinanceReviewerBindings(accounts.values()));
        return json(res, 200, { ok: true, authenticated: state.signedIn, user: state.signedIn ? { ...account, localPreview: false,
          consoleAccess: account.role !== 'member', reimbursementsEnabled: reimbursementFeatureEnabled(config), financePermissions: actor.financePermissions } : null, csrfToken: csrf });
      }
      if (await api(req, res, url) !== false) return;
      if (url.pathname === '/api/public/warmth/capabilities') return json(res, 200, { morning: { enabled: false }, birthday: { enabled: false } });
      if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false });
      if (await pdfAssets(req, res, url)) return;
      await staticFile(req, res, url);
    } catch (error) { const failure = apiFailure(error); json(res, failure.status, failure.payload); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, state, config, fixture, accounts, csrf, origin: `http://127.0.0.1:${server.address().port}`,
    reopen: () => { api = makeApi(); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
