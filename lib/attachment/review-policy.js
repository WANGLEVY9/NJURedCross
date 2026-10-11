import { advanceReview, chainStateFor } from './review.js';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

/** Server-side identity only: a display name or request-supplied role is not authority. */
export function authorizeReviewStep(submission, account, rows) {
  const level = chainStateFor(submission).current;
  if (!level) throw fail(409, 'review_already_final', '审核链已完成，请刷新。');
  const role = level.role === 'outreach_liaison' ? '对接人' : '审核人';
  const category = String(submission.articleCategory || submission.category || '').trim();
  const matches = (rows || []).filter(row => {
    const scopes = String(row['负责栏目'] ?? row.category ?? '').split(/[，,、/]/).map(s => s.trim());
    return row.enabled !== false && String(row['启用'] ?? '是') !== '否'
      && String(row['角色'] ?? row.role ?? '') === role
      && (scopes.includes('全部') || scopes.includes(category));
  });
  const email = row => String(row?.['邮箱'] ?? row?.email ?? '').trim().toLowerCase();
  if (matches.length !== 1 || !email(matches[0])) {
    throw fail(503, 'review_assignment_required', '请管理员配置该栏目唯一的当前层级审核人及其账号邮箱。');
  }
  if (!account?.email || email(matches[0]) !== String(account.email).trim().toLowerCase()) {
    throw fail(403, 'review_not_assigned', '当前账号不是该栏目当前层级的指定审核人。');
  }
  return level;
}

export function requireReviewChecklist(template) {
  const ids = (template || []).map(item => String(item.id || '').trim());
  if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw fail(503, 'outreach_checklist_required', '审核清单未正确配置，不能通过审核。');
  }
  return ids;
}

/** Called inside the route's mutation queue; every step reads fresh state before writing. */
export async function applyReviewStep({ client, table, contentId, body, account, reviewer,
  readRows, readAssignees, readChecklist, shapeOf }) {
  if (!['approve', 'return'].includes(body.decision)) throw fail(400, 'review_decision_invalid', '审核结果无效。');
  const existing = (await readRows(client)).find(row => String(row['投稿ID'] || '') === contentId);
  if (!existing) throw fail(404, 'review_not_found', '投稿不存在，无法审核。');
  const shape = shapeOf(existing);
  const assignees = await readAssignees(client);
  const level = authorizeReviewStep(shape, account, assignees);
  if (body.expectedLevel !== undefined && Number(body.expectedLevel) !== level.level) {
    throw fail(409, 'review_changed', '审核层级已改变，请刷新后再操作。');
  }
  const template = body.decision === 'approve' ? await readChecklist(client) : [];
  const advance = advanceReview(shape, {
    decision: body.decision, note: String(body.note || '').trim(), reviewer,
    checklist: Array.isArray(body.checklist) ? body.checklist : [],
    requiredChecklist: body.decision === 'approve' ? requireReviewChecklist(template) : [],
  });
  if (!advance.ok) throw Object.assign(fail(advance.status || 400, advance.code, advance.message), { missing: advance.missing });
  await client.updateRow(table, existing._id, advance.patch);
  return { existing, shape, assignees, advance };
}
