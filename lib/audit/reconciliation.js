import { findAuditEvidence } from './reconciliation-read.js';

function unavailable() {
  return Object.assign(
    new Error('审计写入尚未确认，凭据已保留或需检查本地存储。'),
    { code: 'audit_write_unconfirmed' },
  );
}

async function authenticatedBase(getBase, baseUuid) {
  if (
    typeof getBase !== 'function'
    || typeof baseUuid !== 'string'
    || !baseUuid
  ) {
    throw unavailable();
  }

  const base = await getBase();
  if (!base || base.dtableUuid !== baseUuid) throw unavailable();
  return base;
}

/** Attempt a prepared audit write once; never automatically replay uncertainty. */
export async function persistAuditRecord({
  store,
  getBase,
  baseUuid,
  row,
}) {
  if (!store || store.baseUuid !== baseUuid) throw unavailable();
  const receipt = store.prepare(row);
  if (receipt.state === 'confirmed') {
    return { confirmed: true };
  }
  if (receipt.state !== 'prepared') throw unavailable();

  const base = await authenticatedBase(getBase, baseUuid);
  if (!store.claimAttempt(receipt.auditId)) throw unavailable();

  try {
    await base.appendRow('操作审计表', receipt.row);

    const evidence = await findAuditEvidence(base, receipt.row);
    if (!evidence.matched) throw unavailable();
  } catch {
    try {
      store.transition(receipt.auditId, 'unconfirmed');
    } catch {
      // The persisted attempted state still requires reconciliation.
    }
    throw unavailable();
  }

  store.transition(receipt.auditId, 'confirmed');
  return { confirmed: true };
}

/** Reconcile against remote evidence; this function never appends audit rows. */
export async function reconcileAuditRecord({
  store,
  getBase,
  baseUuid,
  auditId,
}) {
  if (!store || store.baseUuid !== baseUuid) throw unavailable();
  const receipt = store.get(auditId);
  if (!receipt) throw unavailable();

  const base = await authenticatedBase(getBase, baseUuid);
  const evidence = await findAuditEvidence(base, receipt.row);

  if (!evidence.found) {
    return {
      state: receipt.state,
      remoteFound: false,
      requiresManualReview: true,
    };
  }

  if (receipt.state === 'prepared') {
    return {
      state: receipt.state,
      remoteFound: true,
      requiresManualReview: true,
    };
  }

  store.transition(auditId, 'confirmed');
  return {
    state: 'confirmed',
    remoteFound: true,
    requiresManualReview: false,
  };
}