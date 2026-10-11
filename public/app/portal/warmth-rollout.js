import { request } from '../core/api.js';

/**
 * The answer only changes on a deploy or a pilot toggle, and the server caches
 * the underlying schema check for 30 seconds. Remembering it for the same window
 * keeps route switches inside 内建广场 from paying another round trip, and
 * concurrent callers share one request. Failures are never remembered.
 */
const ANSWER_TTL_MS = 30_000;
let answer = null;
let pending = null;

/** Last answer inside the TTL, or null when the page has to ask again. */
export function lastKnownAvailability() {
  return answer && Date.now() < answer.expiresAt ? answer.value : null;
}

/** Old deployments and incomplete production schemas retain main's existing UI. */
export async function birthdayAvailable() {
  const remembered = lastKnownAvailability();
  if (remembered !== null) return remembered;
  if (!pending) {
    pending = request('/api/public/warmth/capabilities')
      .then((result) => {
        const value = result.birthday?.enabled === true && result.birthday?.ready === true;
        answer = { value, expiresAt: Date.now() + ANSWER_TTL_MS };
        return value;
      })
      .catch(() => false)
      .finally(() => { pending = null; });
  }
  return pending;
}
