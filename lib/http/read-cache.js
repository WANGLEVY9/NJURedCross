/** Short-lived, process-local cache for public projections only. */
import {
  assertRequestActive,
  awaitWithinRequest,
  withRequestBudget,
  withoutRequestBudget,
} from './request-budget.js';

export function createReadCache({ ttlMs = 10_000, staleMs = 0, now = Date.now } = {}) {
  const values = new Map();
  const pending = new Map();
  let version = 0;
  return {
    async get(key, load, { refresh = false } = {}) {
      assertRequestActive();
      const hit = values.get(key);
      if (!refresh && hit && now() < hit.expiresAt) return hit.value;
      const usable = !refresh && hit && now() < hit.expiresAt + staleMs;
      if (pending.has(key)) return usable ? hit.value : awaitWithinRequest(pending.get(key));
      const startedVersion = version;
      const promise = withoutRequestBudget(() =>
        withRequestBudget(load),
      ).then(value => {
        if (version === startedVersion) values.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      }).finally(() => {
        if (pending.get(key) === promise) pending.delete(key);
      });
      pending.set(key, promise);
      if (usable) {
        // The old public projection has a hard age bound. Failure does not
        // extend it; cold/expired reads still fail instead of inventing empties.
        promise.catch(() => {});
        return hit.value;
      }
      return awaitWithinRequest(promise);
    },
    clear() {
      version++;
      values.clear();
      pending.clear();
    },
  };
}
