import { assertRequestActive } from '../http/request-budget.js';

function failure(code, reason, retryable = false) {
  return { ok: false, code, reason, retryable };
}

/**
 * The transport callback must resolve only after SMTP confirms acceptance.
 *
 * 传输失败分两种，落盘状态不同：
 * - 正文（`DATA`）还没发出去：这封信一定没送达，退回 `pending` 并标为可重试，
 *   否则一次网络抖动或认证超时就会把这条通知永久废掉。
 * - 正文已经发出去、只是没等到回执：结果不明，记 `unknown` 禁止自动重发。
 *
 * `deliver` 收到的回调要在 `DATA` 写出之前调用，用来把阶段落盘（重启恢复用）。
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

  /**
   * `DATA` 一旦写出，这封信就可能已经被服务器收下。先落盘阶段再发：
   * 进程若在等回执时退出，重启恢复才能判成「结果不明」而不是重发一遍。
   */
  let dataStarted = false;
  function noteDataStart() {
    dataStarted = true;
    try {
      store.markStage(intent.key, 'data');
    } catch {
      // 阶段写不进状态库时仍按本进程内的标记判断，不阻断发送。
    }
  }

  try {
    assertRequestActive();
    await deliver(noteDataStart);
  } catch (error) {
    // 服务器给了负回执（4xx/5xx）同样说明没送达，即使正文已经发出去过。
    if (!dataStarted || error?.deliveryOutcome === 'not_sent') {
      try {
        store.transition(intent.key, 'sending', 'pending');
      } catch {
        // 退不回去时保持 sending：重启后按 DATA 阶段恢复，同样不会错发。
      }
      return failure('mail_delivery_transport_failed', '邮件没有送达（连接或认证中断），可稍后重试。', true);
    }
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
