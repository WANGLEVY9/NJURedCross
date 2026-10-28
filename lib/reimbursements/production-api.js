import { json } from '../http/response.js';
import { configuredReimbursementStorage, reimbursementReviewerBindings } from './config.js';
import { createReimbursementLocalHandler } from './local-http.js';
import { bankAccountError } from '../../public/app/shared/reimbursement-bank-account.js';

export function productionFinancePermissions(account, bindings = reimbursementReviewerBindings()) {
  const base = account?.role === 'super_admin' ? ['view', 'payment'] : [];
  const id = account?.accountId;
  if (!id || Object.values(bindings).filter(value => value === id).length !== 1) return base;
  return [...new Set([...base, ...(bindings.final === id ? ['final', 'view'] : [bindings['initial-suzhou'], bindings['initial-other']].includes(id) ? ['initial'] : [])])];
}
export const reimbursementFeatureEnabled = config => {
  const status = configuredReimbursementStorage(config);
  return status.enabled && status.tableConfigured && status.boxConfigured && status.writeEnabled;
};
export function productionReimbursementActor(account, bindings = reimbursementReviewerBindings()) {
  if (!account?.accountId && !account?.username) return null;
  return { id: account.accountId || account.username, realName: account.realName || '', studentId: account.studentId || '',
    email: account.email || '', phone: account.phone || '', emailVerified: account.emailVerified === true, financePermissions: productionFinancePermissions(account, bindings),
    ...(account.accountId ? { financeRegion: Object.keys(bindings).find(key => key.startsWith('initial-') && bindings[key] === account.accountId) || '' } : {}) };
}
function requireApplicant(actor) {
  if (!actor.realName || !actor.studentId || !actor.email || !actor.emailVerified) throw Object.assign(new Error('请先完善真实姓名、学号及已验证邮箱。'), { statusCode: 403 });
}
function submission(actor, body) {
  requireApplicant(actor);
  const message = body.bankAccount === undefined ? '' : bankAccountError(body.bankAccount);
  if (message || !body.activityId || !body.expenseItems?.length) throw Object.assign(new Error(message || '请选择活动并填写支出明细。'), { statusCode: 400 });
  return { ...body, name: actor.realName };
}
export function createProductionReimbursementApi({ config, service, store, actorFor, requirePortalSession, requirePortalWrite, enforceLimit = () => {} }) {
  const root = '/api/reimbursements', handler = createReimbursementLocalHandler(service, { root, local: false, prepareSubmission: submission });
  return async (req, res, url) => {
    if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
    const session = req.method === 'POST' ? requirePortalWrite(req, res) : requirePortalSession(req, res);
    if (!session) return true;
    const actor = await actorFor(session);
    if (!actor) { json(res, 403, { ok: false, message: '当前账号不可用，请重新登录。' }); return true; }
    if (req.method === 'GET' && url.pathname === `${root}/readiness`) {
      if (!actor.financePermissions.length) { json(res, 403, { ok: false, message: '需要财务管理权限。' }); return true; }
      const status = configuredReimbursementStorage(config);
      const schema = status.tableConfigured ? await store.inspect() : null;
      json(res, 200, { ok: true, ...status, schema, ready: reimbursementFeatureEnabled(config) && schema?.ready === true }); return true;
    }
    if (!reimbursementFeatureEnabled(config)) {
      json(res, 503, { ok: false, code: 'reimbursements_not_ready', message: '报销存储尚未配置完成，请稍后再试。' }); return true;
    }
    if (!['GET', 'POST'].includes(req.method)) { json(res, 405, { ok: false, message: '不支持该操作。' }); return true; }
    if (req.method === 'POST') {
      const upload = url.pathname === `${root}/bundles`;
      enforceLimit(req, upload ? 'reimbursement-upload' : 'reimbursement-action', upload ? 20 : 120, actor.id);
      if (upload || url.pathname === root || /\/resubmit$/.test(url.pathname)) requireApplicant(actor);
    }
    return handler(req, res, url, actor);
  };
}
