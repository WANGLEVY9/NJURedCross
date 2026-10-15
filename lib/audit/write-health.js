/** Process-local audit acknowledgement counters, without event contents. */
export function createAuditWriteHealth({
  now = Date.now,
  log = message => console.error(message),
} = {}) {
  let attempts = 0;
  let confirmed = 0;
  let unconfirmed = 0;
  let lastConfirmedAt = null;
  let lastUnconfirmedAt = null;

  return {
    async write(operation) {
      if (typeof operation !== 'function') {
        throw new TypeError('An audit write operation is required');
      }

      attempts++;
      try {
        await operation();
        confirmed++;
        lastConfirmedAt = new Date(now()).toISOString();
        return { confirmed: true };
      } catch {
        unconfirmed++;
        lastUnconfirmedAt = new Date(now()).toISOString();

        try {
          log('Audit write acknowledgement failed; reconciliation required.');
        } catch {
          // A logging failure must not change an already completed business action.
        }

        return { confirmed: false };
      }
    },

    snapshot() {
      return {
        scope: 'current-process',
        persistent: false,
        status: unconfirmed > 0 ? 'degraded' : 'no-unconfirmed-writes',
        attempts,
        confirmed,
        unconfirmed,
        lastConfirmedAt,
        lastUnconfirmedAt,
      };
    },
  };
}