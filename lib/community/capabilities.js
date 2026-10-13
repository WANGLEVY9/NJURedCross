import { createReadCache } from '../http/read-cache.js';
import { inspectBirthdaySchema } from './birthday-rollout.js';
import { inspectMorningSchema } from '../morning/rollout.js';

/** Public discovery only; mutation schema checks must still read the authority. */
export function createWarmthCapabilities({ getBase, birthday, morningEnabled }) {
  const cache = createReadCache({ ttlMs: 30_000 });
  const unavailable = () => ({
    birthday: { enabled: birthday.enabled, ready: false, automaticDelivery: false },
    morning: { enabled: morningEnabled, ready: false },
  });
  return async function capabilities() {
    try {
      return await cache.get('capabilities', async () => {
        const metadata = birthday.enabled || morningEnabled ? await (await getBase()).getMetadata() : null;
        const ready = birthday.enabled && inspectBirthdaySchema(metadata).ready;
        return {
          birthday: { enabled: birthday.enabled, ready, automaticDelivery: ready && birthday.automaticDelivery },
          morning: { enabled: morningEnabled, ready: morningEnabled && inspectMorningSchema(metadata).ready },
        };
      });
    } catch { return unavailable(); }
  };
}
