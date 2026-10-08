/** Short-lived, process-local cache for public projections only. */
import {
  assertRequestActive,
  awaitWithinRequest,
  withRequestBudget,
  withoutRequestBudget,
} from './request-budget.js';

export function createReadCache({ ttlMs = 10_000, now = Date.now } = {}) {
  const values = new Map();
  const pending = new Map();
  let version = 0;
  return {
    async get(key, load) {
      assertRequestActive();
      const hit = values.get(key);
      if (hit && now() < hit.expiresAt) return hit.value;
      if (pending.has(key)) return awaitWithinRequest(pending.get(key));
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
      return awaitWithinRequest(promise);
    },
    clear() {
      version++;
      values.clear();
      pending.clear();
    },
  };
}
