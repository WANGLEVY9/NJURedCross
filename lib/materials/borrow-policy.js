/** Apply only to the canonical name from the server-side inventory, never client text. */
export function borrowApprovalMode(item) {
  return typeof item?.name === 'string' && item.name.normalize('NFKC').trim() === '马甲' ? 'automatic' : 'manual';
}
