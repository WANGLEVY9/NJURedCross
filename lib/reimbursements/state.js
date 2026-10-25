export const STATE_MAPS = Object.freeze(['bundles', 'requests', 'receipts', 'activities', 'summaries',
  'claims', 'summaryReceipts', 'packetSets', 'paymentReceipts', 'notificationJobs']);
export const LOCAL_LIMITS = Object.freeze({ bytes: 500 * 1024 ** 2, bundles: 30, requests: 100,
  activities: 100, summaries: 30, packets: 30, payments: 500 });
export const TABLE_LIMITS = Object.freeze({ bytes: 5 * 1024 ** 3, bundles: 5000, requests: 10000,
  activities: 10000, summaries: 2000, packets: 10000, payments: 10000 });
export const createReimbursementState = () => ({ storedBytes: 0,
  ...Object.fromEntries(STATE_MAPS.map(name => [name, new Map()])) });
