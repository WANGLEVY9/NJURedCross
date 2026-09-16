/**
 * Generic outbound mail service.
 *
 * PLACEHOLDER — the implementation belongs to the identity workstream.
 * Contract: .workbuddy/parallel-contract.md §2
 */
export function configureMailer() {}

export function mailerStatus() {
  return { configured: false, transport: 'none' };
}

/** Returns { ok, transport, skipped?, reason? }. */
export async function sendMail() {
  return { ok: false, skipped: true, reason: 'mailer is not implemented yet' };
}
