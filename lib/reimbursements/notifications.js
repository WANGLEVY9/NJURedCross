import { createHash } from 'node:crypto';
import { FINANCE_REVIEWERS } from './review-routing.js';
export const REIMBURSEMENT_MAIL_ATTACHMENT_LIMIT = 10 * 1024 ** 2;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 409 }); };
/** Notification metadata shares the same commit as its triggering business event. */
export function createReimbursementNotifications({ jobs, requests, bundles, queue, now }) {
  function enqueue(item, stage) {
    const id = createHash('sha256').update(JSON.stringify([item.id, item.revision, item.bundleId, stage, item.stateVersion])).digest('hex');
    if (jobs.has(id)) return;
    jobs.set(id, { id, requestId: item.id, revision: item.revision, bundleId: item.bundleId, stateVersion: item.stateVersion,
      reviewerKey: stage === 'initial' ? item.initialAssignment.key : 'final', stage, status: 'queued', attempts: 0,
      createdAt: now(), updatedAt: now(), nextAttemptAt: now() });
  }
  function current(job) {
    const item = requests.get(job.requestId);
    return item && item.revision === job.revision && item.bundleId === job.bundleId && item.stateVersion === job.stateVersion
      && (job.stage === 'initial' ? ['pending', 'initial_returned'].includes(item.status) : item.status === 'final_pending');
  }
  const statuses = id => [...jobs.values()].filter(job => job.requestId === id)
    .map(({ stage, status, updatedAt }) => ({ stage, status, updatedAt }));
  function pending() {
    return [...jobs.values()].filter(job => ['queued', 'sending', 'waiting-configuration'].includes(job.status)
      && job.nextAttemptAt <= now()).slice(0, 5).map(job => structuredClone(job));
  }
  function prepare(id, recipient, origin) {
    return queue(() => {
      const job = jobs.get(id); if (!job || !['queued', 'sending', 'waiting-configuration'].includes(job.status)) fail('邮件任务已变化。');
      if (!current(job)) { job.status = 'cancelled'; job.updatedAt = now(); return { cancelled: true }; }
      if (!recipient?.id || !recipient.email || recipient.emailVerified !== true) {
        job.status = 'waiting-configuration'; job.updatedAt = now(); job.nextAttemptAt = new Date(Date.parse(now()) + 60_000).toISOString();
        return { waiting: true };
      }
      if (job.delivery) {
        if (job.delivery.recipientId !== recipient.id || job.delivery.to !== recipient.email) {
          job.status = 'needs-attention'; job.failureCode = 'reviewer_changed'; job.updatedAt = now(); return { waiting: true };
        }
        job.status = 'sending'; return structuredClone(job);
      }
      const base = new URL(origin); if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) fail('邮件站点地址无效。');
      const item = requests.get(job.requestId), bundle = bundles.get(job.bundleId);
      const href = new URL(job.stage === 'initial' ? `/console/reimbursements?request=${encodeURIComponent(item.id)}`
        : `/console/reimbursements/summary?activity=${encodeURIComponent(item.activityId)}`, base.origin).href;
      const attached = job.stage === 'initial' && bundle.pageCount > 0 && bundle.merged.length <= REIMBURSEMENT_MAIL_ATTACHMENT_LIMIT;
      const materialNote = job.stage === 'final' ? '请进入活动终审，生成并核对完整报销表及材料包。'
        : attached ? '附件为本版申请的合并 PDF；Word 补充材料请登录平台查看原件。'
          : '合并 PDF 超出邮件附件限制或仅有 Word 原件，请登录平台预览并下载本版材料。';
      job.delivery = { to: recipient.email, recipientId: recipient.id,
        subject: `南大红会｜${job.stage === 'initial' ? '报销待初审' : '活动报销待终审'}：${item.activityNameSnapshot || item.code}`,
        text: `${FINANCE_REVIEWERS[job.reviewerKey]}：\n\n${item.name}的报销申请${job.code || item.code}需要${job.stage === 'initial' ? '初审' : '活动终审'}。\n金额：${(item.amountCents / 100).toFixed(2)} 元\n材料版本：第 ${item.revision} 版\n\n${materialNote}\n${href}\n\n请在平台内完成审核，回复邮件不会改变审核状态。`,
        ...(attached ? { filename: `${item.code}-第${item.revision}版-报销材料.pdf` } : {}) };
      job.status = 'sending'; job.updatedAt = now(); return structuredClone(job);
    });
  }
  function attachment(id) {
    const job = jobs.get(id);
    if (!job || job.status !== 'sending' || !current(job)) fail('材料或审核阶段已变化，本次未发信。');
    return job.delivery?.filename ? Buffer.from(bundles.get(job.bundleId).merged) : null;
  }
  function finish(id, result) {
    return queue(() => {
      const job = jobs.get(id); if (!job || job.status !== 'sending') fail('邮件任务已变化。');
      job.attempts++; job.updatedAt = now();
      job.status = result.ok ? 'sent' : result.retryable && job.attempts < 4 ? 'queued' : 'needs-attention';
      job.nextAttemptAt = new Date(Date.parse(now()) + [60, 300, 900, 3600][Math.min(job.attempts - 1, 3)] * 1000).toISOString();
      job.failureCode = result.ok ? '' : String(result.code || 'mail_not_confirmed').slice(0, 100);
      return { ok: true };
    });
  }
  return { enqueue, statuses, pending, prepare, attachment, finish };
}

/** Side effects run after the Table commit, never inside a replayable codec operation. */
export function createReimbursementNotifier({ service, getReviewer, send, enabled = () => false, origin }) {
  let running = false;
  return { async deliver() {
    if (running || !enabled()) return { selected: 0 };
    running = true; let selected = 0;
    try {
      for (const task of await service.notifications.pending()) {
        const recipient = await getReviewer(task.reviewerKey);
        const job = await service.notifications.prepare(task.id, recipient, origin);
        if (job.waiting || job.cancelled) continue;
        let content;
        try { content = await service.notifications.attachment(job.id); }
        catch { await service.notifications.finish(job.id, { ok: false, retryable: false, code: 'material_or_stage_changed' }); continue; }
        selected++;
        let result;
        try {
          result = await send({ to: job.delivery.to, subject: job.delivery.subject, text: job.delivery.text,
            kind: job.stage === 'initial' ? 'reimbursement-initial' : 'reimbursement-final', idempotencyKey: `REIMBURSEMENT:${job.id}`,
            templateRendered: true, ...(content ? { attachments: [{ filename: job.delivery.filename, content, contentType: 'application/pdf' }] } : {}) });
        } catch { result = { ok: false, code: 'mail_delivery_unknown' }; }
        await service.notifications.finish(job.id, result);
      }
      return { selected };
    } finally { running = false; }
  } };
}
