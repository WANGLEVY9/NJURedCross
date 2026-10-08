import { assertRequestActive } from '../http/request-budget.js';

function failure(code, reason, retryable = false) {
  return { ok: false, code, reason, retryable };
}

/**
 * The transport callback must resolve only after SMTP confirms acceptance.
 * A thrown transport error is conservatively an unknown delivery outcome.
 * Neither message bodies nor credentials are persisted here.
 */
export async function deliverMailOnce({
  store,
  intent,
  checkHistory,
  deliver,
  recordDelivery,
}) {
  let entry;
  try {
    assertRequestActive();
    entry = store.create(intent);
  } catch (error) {
    const code = ['mail_intent_conflict', 'mail_delivery_state_conflict'].includes(error.code)
      ? error.code : 'mail_delivery_store_unavailable';
    return failure(code, '邮件任务无法确认，本次未发送。');
  }

  async function repairRecord(sent) {
    if (sent.recorded) return false;
    try {
      assertRequestActive();
      await recordDelivery(sent);
      store.markRecorded(sent.intent.key);
      return false;
    } catch {
      return true;
    }
  }

  if (entry.state === 'sent') {
    return {
      ok: true,
      skipped: true,
      recordPending: await repairRecord(entry),
    };
  }
  if (entry.state === 'sending' || entry.state === 'unknown') {
    return failure('mail_delivery_unknown', '之前的发送结果尚未确认，禁止自动重发。');
  }
  if (entry.state === 'cancelled') {
    return failure('mail_delivery_cancelled', '该邮件任务已取消，不能恢复发送。');
  }

  let alreadySent;
  try {
    assertRequestActive();
    alreadySent = await checkHistory(intent);
    if (typeof alreadySent !== 'boolean') throw new Error('Invalid history result');
    assertRequestActive();
  } catch {
    return failure('mail_history_unavailable', '邮件历史暂不可确认，本次未发送。', true);
  }

  if (alreadySent) {
    try {
      store.transition(intent.key, 'pending', 'sending');
      store.transition(intent.key, 'sending', 'sent');
      store.markRecorded(intent.key);
      return { ok: true, skipped: true, recordPending: false };
    } catch {
      // Remote success was positively confirmed; never send despite a local failure.
      return { ok: true, skipped: true, statePersistencePending: true };
    }
  }

  try {
    assertRequestActive();
    entry = store.transition(intent.key, 'pending', 'sending');
  } catch {
    return failure('mail_delivery_not_claimed', '任务已变化或状态无法保存，本次未发送。');
  }

  try {
    assertRequestActive();
    await deliver();
  } catch {
    try { store.transition(intent.key, 'sending', 'unknown'); } catch { /* Durable sending also prevents retry. */ }
    return failure('mail_delivery_unknown', '发送未得到可靠确认，禁止自动重发。');
  }

  try {
    entry = store.transition(intent.key, 'sending', 'sent');
  } catch {
    // SMTP acceptance is known, but the durable state may still be sending.
    // Report the real acceptance and require reconciliation; do not send again.
    return { ok: true, statePersistencePending: true, recordPending: true };
  }

  return { ok: true, recordPending: await repairRecord(entry) };
}
