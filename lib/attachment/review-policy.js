import { advanceReview, assigneeTiers, chainStateFor, reviewScopeOf } from './review.js';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

/** Server-side identity only: a display name or request-supplied role is not authority. */
export function authorizeReviewStep(submission, account, rows) {
  const level = chainStateFor(submission).current;
  if (!level) throw fail(409, 'review_already_final', '审核链已完成，请刷新。');
  // 2026-11-11：作用域只认 11 栏目；文创设计不挂栏目，退化为内容类型「文创设计」。
  // 「类别」（文字稿件/小绿书）不是栏目，不能拿来兜底。
  const scope = reviewScopeOf(submission);
  if (!scope) {
    throw fail(409, 'review_category_missing', '该稿件未登记推文栏目（推文类别为空），无法确定审核人，请管理员补填后再审核。');
  }
  // 与展示层共用同一套「精确 → 全部 → 唯一」解析。旧实现直接对全表做「精确或通配」过滤并要求
  // 总数恰好 1，导致：(1) 只要补一行「全部」通配，11 个栏目全部变成 2 个候选 → 全站 503；
  // (2) 文档写明的「唯一在岗者兜底」在鉴权层不生效。改为按档位取，只要求**该档位**恰好一人。
  const role = level.role === 'outreach_liaison' ? 'liaison' : 'reviewer';
  const { tier, matches } = assigneeTiers(rows, scope, role);
  const email = (row) => String(row?.['邮箱'] ?? row?.email ?? '').trim().toLowerCase();
  const roleLabel = role === 'liaison' ? '对接人' : '审核人';
  if (tier === 'none') {
    throw fail(503, 'review_assignment_required', `「${scope}」在对接人表里没有可用的${roleLabel}，请管理员补一行（负责栏目=${scope}）及其账号邮箱。`);
  }
  if (matches.length !== 1 || !email(matches[0])) {
    const names = matches.map((row) => String(row?.['姓名'] ?? row?.name ?? '') || '(未署名)').join('、');
    throw fail(503, 'review_assignment_required', `「${scope}」的${roleLabel}匹配到 ${matches.length} 人（${names}），当前层级责任人必须唯一，请管理员收敛为一人并补全邮箱。`);
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
