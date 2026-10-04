/** Short-lived, process-local cache for public projections only. */
export function createReadCache({ ttlMs = 10_000, now = Date.now } = {}) {
  const values = new Map();
  const pending = new Map();
  let version = 0;
  return {
    async get(key, load) {
      const hit = values.get(key);
      if (hit && now() < hit.expiresAt) return hit.value;
      if (pending.has(key)) return pending.get(key);
      const startedVersion = version;
      const promise = Promise.resolve().then(load).then(value => {
        if (version === startedVersion) values.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      }).finally(() => {
        if (pending.get(key) === promise) pending.delete(key);
      });
      pending.set(key, promise);
      return promise;
    },
    clear() {
      version++;
      values.clear();
      pending.clear();
    },
  };
}
