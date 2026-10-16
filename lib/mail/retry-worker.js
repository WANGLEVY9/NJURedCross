import { assertRequestActive } from '../http/request-budget.js';
import { openMailPayload } from './payload.js';
import { planMailRetry } from './retry-policy.js';

export async function runMailRetryBatch({
  store,
  getDelivery,
  deliver,
  secret,
  now = Date.now,
  limit = 5,
}) {
  const stats = {
    selected: 0,
    completed: 0,
    rescheduled: 0,
    stopped: 0,
  };

  const jobs = store.due({ now: now(), limit });
  stats.selected = jobs.length;

  function finish(job, status) {
    store.update(job.intent.key, job.attempts, {
      attempts: job.attempts,
      status,
      nextAttemptAt: job.nextAttemptAt,
    });

    stats[status === 'completed' ? 'completed' : 'stopped']++;
  }

  for (const original of jobs) {
    assertRequestActive();

    const existing = getDelivery(original.intent.key);

    if (existing?.state === 'sent') {
      finish(original, 'completed');
      continue;
    }

    if (existing && existing.state !== 'pending') {
      finish(original, 'stopped');
      continue;
    }

    const currentTime = now();

    if (
      original.expiresAt <= currentTime
      || original.attempts >= 4
    ) {
      finish(original, 'stopped');
      continue;
    }

    let message;

    try {
      message = openMailPayload(
        original.envelope,
        original.intent,
        { secret },
      );
    } catch {
      finish(original, 'stopped');
      continue;
    }

    const attempts = original.attempts + 1;
    const next = planMailRetry({
      kind: original.intent.kind,
      state: 'pending',
      attempts,
      expiresAt: original.expiresAt,
      now: currentTime,
    });

    // Reserve this attempt before calling the delivery function.
    // The last attempt still needs a crash-safe future timestamp.
    const nextAttemptAt = next.retry
      ? next.nextAttemptAt
      : Math.min(currentTime + 60_000, original.expiresAt - 1);

    if (nextAttemptAt <= original.nextAttemptAt) {
      finish(original, 'stopped');
      continue;
    }

    const reserved = store.update(
      original.intent.key,
      original.attempts,
      {
        attempts,
        status: 'queued',
        nextAttemptAt,
      },
    );

    assertRequestActive();

    let result;

    try {
      result = await deliver(message);
    } catch {
      // Leave the reserved attempt intact. The next tick checks
      // the durable delivery state before doing anything else.
      throw Object.assign(
        new Error('邮件重试中断，已保存任务状态。'),
        { code: 'mail_retry_interrupted' },
      );
    }

    assertRequestActive();

    const after = getDelivery(original.intent.key);

    if (result?.ok || after?.state === 'sent') {
      finish(reserved, 'completed');
      continue;
    }

    if (
      result?.retryable === true
      && (!after || after.state === 'pending')
      && next.retry
    ) {
      stats.rescheduled++;
      continue;
    }

    finish(reserved, 'stopped');
  }

  return stats;
}