import { assertRequestActive } from '../http/request-budget.js';
import { planMaterialRecovery } from './recovery.js';

/**
 * receipt must already be durably stored.
 * saveReceipt must confirm persistence before resolving.
 * readState must perform fresh, complete authoritative reads.
 * Caller must hold the application and asset operation locks.
 */
export async function executeMaterialRecovery({
  receipt,
  incoming,
  saveReceipt,
  readState,
  appendFlow,
  updateApplication,
}) {
  let current = receipt;

  async function persist(state) {
    assertRequestActive();
    const next = { ...current, state };
    await saveReceipt(next);
    current = next;
  }

  for (let step = 0; step < 4; step++) {
    assertRequestActive();
    const snapshot = await readState();
    assertRequestActive();

    const plan = planMaterialRecovery({
      receipt: current,
      incoming,
      ...snapshot,
    });

    if (plan.action === 'complete') {
      if (current.state !== 'completed') {
        await persist('completed');
      }
      return {
        ok: true,
        flowId: plan.flowId,
        receipt: current,
      };
    }

    if (plan.action === 'append_flow') {
      await persist('flow_attempted');
      assertRequestActive();
      await appendFlow(current.flow);
      // Re-read before deciding whether the write actually took effect.
      continue;
    }

    if (plan.action === 'update_application') {
      await persist('application_attempted');
      assertRequestActive();
      await updateApplication(
        current.identity.payload.applicationId,
        current.after,
      );
      // Confirm the target state before reporting completion.
      continue;
    }

    throw new Error('Unknown material recovery action');
  }

  throw Object.assign(
    new Error('操作结果未能确认，请核对流水和申请状态后再恢复。'),
    {
      statusCode: 503,
      code: 'material_recovery_unconfirmed',
    },
  );
}