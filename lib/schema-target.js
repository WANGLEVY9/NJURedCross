/** dtableName is descriptive, not a token scope check. Compare the authenticated UUID. */
export function assertSchemaTarget(actual, expected, { apply = false } = {}) {
  if (!expected && !apply) return;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(expected || '')) {
    throw new Error('Set an explicit SEATABLE_BUSINESS_BASE_UUID before applying a schema.');
  }
  if (String(actual || '').toLowerCase() !== expected.toLowerCase()) {
    throw new Error('Authenticated Base UUID differs from SEATABLE_BUSINESS_BASE_UUID; no schema changes allowed.');
  }
}
