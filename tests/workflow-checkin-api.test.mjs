/**
 * 增量回归测试：签到凭证相关接口的权限门禁与接线（main 后端契约）。
 *
 * 复用既有 member / platform_admin / super_admin 门禁：
 *   · 控制台签发凭证（registrations/:id/checkin-ticket）需 console 访问 + CSRF + 同源；
 *   · 控制台核验签到（registrations/:id/checkin，带 ticket）需 console 访问 + CSRF + 同源，缺 ticket 返回 400；
 *   · 门户“自助签发凭证”接口在 main 中不存在（现场凭证由控制台签发），调用返回 404。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowRoutes } from '../lib/events/workflow-api.js';

function makeCtx({ consoleRole = 'platform_admin', csrf = true, crossOrigin = false } = {}) {
  let writes = 0;
  return {
    json: (_res, status, body) => ({ status, body }),
    getWorkflow: async () => ({
      read: async () => ({ events: [], registrations: [], checkins: [], ledger: [], summaries: [], profiles: [] }),
      issueCheckinTicket: async (id, actor) => { writes++; return { ticket: `TICKET-${id}`, expiresAt: new Date().toISOString(), 注册行: id, 活动ID: 'A' }; },
      checkinByTicket: async (ticket, actor, note) => { writes++; return { _id: 'ck-1', 报名行ID: 'r-1', 活动ID: 'A', 核验人: actor, 核验说明: note, 活动时间: new Date().toISOString() }; },
    }),
    requireConsoleAccess: () => (consoleRole ? { role: consoleRole } : null),
    requirePortalSession: () => ({ username: 'student' }),
    requireCsrf: () => csrf,
    readJson: async req => req.body || {},
    getAccount: async () => ({ accountId: 'student', campus: '鼓楼', studentId: '999990001', department: '合成院系', grade: '2023级' }),
    actor: () => 'verifier',
    audit: async () => {},
    writes: () => writes,
  };
}
const req = (method = 'GET', body, crossOrigin = false) => ({ method, body, headers: { host: 'localhost', ...(crossOrigin ? { origin: 'https://other.test' } : {}) } });

test('console ticket issue requires console access', async () => {
  const c = makeCtx({ consoleRole: null });
  const out = await workflowRoutes(req('POST', {}), null, new URL('http://localhost/api/volunteer/workflow/registrations/r-1/checkin-ticket'), c);
  assert.equal(out, undefined);
  assert.equal(c.writes(), 0);
});

test('console ticket issue is blocked without CSRF or from a cross-origin request', async () => {
  const noCsrf = makeCtx({ csrf: false });
  assert.equal(await workflowRoutes(req('POST', {}), null, new URL('http://localhost/api/volunteer/workflow/registrations/r-1/checkin-ticket'), noCsrf), undefined);
  const cross = makeCtx({ crossOrigin: true });
  assert.equal((await workflowRoutes(req('POST', {}, true), null, new URL('http://localhost/api/volunteer/workflow/registrations/r-1/checkin-ticket'), cross)).status, 403);
  assert.equal(noCsrf.writes(), 0);
});

test('console ticket issue returns a ticket for an authenticated admin', async () => {
  const c = makeCtx();
  const out = await workflowRoutes(req('POST', {}), null, new URL('http://localhost/api/volunteer/workflow/registrations/r-1/checkin-ticket'), c);
  assert.equal(out.status, 200);
  assert.equal(typeof out.body.result.ticket, 'string');
});

test('console check-in by ticket requires console access and rejects a missing ticket', async () => {
  const denied = makeCtx({ consoleRole: null });
  assert.equal(await workflowRoutes(req('POST', { ticket: 'TICKET' }), null, new URL('http://localhost/api/volunteer/workflow/registrations/r-1/checkin'), denied), undefined);
  const c = makeCtx();
  const missing = await workflowRoutes(req('POST', { note: '无凭证' }), null, new URL('http://localhost/api/volunteer/workflow/registrations/r-1/checkin'), c);
  assert.equal(missing.status, 400);
  assert.equal(c.writes(), 0);
});

test('console check-in by ticket verifies and returns the trace', async () => {
  const c = makeCtx();
  const out = await workflowRoutes(req('POST', { ticket: 'TICKET', note: '核对身份' }), null, new URL('http://localhost/api/volunteer/workflow/registrations/r-1/checkin'), c);
  assert.equal(out.status, 200);
  assert.equal(out.body.result.核验人, 'verifier');
  assert.equal(out.body.result.核验说明, '核对身份');
});

test('portal self-issued check-in credential route is not present in main', async () => {
  const c = makeCtx();
  const out = await workflowRoutes(req('POST', {}), null, new URL('http://localhost/api/portal/workflow/registrations/WR-x/checkin-credential'), c);
  assert.equal(out.status, 404);
});
