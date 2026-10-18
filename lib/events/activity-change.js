import { createHash } from 'node:crypto';

// This module builds proposals only. Persistence and authoritative permission checks
// belong to the workflow service; no formal event is modified here.
const editable = new Set(['活动名称', '报名日期', '报名时段', '容量', '服务时长', '培训时长', '交通时长', '地点', '工作内容', '通知草稿']);
const conflict = message => Object.assign(new Error(message), { statusCode: 409 });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function activityChangeDigest(event) {
  return createHash('sha256').update(JSON.stringify(canonical(event))).digest('hex');
}
export function proposeActivityChange(event, patch, { actor, requestId }) {
  if (event['状态'] !== '报名中') throw conflict('当前仅支持报名中活动提交变更');
  if (!event['活动ID'] || !actor || !requestId) throw new Error('变更申请缺少活动、提交人或申请编号');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('变更内容无效');
  const changes = [];
  for (const [field, value] of Object.entries(patch)) {
    if (!editable.has(field)) throw new Error(`不允许通过变更申请覆盖字段：${field}`);
    if (!['string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw new Error('变更字段值无效');
    if (String(event[field] ?? '') !== String(value)) changes.push({ field, before: event[field] ?? '', after: value });
  }
  if (!changes.length) throw conflict('未发现需要提交的修改');
  return { id: requestId, eventId: event['活动ID'], actor, baseDigest: activityChangeDigest(event), status: 'pending', changes };
}
export function reviewActivityChange(event, proposal, { actor, canReview, allowSelfReview = false, decision, reason = '' }) {
  if (!actor || !canReview) throw Object.assign(new Error('当前账号无权审核此变更'), { statusCode: 403 });
  if (actor === proposal.actor && !allowSelfReview) throw Object.assign(new Error('不能审核自己提交的变更'), { statusCode: 403 });
  if (!['approve', 'return'].includes(decision)) throw new Error('审核决定无效');
  if (proposal.status !== 'pending') throw conflict('变更申请已处理，请刷新');
  if (event['活动ID'] !== proposal.eventId) throw conflict('变更申请与活动不匹配');
  if (decision === 'return' && !reason.trim()) throw new Error('请填写退回原因');
  if (decision === 'approve' && (event['状态'] !== '报名中' || activityChangeDigest(event) !== proposal.baseDigest)) throw conflict('正式活动已变化，请重新核对并提交变更');
  // Return only an application plan. The caller must revalidate business rules,
  // re-sign approval and persist under its mutation lock before acknowledging success.
  return {
    proposal: { ...proposal, status: decision === 'approve' ? 'approved' : 'returned', reviewer: actor, reason: reason.trim() },
    patch: decision === 'approve' ? Object.fromEntries(proposal.changes.map(change => {
      if (!editable.has(change.field)) throw new Error('变更申请包含不允许修改的字段');
      return [change.field, change.after];
    })) : {},
  };
}