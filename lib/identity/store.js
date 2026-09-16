/**
 * Platform account store.
 *
 * PLACEHOLDER — the implementation belongs to the identity workstream.
 * Contract: .workbuddy/parallel-contract.md §2
 */
export const ACCOUNT_TABLE = '平台账号表';
export const ACCOUNT_COLUMNS = [];

/** Returns a Map<login, account>, or null when the table is absent/empty. */
export async function loadAccountsFromTable() {
  return null;
}

export function hashPassword() {
  throw new Error('hashPassword is not implemented yet');
}

export function verifyPassword() {
  return false;
}

export function generateMemberCode() {
  throw new Error('generateMemberCode is not implemented yet');
}
