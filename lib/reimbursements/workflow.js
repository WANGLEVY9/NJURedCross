import { assertFrozenExpenses, syncFinanceRequest, applyRequestActivityCorrection } from './finance-items.js';

export const FINANCE_PERMISSIONS = Object.freeze(['initial', 'final', 'view', 'payment']);
export const WORKFLOW_STATUSES = Object.freeze({ pending: '待初审', final_pending: '待复审',
  initial_returned: '复审退回初审', returned: '待申请人补充', approved: '复审通过 · 待打款' });

export function financePermissions(actor) {
  return FINANCE_PERMISSIONS.filter(permission => Array.isArray(actor?.financePermissions) && actor.financePermissions.includes(permission));
}
export function hasFinalApproval(item) {
  return item.workflowVersion >= 2 && item.status === 'approved' && item.initialReview?.revision === item.revision
    && item.initialReview?.bundleId === item.bundleId && item.finalReview?.revision === item.revision && item.finalReview?.bundleId === item.bundleId
    && (item.workflowVersion === 2 || Boolean(item.finalReview?.summaryId));
}
function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }

/** All transitions stay in the service's private queue; the body never grants permissions. */
export function createReimbursementWorkflow({ queue, target, requirePermission, packets, now, requireDistinctReviewers, authorizeInitial = () => {}, prepareEdits = () => { fail(400, '此申请不支持初审修改。'); }, onEdited = () => {}, onInitialApproved = () => {}, onInitialReturned = () => {} }) {
  function review(actor, id, body) {
    target(id, actor, true);
    return queue(() => {
      const item = target(id, actor, true);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action', 'revision', 'stateVersion', 'note', 'materialsChecked', 'changes'].includes(key))) fail(400, '审核请求格式不正确。');
      if (![2, 3].includes(item.workflowVersion)) fail(409, '该申请属于旧审核流程，不能补造初审或复审结论。');
      if (item.revision !== body.revision || item.stateVersion !== body.stateVersion) fail(409, '申请状态或材料版本已变化，请刷新后审核。');
      const initial = ['initial-approve', 'initial-return'].includes(body.action), final = ['final-approve', 'final-return'].includes(body.action);
      if (!initial && !final) fail(400, '请选择初审或复审操作，不能跳过二级审核。');
      requirePermission(actor, initial ? 'initial' : 'final');
      if (initial) authorizeInitial(actor, item);
      if (item.workflowVersion === 3 && body.action === 'final-approve') fail(409, '请在活动终审中生成完整材料并确认通过，不能逐份跳过活动终审。');
      if (initial && !['pending', 'initial_returned'].includes(item.status) || final && item.status !== 'final_pending') fail(409, '该申请不处于当前审核环节。');
      const approve = body.action.endsWith('-approve');
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (note.length > 1000 || !approve && !note) fail(400, approve ? '审核意见不能超过 1000 个字符。' : '请填写退回原因。');
      if (approve && body.materialsChecked !== true) fail(400, '请先逐份核对原材料与申请金额，并勾选确认。');
      if (approve && !packets.list(actor, id).packets) fail(400, '请先生成并核对本版按项目合并材料，再送审或通过。');
      if (final && (!item.initialReview || item.initialReview.revision !== item.revision || item.initialReview.bundleId !== item.bundleId)) fail(409, '缺少本版有效初审结论，请交初审核查。');
      if (final && requireDistinctReviewers && item.initialReview.actor === actor.id) fail(403, '本配置要求同一申请由不同人员完成初审和复审。');
      if (body.changes !== undefined && !(initial && approve)) fail(400, '申请信息修改仅可随初审通过一并保存。');
      const edits = body.changes === undefined ? null : prepareEdits(item, body.changes);
      if (edits) {
        assertFrozenExpenses(item, edits.patch.expenseItems || item.expenseItems, fail);
        packets.updateMetadata({ ...item, ...edits.patch }, actor.id);
        applyRequestActivityCorrection(item, edits.patch.activityId);
        Object.assign(item, edits.patch);
        onEdited(item);
      }
      const at = now(), record = { actor: actor.id, revision: item.revision, bundleId: item.bundleId, at, note };
      if (initial && approve) { item.initialReview = record; item.finalReview = null; item.status = 'final_pending'; }
      else if (initial) { item.initialReview = null; item.finalReview = null; item.status = 'returned'; }
      else if (approve) { item.finalReview = record; item.status = 'approved'; item.paymentStatus = 'pending'; }
      else { item.finalReview = null; item.status = 'initial_returned'; }
      if (item.financeItems) syncFinanceRequest(item);
      item.stateVersion++; item.updatedAt = at;
      item.history.push({ action: body.action, actor: actor.id, at, note, revision: item.revision,
        stateVersion: item.stateVersion, bundleId: item.bundleId, ...(approve ? { materialsChecked: true } : {}),
        ...(edits ? { changes: edits.audit } : {}) });
      if (initial && approve) onInitialApproved(item);
      if (initial && !approve) onInitialReturned(item);
      return { ok: true, item: structuredClone(item) };
    });
  }
  return { review };
}
