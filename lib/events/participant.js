/** Use the verified campus mailbox prefix when a legacy administrator lacks a student ID.
 * This is a request-local participant view, never a role or identity-table write.
 */
export function workflowParticipant(account) {
  if (!account || account.studentId || !['platform_admin','super_admin'].includes(account.role) || !account.emailVerified || !account.realName) return account;
  const match=String(account.email||'').match(/^(\d{6,20})@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/);
  return match ? {...account,studentId:match[1]} : account;
}
