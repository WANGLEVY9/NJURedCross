import { createHash } from 'node:crypto';

/** Server-owned scoped delegation. Names, client fields and module roles cannot grant it. */
export function createMaterialsFinanceAccess(fingerprints) {
  const approved = new Set(fingerprints);
  return account => Boolean(account && account.role === 'platform_admin' && account.status === '启用'
    && account.emailVerified === true && typeof account.accountId === 'string'
    && approved.has(createHash('sha256').update(account.accountId).digest('hex')));
}

// Owner-authorized stable account identity. No mailbox, student ID or credentials in source.
export const hasMaterialsFinanceAccess = createMaterialsFinanceAccess([
  'daed9a8eb4b7be0dab32471c82346d604d93856affcd27bdea614ba5c2a44a82',
]);
