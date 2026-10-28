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
export function reimbursementAvailability(config) {
  const status = configuredReimbursementStorage(config);
  const missing = Object.entries(status).filter(([, value]) => !value).map(([key]) => key);
  return { available: !missing.length, code: !status.enabled ? 'reimbursements_disabled'
    : !status.tableConfigured || !status.boxConfigured ? 'reimbursements_storage_not_configured' : !status.writeEnabled ? 'reimbursements_writes_disabled' : '',
    message: !status.enabled ? '财务报销尚未正式开放，请联系财务负责人。'
      : !status.tableConfigured || !status.boxConfigured ? '财务报销正在完成存储配置，暂不能提交申请，请联系财务负责人。'
        : !status.writeEnabled ? '财务报销暂未开放提交，请联系财务负责人。' : '', missing };
}
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
    // Configuration availability is readable without loading a business journal.
    // Closed services remain closed: this is never a fallback to demo storage.
    const availability = reimbursementAvailability(config);
    if (req.method === 'GET' && url.pathname === `${root}/config` && !availability.available) {
      json(res, 200, { ok: true, local: false, persistent: true, available: false, code: availability.code, message: availability.message }); return true;
    }
    if (req.method === 'GET' && url.pathname === `${root}/readiness`) {
      if (!actor.financePermissions.length) { json(res, 403, { ok: false, message: '需要财务管理权限。' }); return true; }
      const status = configuredReimbursementStorage(config);
      const schema = status.tableConfigured ? await store.inspect() : null;
      json(res, 200, { ok: true, ...status, missing: availability.missing, schema, ready: reimbursementFeatureEnabled(config) && schema?.ready === true }); return true;
    }
    if (!reimbursementFeatureEnabled(config)) {
      json(res, 503, { ok: false, code: availability.code, message: availability.message }); return true;
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
