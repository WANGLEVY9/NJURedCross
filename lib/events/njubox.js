/**
 * njubox client (NJU Box is a self-hosted Seafile Enterprise instance, so the
 * contract is the Seafile Web API at <server>/api2/).
 *
 * PLACEHOLDER — the implementation belongs to the events workstream.
 * Contract: .workbuddy/parallel-contract.md §3
 */
export function njuboxStatus() {
  return { configured: false, transport: 'seafile-web-api' };
}

/** Anonymous endpoints, so this works even with no token configured. */
export async function probeServer() {
  return { ok: false, reason: 'njubox client is not implemented yet' };
}

export async function listLibraries() {
  return [];
}

export async function uploadFile() {
  throw new Error('njubox uploadFile is not implemented yet');
}
